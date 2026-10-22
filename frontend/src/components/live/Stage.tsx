"use client";
// vm_stage (Part 21b1): viewers on stage during a live event.
//
//   * StageGrid shows the host and up to three speakers: the host alone fills
//     the picture; with speakers it becomes a 2 by 2 view (also on phones)
//   * HandPanel is the viewer's side: raise a hand (signed in wallets only),
//     answer the host's invitation, then the microphone, the camera and
//     Leave the stage. Nothing turns on until the viewer says yes, and the
//     browser asks for the camera and the microphone itself
//   * StagePanel is the host's side: the raised hands, invitations waiting,
//     the speakers with Mute and Remove
//
// The server tells each page what changed through the room (topic "stage",
// sent only to the host and the viewer concerned). The pages pass those
// messages here on their bus as "stage" events.
import { useCallback, useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track, type Participant } from "livekit-client";
import { Hand, Mic, MicOff, Video, VideoOff } from "lucide-react";
import { clsx } from "clsx";
import { useTranslations } from "next-intl";
import {
  getMyStage, raiseHand, leaveStage, acceptStage, getStage, inviteToStage, muteOnStage, removeFromStage,
  ApiError, type StageEntry, type StageState,
} from "@/lib/api";

export const HOST_IDENTITY = "host";
const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

// ── the picture ───────────────────────────────────────────────────────────────

export interface Tile {
  id: string; name: string; host: boolean; local: boolean;
  /** a LiveKit video track, or (for the host's own preview) a camera stream */
  track?: Track; stream?: MediaStream; micOff: boolean;
}

/** The host and speakers in the room, the host first. */
export function tilesOf(room: Room | null, hostName: string): Tile[] {
  if (!room) return [];
  const people: Participant[] = [room.localParticipant, ...Array.from(room.remoteParticipants.values())];
  const out: Tile[] = [];
  for (const p of people) {
    const host = p.identity === HOST_IDENTITY;
    const local = p === room.localParticipant;
    const videoPub = p.getTrackPublication(Track.Source.Camera) ?? p.getTrackPublication(Track.Source.ScreenShare);
    const micPub = p.getTrackPublication(Track.Source.Microphone);
    // A viewer who is not speaking has no tile.
    if (!host && !videoPub && !micPub) continue;
    out.push({
      id: p.identity, name: host ? hostName : p.name || "", host, local,
      track: videoPub && !videoPub.isMuted ? videoPub.track ?? undefined : undefined,
      micOff: !micPub || micPub.isMuted,
    });
  }
  return out.sort((a, b) => Number(b.host) - Number(a.host));
}

function TileVideo({ tile }: { tile: Tile }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (tile.stream) { el.srcObject = tile.stream; el.play().catch(() => {}); return () => { el.srcObject = null; }; }
    if (tile.track) { tile.track.attach(el); return () => { tile.track?.detach(el); }; }
  }, [tile.track, tile.stream]);
  if (!tile.track && !tile.stream) return null;
  return <video ref={ref} muted={tile.local || !!tile.stream} playsInline autoPlay className="absolute inset-0 w-full h-full object-contain" />;
}

/** The host alone fills the picture; with speakers, a 2 by 2 view. */
export function StageGrid({ tiles, label }: { tiles: Tile[]; label: string }) {
  const t = useTranslations("stage");
  const many = tiles.length > 1;
  return (
    <div className={clsx("absolute inset-0", many && "grid grid-cols-2 grid-rows-2 gap-0.5 bg-black")} aria-label={label} data-stage-grid={tiles.length}>
      {tiles.map((tile) => (
        <div key={tile.id} className={clsx("relative w-full h-full min-h-0 bg-black overflow-hidden", many && tiles.length === 2 && "row-span-2")} data-tile={tile.host ? "host" : "speaker"}>
          <TileVideo tile={tile} />
          {!tile.track && !tile.stream && !tile.host && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="w-14 h-14 rounded-full bg-slate-2 text-paper flex items-center justify-center font-display text-[20px]" aria-hidden>{(tile.name || "?").slice(0, 1).toUpperCase()}</span>
            </div>
          )}
          {many && (
            <span className="absolute end-2 top-2 z-10 flex items-center gap-1.5 bg-black/70 rounded px-2 h-6 max-w-[70%]">
              {tile.micOff && <MicOff size={12} className="text-dim shrink-0" aria-label={t("micOff")} />}
              <span className="text-[12px] text-paper truncate" dir="auto">{tile.host ? t("hostTile", { name: tile.name }) : tile.name}</span>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/** Rebuild the tiles whenever someone publishes, unpublishes, mutes or leaves. */
export function useTiles(room: Room | null, hostName: string, extra?: (tiles: Tile[]) => Tile[]) {
  const [tiles, setTiles] = useState<Tile[]>([]);
  const extraRef = useRef(extra);
  extraRef.current = extra;
  const rebuild = useCallback(() => {
    const list = tilesOf(room, hostName);
    setTiles(extraRef.current ? extraRef.current(list) : list);
  }, [room, hostName]);
  useEffect(() => {
    if (!room) { setTiles([]); return; }
    const events = [
      RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted,
      RoomEvent.TrackPublished, RoomEvent.TrackUnpublished, RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished,
      RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.Connected, RoomEvent.ParticipantNameChanged,
    ];
    events.forEach((ev) => room.on(ev, rebuild));
    rebuild();
    return () => { events.forEach((ev) => room.off(ev, rebuild)); };
  }, [room, rebuild]);
  return { tiles, rebuild };
}

// ── the viewer's side ─────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** A message already in the reader's language. */
class StageNote extends Error {}

export function HandPanel({ eventId, room, canStage, signedIn, bus }: {
  eventId: string; room: Room | null;
  /** the page joined the room as a signed in wallet */
  canStage: boolean; signedIn: boolean; bus: EventTarget;
}) {
  const t = useTranslations("stage");
  const [state, setState] = useState<StageState | "none" | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [, setTick] = useState(0);

  const load = useCallback(() => {
    getMyStage(eventId).then((s) => { setState(s.state); setBlocked(s.blocked); }).catch(() => setState("none"));
  }, [eventId]);
  useEffect(() => { if (canStage && signedIn) load(); else setState(null); }, [canStage, signedIn, load]);

  // The camera and the microphone stop as soon as this page may no longer publish.
  const stopDevices = useCallback(async () => {
    const lp = room?.localParticipant;
    if (!lp) return;
    await lp.setCameraEnabled(false).catch(() => {});
    await lp.setMicrophoneEnabled(false).catch(() => {});
  }, [room]);

  useEffect(() => {
    const on = (ev: Event) => {
      const body = (ev as CustomEvent).detail ?? {};
      if (body.type === "stage") {
        setState(body.state);
        if (body.state !== "speaking") void stopDevices();
        if (body.removed && body.state === "none") setMsg(t("removed"));
        else if (body.lapsed) setMsg(t("lapsed"));
        else if (body.state === "invited") setMsg(null);
      } else if (body.type === "muted") {
        setMsg(body.kind === "audio" ? t("hostMutedMic") : t("hostMutedCamera"));
      }
    };
    bus.addEventListener("stage", on);
    return () => bus.removeEventListener("stage", on);
  }, [bus, stopDevices, t]);

  // Redraw the microphone and camera buttons when they change, and stop the devices if the permission goes.
  useEffect(() => {
    if (!room) return;
    const tick = () => setTick((n) => n + 1);
    const perms = () => { if (!room.localParticipant.permissions?.canPublish) void stopDevices(); tick(); };
    const evs = [RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted];
    evs.forEach((e) => room.on(e, tick));
    room.on(RoomEvent.ParticipantPermissionsChanged, perms);
    return () => { evs.forEach((e) => room.off(e, tick)); room.off(RoomEvent.ParticipantPermissionsChanged, perms); };
  }, [room, stopDevices]);

  const act = async (f: () => Promise<void>) => {
    setBusy(true); setMsg(null);
    try { await f(); } catch (e) { setMsg(e instanceof ApiError || e instanceof StageNote ? e.message : t("failed")); load(); } finally { setBusy(false); }
  };
  const raise = () => act(async () => {
    if (!room) throw new Error("no room");
    const r = await raiseHand(eventId, room.localParticipant.identity, note.trim() || undefined);
    setState(r.state);
  });
  const lower = () => act(async () => { await stopDevices(); await leaveStage(eventId); setState("none"); });
  const join = () => act(async () => {
    const r = await acceptStage(eventId);
    setState(r.state);
    const lp = room!.localParticipant;
    // The permission arrives through the room just after the answer.
    for (let i = 0; i < 25 && !lp.permissions?.canPublish; i++) await sleep(200);
    try { await lp.setMicrophoneEnabled(true); }
    catch {
      await leaveStage(eventId).catch(() => {}); setState("none");
      throw new StageNote(t("micDenied"));
    }
    try { await lp.setCameraEnabled(true); } catch { setMsg(t("cameraDenied")); }
  }).then(() => {});

  const lp = room?.localParticipant;
  const micOn = !!lp?.isMicrophoneEnabled, camOn = !!lp?.isCameraEnabled;

  let body: React.ReactNode;
  if (!signedIn) body = <p className="text-[13px] text-dim">{t("signInToRaise")}</p>;
  else if (!canStage) body = <p className="text-[13px] text-dim">{t("reconnecting")}</p>;
  else if (state === null) body = null;
  else if (blocked) body = <p className="text-[13px] text-dim">{t("blocked")}</p>;
  else if (state === "none") body = (
    <div className="flex items-center gap-2 flex-wrap">
      <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 100))} maxLength={100} placeholder={t("notePlaceholder")} aria-label={t("noteLabel")} dir="auto" className="h-9 px-2.5 text-[13px] flex-1 min-w-[180px]" />
      <button onClick={() => void raise()} disabled={busy || !room} className="btn btn-ghost h-9 px-3.5 inline-flex items-center gap-1.5" data-raise-hand>
        <Hand size={15} /> {t("raise")}
      </button>
    </div>
  );
  else if (state === "raised") body = (
    <div className="flex items-center gap-3 flex-wrap">
      <p className="text-[13.5px] text-paper flex items-center gap-1.5" data-hand-up><Hand size={15} className="text-signal" /> {t("handUp")}</p>
      <button onClick={() => void lower()} disabled={busy} className="btn btn-ghost h-8 px-3 text-[13px]">{t("lower")}</button>
    </div>
  );
  else if (state === "invited") body = (
    <div role="alertdialog" aria-labelledby="stage-invite-title" className="rounded-md border border-signal/60 bg-signal/5 px-3.5 py-3 space-y-2.5" data-stage-invite>
      <p id="stage-invite-title" className="text-[14px] text-paper">{t("invited")}</p>
      <p className="text-[12.5px] text-dim">{t("invitedHint")}</p>
      <div className="flex items-center gap-2">
        <button onClick={() => void join()} disabled={busy} className="btn btn-signal h-9 px-4" data-stage-join>{busy ? t("joining") : t("join")}</button>
        <button onClick={() => void lower()} disabled={busy} className="btn btn-ghost h-9 px-3.5" data-stage-decline>{t("notNow")}</button>
      </div>
    </div>
  );
  else body = (
    <div className="flex items-center gap-2 flex-wrap" data-on-stage>
      <span className="text-[13.5px] text-paper me-1">{t("onStage")}</span>
      <button onClick={() => void act(async () => { await lp?.setMicrophoneEnabled(!micOn); })} disabled={busy} aria-pressed={micOn} className="btn btn-ghost h-9 px-3 inline-flex items-center gap-1.5 text-[13px]" data-stage-mic>
        {micOn ? <Mic size={15} /> : <MicOff size={15} className="text-dim" />} {micOn ? t("micOn") : t("micOff")}
      </button>
      <button onClick={() => void act(async () => { await lp?.setCameraEnabled(!camOn); })} disabled={busy} aria-pressed={camOn} className="btn btn-ghost h-9 px-3 inline-flex items-center gap-1.5 text-[13px]" data-stage-camera>
        {camOn ? <Video size={15} /> : <VideoOff size={15} className="text-dim" />} {camOn ? t("cameraOn") : t("cameraOff")}
      </button>
      <button onClick={() => void lower()} disabled={busy} className="btn btn-ghost h-9 px-3 text-[13px]" data-stage-leave>{t("leave")}</button>
    </div>
  );

  return (
    <div className="space-y-2" data-hand-panel>
      {body}
      {msg && <p className="text-[12.5px] text-warn" role="status">{msg}</p>}
    </div>
  );
}

// ── the host's side ───────────────────────────────────────────────────────────

export function StagePanel({ eventId, bus, live }: { eventId: string; bus: EventTarget; live: boolean }) {
  const t = useTranslations("stage");
  const [list, setList] = useState<{ hands: StageEntry[]; invited: StageEntry[]; speakers: StageEntry[]; max: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { getStage(eventId).then(setList).catch(() => {}); }, [eventId]);
  useEffect(() => {
    if (!live) return;
    load();
    const timer = setInterval(load, 15_000);
    const on = () => load();
    bus.addEventListener("stage", on);
    return () => { clearInterval(timer); bus.removeEventListener("stage", on); };
  }, [live, load, bus]);

  const act = async (key: string, f: () => Promise<unknown>) => {
    setBusy(key); setErr(null);
    try { await f(); } catch (e) { setErr(e instanceof ApiError ? e.message : t("failed")); } finally { setBusy(null); load(); }
  };
  const taken = (list?.invited.length ?? 0) + (list?.speakers.length ?? 0);
  const max = list?.max ?? 3;
  const full = taken >= max;
  const who = (x: StageEntry) => (
    <span className="min-w-0">
      <span className="block text-[13.5px] text-paper truncate" dir="auto">{x.name}</span>
      {x.name !== shortAddr(x.wallet) && <span className="block text-[11.5px] text-dim tc" dir="ltr">{shortAddr(x.wallet)}</span>}
    </span>
  );

  return (
    <div className="space-y-4" data-stage-panel>
      <div>
        <p className="text-[13px] font-medium text-paper">{t("speakersTitle", { count: list?.speakers.length ?? 0, max })}</p>
        <p className="text-[12.5px] text-dim mt-0.5">{t("headphones")}</p>
        <p className="text-[12.5px] text-dim">{t("recordingNote")}</p>
      </div>
      {!!list?.speakers.length && (
        <ul className="space-y-2" data-speakers>
          {list.speakers.map((x) => (
            <li key={x.wallet} className="flex items-center justify-between gap-2">
              {who(x)}
              <span className="flex items-center gap-1 shrink-0">
                <button onClick={() => void act(`m${x.wallet}`, () => muteOnStage(eventId, x.wallet, "audio"))} disabled={busy != null} className="btn btn-ghost h-8 px-2 text-[12.5px] inline-flex items-center gap-1" aria-label={t("muteMicOf", { name: x.name })} data-stage-mute><MicOff size={13} /> {t("mute")}</button>
                <button onClick={() => void act(`v${x.wallet}`, () => muteOnStage(eventId, x.wallet, "video"))} disabled={busy != null} className="btn btn-ghost h-8 px-2 text-[12.5px] inline-flex items-center gap-1" aria-label={t("cameraOffOf", { name: x.name })}><VideoOff size={13} /></button>
                <button onClick={() => void act(`r${x.wallet}`, () => removeFromStage(eventId, x.wallet))} disabled={busy != null} className="btn btn-ghost h-8 px-2 text-[12.5px]" data-stage-remove>{t("remove")}</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {!!list?.invited.length && (
        <ul className="space-y-2" data-invited>
          {list.invited.map((x) => (
            <li key={x.wallet} className="flex items-center justify-between gap-2">
              <span className="min-w-0">{who(x)}<span className="block text-[12px] text-dim">{t("waitingYes")}</span></span>
              <button onClick={() => void act(`c${x.wallet}`, () => removeFromStage(eventId, x.wallet))} disabled={busy != null} className="btn btn-ghost h-8 px-2.5 text-[12.5px] shrink-0">{t("cancel")}</button>
            </li>
          ))}
        </ul>
      )}
      <div>
        <p className="text-[13px] font-medium text-paper flex items-center gap-1.5"><Hand size={14} /> {t("handsTitle", { count: list?.hands.length ?? 0 })}</p>
        {!list?.hands.length ? <p className="text-[12.5px] text-dim mt-1">{t("noHands")}</p> : (
          <ul className="space-y-2 mt-2" data-hands>
            {list.hands.map((x) => (
              <li key={x.wallet} className="flex items-start justify-between gap-2">
                <span className="min-w-0">
                  {who(x)}
                  {x.note && <span className="block text-[12.5px] text-paper-2 mt-0.5 break-words" dir="auto">{x.note}</span>}
                </span>
                <button onClick={() => void act(`i${x.wallet}`, () => inviteToStage(eventId, x.wallet))} disabled={busy != null || full} title={full ? t("fullHint", { max }) : undefined} className="btn btn-ghost h-8 px-2.5 text-[12.5px] shrink-0" data-stage-invite-btn>
                  {busy === `i${x.wallet}` ? t("inviting") : t("invite")}
                </button>
              </li>
            ))}
          </ul>
        )}
        {full && !!list?.hands.length && <p className="text-[12px] text-dim mt-1.5">{t("fullHint", { max })}</p>}
      </div>
      {err && <p className="text-[12.5px] text-error" role="alert">{err}</p>}
    </div>
  );
}
