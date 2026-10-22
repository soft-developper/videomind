"use client";
// vm_live: the host's side of a live event.
//
// The camera or screen and the microphone are published to the LiveKit
// room, and recorded in this browser at the same time (as on the Record
// page). When the event ends the recording can be uploaded as a video,
// and the event's page then points to it.
//
// vm_livechat: the host chooses who may write in the chat and whether
// captions are made, before or during the event. Captions take the sound
// that goes live (see lib/liveaudio.ts). The host's chat sits beside the
// picture, with delete and block.
//
// vm_livesession: the host picks how long the event runs before going live.
// The studio counts down, offers to add time once (10, 20 or 30 minutes),
// and stops at the end time. The server ends the event then too, so a
// closed or sleeping tab does not keep it going.
//
// vm_stage (Part 21b1): the host sees the raised hands, invites up to three
// speakers, can mute or remove them, and sees and hears them here. With
// speakers the picture becomes a 2 by 2 view.
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Room, RoomEvent, Track } from "livekit-client";
import { Monitor, Camera } from "lucide-react";
import { clsx } from "clsx";
import { UploadZone } from "@/components/upload/UploadZone";
import { QrCode } from "@/components/share/QrCode";
import { openInputs, pickType, fixWebmDuration, VIDEO_BITS, AUDIO_BITS, MAX_SECONDS, canRecord, type Source, type Inputs } from "@/lib/record";
import {
  getLiveEvent, liveHostToken, startLive, endLive, liveStats, linkLiveRecording, ApiError, type LiveEventInfo,
  updateLiveSettings, liveCaptionsSocket, type ChatMode, getLiveConfig, extendLive,
} from "@/lib/api";
import { startCaptionFeed } from "@/lib/liveaudio";
import { LiveChat } from "./LiveChat";
// vm_share, vm_reactions (Part 21a)
import { LiveShareLinks } from "./LiveShare";
import { ReactionLayer } from "./Reactions";
import { StageGrid, StagePanel, useTiles } from "./Stage";
// vm_lang
import { useTranslations } from "next-intl";
import { localize } from "@/lib/errorText";
// vm_charge: the price of captions, and a way to add credits when they stop for credits
import { PriceTag, AddCreditsLink, useCredits, isNoCredits } from "@/components/credits/Credits";
import { useMoney, inline, useFormat } from "@/lib/format";

type T = ReturnType<typeof useTranslations<"live">>;
const CHAT_CHOICES: ChatMode[] = ["anyone", "wallets", "off"];

/** Who may chat and whether captions are made. Saved at once; works before and during the event. */
function LiveSettings({ event, onSaved }: { event: LiveEventInfo; onSaved: () => void }) {
  const t = useTranslations("live");
  const tc = useTranslations("common");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Shown at once; put back if the server refuses.
  const [mode, setMode] = useState<ChatMode>(event.chatMode);
  const [captions, setCaptions] = useState(event.captions);
  useEffect(() => { setMode(event.chatMode); setCaptions(event.captions); }, [event.chatMode, event.captions]);
  const change = async (s: { chatMode?: ChatMode; captions?: boolean }) => {
    setBusy(true); setErr(null);
    if (s.chatMode) setMode(s.chatMode);
    if (s.captions !== undefined) setCaptions(s.captions);
    try { await updateLiveSettings(event.id, s); onSaved(); }
    catch (x) {
      setMode(event.chatMode); setCaptions(event.captions);
      setErr(x instanceof ApiError ? x.message : t("notSaved"));
    }
    finally { setBusy(false); }
  };
  return (
    <div className="space-y-4" aria-label={t("settingsLabel")}>
      <fieldset className="space-y-1.5" disabled={busy}>
        <legend className="text-[13px] font-medium text-paper mb-1">{t("whoWrites")}</legend>
        {CHAT_CHOICES.map((v) => (
          <label key={v} className="flex items-start gap-2.5 cursor-pointer">
            <input type="radio" name="chat-mode" checked={mode === v} onChange={() => void change({ chatMode: v })} className="mt-1" />
            <span><span className="block text-[13.5px] text-paper">{t(`chatMode.${v}`)}</span><span className="block text-[12.5px] text-dim">{t(`chatModeHint.${v}`)}</span></span>
          </label>
        ))}
      </fieldset>
      <div>
        <label className={clsx("flex items-center gap-2.5 text-[13.5px] cursor-pointer", event.captionsAvailable ? "text-paper" : "text-dim")}>
          <input type="checkbox" checked={event.captionsAvailable ? captions : false} disabled={busy || !event.captionsAvailable} onChange={(e) => void change({ captions: e.target.checked })} />
          {t("captions")}
        </label>
        <p className="text-[12.5px] text-dim mt-1 ps-6">
          {event.captionsAvailable
            ? t("captionsHint", { minutes: event.captionLimitMinutes ?? 180 })
            : t("captionsOff")}
        </p>
        {event.captionsAvailable && <PriceTag what="captions" className="ps-6 mt-0.5" />}
      </div>
      {err && <p className="text-[12.5px] text-error" role="alert">{err}</p>}
    </div>
  );
}

// vm_livesession: used until the server's list arrives, the same as the server's.
const SESSION_FALLBACK = [15, 30, 45, 60, 90, 120, 180];
const MAX_SESSION_FALLBACK = 210;
const DEFAULT_MINUTES = 60;
const VIEWER_FALLBACK = [10, 25, 50, 100];

/** How long the event runs, picked before going live, with its price when live events cost something. */
function SessionLength({ minutes, onChange, choices, max, disabled, viewers, onViewers, viewerChoices }: {
  minutes: number; onChange: (m: number) => void; choices: number[]; max: number; disabled?: boolean;
  /** vm_liveviewers: the viewer limit, priced per viewer minute */
  viewers: number; onViewers: (v: number) => void; viewerChoices: number[];
}) {
  const t = useTranslations("live");
  const money = useMoney();
  const c = useCredits();
  const per = c.costOf("live");
  const total = per != null ? Math.ceil(per * minutes * viewers) : null;
  const short = total != null && c.available != null && c.available < total;
  return (
    <fieldset disabled={disabled} data-session-length>
      <legend className="text-[13px] font-medium text-paper mb-2">{t("length")}</legend>
      <div className="flex flex-wrap gap-2">
        {choices.map((m) => (
          <label key={m} className={clsx("h-9 px-3 rounded-md border inline-flex items-center cursor-pointer text-[13.5px]", minutes === m ? "border-paper bg-slate-2 text-paper" : "border-rule text-paper-2 hover:border-rule-lit")}>
            <input type="radio" name="live-length" className="sr-only" checked={minutes === m} onChange={() => onChange(m)} />
            <span className="tc">{t("minutesShort", { minutes: m })}</span>
          </label>
        ))}
      </div>
      <p className="text-[12.5px] text-dim mt-2">{t("lengthHint", { max })}</p>
      <p className="text-[13px] font-medium text-paper mt-4 mb-2" id="live-viewers-label">{t("viewers")}</p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-labelledby="live-viewers-label" data-viewer-limit>
        {viewerChoices.map((v) => (
          <label key={v} className={clsx("h-9 px-3 rounded-md border inline-flex items-center cursor-pointer text-[13.5px]", viewers === v ? "border-paper bg-slate-2 text-paper" : "border-rule text-paper-2 hover:border-rule-lit")}>
            <input type="radio" name="live-viewers" className="sr-only" checked={viewers === v} onChange={() => onViewers(v)} />
            <span className="tc">{v}</span>
          </label>
        ))}
      </div>
      <p className="text-[12.5px] text-dim mt-2">{t("viewersHint")}</p>
      {per != null && total != null && (
        <p className={clsx("text-[12px] mt-1", short ? "text-warn" : "text-dim")} data-price-tag="live">
          {t("livePrice", { price: inline(money(per)), total: inline(money(total)), minutes, viewers })}
          {short && <> <AddCreditsLink /></>}
        </p>
      )}
    </fieldset>
  );
}

/** Time left, a warning near the end, and adding time once. */
function SessionClock({ event, left, onExtended }: { event: LiveEventInfo; left: number; onExtended: (e: LiveEventInfo) => void }) {
  const t = useTranslations("live");
  const f = useFormat();
  const money = useMoney();
  const c = useCredits();
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<{ text: string; credits: boolean; code?: string } | null>(null);
  const [added, setAdded] = useState<number | null>(null);
  if (!event.endsAt) return null;
  const at = f.date(event.endsAt, { timeStyle: "short" });
  const mins = Math.ceil(left / 60_000);
  const warn = left <= 10 * 60_000;
  const choices = event.extendChoices ?? [];
  const per = c.costOf("live");
  const add = async (m: number) => {
    setBusy(m); setErr(null);
    try { const r = await extendLive(event.id, m); setAdded(m); onExtended(r.event); }
    catch (x) { setErr({ text: x instanceof ApiError ? x.message : t("addFailed"), credits: x instanceof ApiError && isNoCredits(x.code), code: x instanceof ApiError ? x.code : undefined }); }
    finally { setBusy(null); }
  };
  return (
    <div className={clsx("rounded-md border px-3.5 py-2.5 space-y-2", warn ? "border-warn/50 bg-warn/5" : "border-rule")} data-session-clock>
      <p className="flex items-center gap-3 flex-wrap text-[13.5px]">
        <span className={clsx("tc", warn ? "text-warn" : "text-paper")} data-time-left>{t("timeLeft", { time: clock(left / 1000) })}</span>
        <span className="text-dim">{t("endsAt", { time: at })}</span>
      </p>
      {warn && left > 0 && <p className="text-[13px] text-warn" role="status" data-session-warning>{t("warnLeft", { minutes: Math.max(1, mins), time: at })}</p>}
      {added != null && !warn && <p className="text-[13px] text-paper-2" role="status">{t("added", { minutes: added, time: at })}</p>}
      {choices.length > 0 && left > 0 && (
        <div className="flex items-center gap-2 flex-wrap" data-extend>
          <span className="text-[13px] text-paper-2">{t("addTime")}</span>
          {choices.map((m) => (
            <button key={m} onClick={() => void add(m)} disabled={busy != null} className="btn btn-ghost h-8 px-3 text-[13px]">
              {busy === m ? t("adding") : t("addMinutes", { minutes: m })}
            </button>
          ))}
          {per != null && <span className="text-[12px] text-dim">{t("addPrice", { price: inline(money(per * (event.viewerLimit ?? 1))) })}</span>}
        </div>
      )}
      {err && <p className="text-[12.5px] text-error" role="alert">{err.text}{err.credits && <> <AddCreditsLink code={err.code} /></>}</p>}
    </div>
  );
}

const clock = (sec: number) => {
  const s = Math.max(0, Math.floor(sec)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Phase =
  | { at: "setup" }
  | { at: "starting" }
  | { at: "live" }
  | { at: "ending" }
  | { at: "done"; file: File | null; url: string | null; seconds: number }
  | { at: "upload"; file: File }
  | { at: "uploaded"; videoId: string };

function reason(err: any, source: Source, t: T): string {
  const name = String(err?.name ?? "");
  if (name === "NotAllowedError") return source === "screen" ? t("why.screenDenied") : t("why.cameraDenied");
  if (name === "NotFoundError") return t("why.notFound");
  if (name === "NotReadableError") return t("why.busy");
  if (err instanceof ApiError) return err.message;
  return t("why.other", { reason: localize(err?.message) ?? t("why.unknown") });
}

export function LiveStudio({ id }: { id: string }) {
  const t = useTranslations("live");
  const tc = useTranslations("common");
  const { data, refetch } = useQuery({ queryKey: ["live", id], queryFn: () => getLiveEvent(id) });
  const event: LiveEventInfo | undefined = data?.event;
  // vm_livesession
  const { data: cfg } = useQuery({ queryKey: ["live-config"], queryFn: getLiveConfig, staleTime: 300_000 });
  const [minutes, setMinutes] = useState(DEFAULT_MINUTES);
  // vm_liveviewers: the viewer limit, 25 unless the server offers fewer
  const viewerChoices = cfg?.viewerChoices?.length ? cfg.viewerChoices : VIEWER_FALLBACK;
  const [viewersPick, setViewersPick] = useState<number | null>(null);
  const viewerLimit = viewersPick ?? (viewerChoices.includes(25) ? 25 : viewerChoices[0]);
  const [viewerMins, setViewerMins] = useState<number | null>(null);
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => { if (event?.endsAt) setEndsAt(event.endsAt); }, [event?.endsAt]);

  const [source, setSource] = useState<Source>("camera");
  const [mic, setMic] = useState(true);
  const [restream, setRestream] = useState<string[]>([""]);
  const [phase, setPhase] = useState<Phase>({ at: "setup" });
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [viewers, setViewers] = useState(0);
  const [support, setSupport] = useState<ReturnType<typeof canRecord> | null>(null);
  useEffect(() => { setSupport(canRecord()); }, []);

  const room = useRef<Room | null>(null);
  // vm_stage: the room as state, for the speakers' pictures
  const [rm, setRm] = useState<Room | null>(null);
  const hostLabel = data?.event ? data.event.hostName ?? `${data.event.wallet.slice(0, 6)}...${data.event.wallet.slice(-4)}` : "";
  const { tiles } = useTiles(rm, hostLabel);
  const bus = useRef(new EventTarget());
  const feed = useRef<(() => void) | null>(null);
  const [capState, setCapState] = useState<{ on: boolean; text: string; note: string | null; credits?: boolean }>({ on: false, text: "", note: null });
  const [capTry, setCapTry] = useState(0);
  const inputs = useRef<Inputs | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const parts = useRef<Blob[]>([]);
  const since = useRef(0);
  const preview = useRef<HTMLVideoElement>(null);
  const watchUrl = typeof window === "undefined" ? `/live/${id}` : `${window.location.origin}/live/${id}`;

  const live = phase.at === "live" || phase.at === "starting" || phase.at === "ending";
  const unsaved = live || phase.at === "done";
  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  useEffect(() => {
    if (phase.at !== "live") return;
    const t = setInterval(() => { setElapsed((performance.now() - since.current) / 1000); setNowMs(Date.now()); }, 500);
    const look = () => liveStats(id).then((x) => {
      setViewers(x.viewers);
      if (x.endsAt) setEndsAt(x.endsAt);
      if (x.viewerMinutes != null) setViewerMins(x.viewerMinutes);
      // vm_livesession: the server ended it (its end time, or an admin): stop here too.
      if (x.status === "ended") setServerEnded(true);
    }).catch(() => {});
    const s = setInterval(look, 10_000);
    void look();
    return () => { clearInterval(t); clearInterval(s); };
  }, [phase, id]);
  const [serverEnded, setServerEnded] = useState(false);

  useEffect(() => {
    if (phase.at === "live" && preview.current && inputs.current && !preview.current.srcObject) {
      preview.current.srcObject = inputs.current.preview; preview.current.play().catch(() => {});
    }
  }, [phase]);

  const stopFeed = () => { feed.current?.(); feed.current = null; };
  const cleanup = async () => {
    stopFeed();
    await room.current?.disconnect().catch(() => {}); room.current = null; setRm(null);
    document.querySelectorAll("[data-stage-audio]").forEach((el) => el.remove());
    inputs.current?.stop(); inputs.current = null;
  };
  useEffect(() => () => { void cleanup(); }, []);

  const stopRecording = async (): Promise<File | null> => {
    const r = rec.current; rec.current = null;
    if (!r) return null;
    // A recorder that already stopped by itself (its tracks ended) still holds what it recorded.
    if (r.state !== "inactive") await new Promise<void>((res) => { r.addEventListener("stop", () => res(), { once: true }); r.stop(); });
    const type = r.mimeType || "video/webm";
    let blob = new Blob(parts.current, { type }); parts.current = [];
    if (!blob.size) return null;
    if (type.startsWith("video/webm")) blob = await fixWebmDuration(blob, Math.round(((performance.now() - since.current) / 1000) * 1000));
    const ext = type.startsWith("video/mp4") ? ".mp4" : ".webm";
    return new File([blob], `live-${id.slice(0, 8)}${ext}`, { type: type.split(";")[0] });
  };

  // vm_livesession: the end time, the server and the host can all end the event at about the
  // same moment. Only the first call ends it; a second would find no recording and replace it.
  const ending = useRef(false);
  const end = useCallback(async (why?: string) => {
    if (ending.current) return;
    ending.current = true;
    setPhase({ at: "ending" });
    const seconds = (performance.now() - since.current) / 1000;
    const file = await stopRecording();
    // Leave the room first, then close it for the viewers.
    await cleanup();
    await endLive(id).catch(() => {});
    if (why) setNote(why);
    await refetch();
    setPhase({ at: "done", file, url: file ? URL.createObjectURL(file) : null, seconds });
  }, [id, refetch]);

  // vm_livechat: captions run while live and switched on.
  const wantCaptions = phase.at === "live" && !!event?.captions && !!event?.captionsAvailable;
  useEffect(() => {
    if (!wantCaptions) { if (feed.current) { stopFeed(); setCapState((c) => ({ ...c, on: false })); } return; }
    if (feed.current) return;
    const track = inputs.current?.stream.getAudioTracks()[0];
    if (!track) { setCapState({ on: false, text: "", note: t("capNeedSound") }); return; }
    let cancelled = false;
    (async () => {
      try {
        const url = await liveCaptionsSocket(id);
        if (cancelled) return;
        const stop = await startCaptionFeed(track, url, (m) => {
          if (m.type === "ready") setCapState({ on: true, text: "", note: null });
          else if (m.type === "partial" || m.type === "final") setCapState((c) => ({ ...c, on: true, text: m.text }));
          else if (m.type === "warning") setCapState((c) => ({ ...c, note: localize(m.message) ?? null }));
          else if (m.type === "stopped") { feed.current = null; setCapState({ on: false, text: "", note: m.reason === "off" || m.reason === "ended" ? null : localize(m.message) ?? t("capStopped"), credits: m.reason === "credits" }); }
          else if (m.type === "closed") { feed.current = null; setCapState((c) => ({ on: false, text: "", note: c.note ?? t("capClosed") })); }
        });
        if (cancelled) stop(); else feed.current = stop;
      } catch (e) {
        if (!cancelled) setCapState({ on: false, text: "", note: e instanceof ApiError ? e.message : localize((e as Error)?.message) || t("capCouldNot") });
      }
    })();
    return () => { cancelled = true; };
  }, [wantCaptions, id, capTry, t]);

  // vm_livesession: the event stops at its end time. Events from before Part 19 have none and
  // stop at the longest recording allowed, as before.
  const left = endsAt ? Math.max(0, endsAt - nowMs) : null;
  useEffect(() => {
    if (phase.at !== "live") return;
    if (left !== null && left <= 0) void end(t("reachedLength"));
    else if (serverEnded) void end(t("endedOnServer"));
    else if (left === null && elapsed >= MAX_SECONDS) void end(t("reachedLongest"));
  }, [elapsed, left, serverEnded, phase, end, t]);

  const goLive = async () => {
    setErr(null); setNote(null); setNoCredits(null);
    const type = pickType();
    if (!type) { setErr(t("noRecorder")); return; }
    let ins: Inputs;
    try { ins = await openInputs(source, { mic, systemAudio: source === "screen" }); }
    catch (e) { setErr(reason(e, source, t)); return; }
    inputs.current = ins;
    setPhase({ at: "starting" });
    try {
      const { url, token } = await liveHostToken(id, viewerLimit);
      // vm_livesession: the camera and microphone belong to this page (they are also being recorded).
      // When the server closes the room at the end time, LiveKit must not stop them, or the recording stops too.
      const r = new Room({ adaptiveStream: false, dynacast: true, stopLocalTrackOnUnpublish: false });
      room.current = r;
      r.on(RoomEvent.DataReceived, (payload, _p, _k, topic) => {
        if (topic !== "chat" && topic !== "reactions" && topic !== "stage") return;
        try { bus.current.dispatchEvent(new CustomEvent(topic === "reactions" ? "reaction" : topic ?? "", { detail: JSON.parse(new TextDecoder().decode(payload)) })); } catch { /* not ours */ }
      });
      // vm_stage: the speakers' voices play here; their pictures are drawn by StageGrid
      r.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind !== Track.Kind.Audio) return;
        const el = track.attach(); el.setAttribute("data-stage-audio", ""); document.body.appendChild(el);
      });
      r.on(RoomEvent.TrackUnsubscribed, (track) => { if (track.kind === Track.Kind.Audio) track.detach().forEach((el) => el.remove()); });
      await r.connect(url, token);
      setRm(r);
      const [video] = ins.stream.getVideoTracks();
      const [audio] = ins.stream.getAudioTracks();
      await r.localParticipant.publishTrack(video, { source: source === "screen" ? Track.Source.ScreenShare : Track.Source.Camera, name: source, simulcast: true });
      if (audio) await r.localParticipant.publishTrack(audio, { source: Track.Source.Microphone, name: "sound" });
      // The live server may take a moment to list the tracks.
      const urls = restream.map((u) => u.trim()).filter(Boolean);
      let started: Awaited<ReturnType<typeof startLive>> | null = null;
      for (let i = 0; i < 8 && !started; i++) {
        try { started = await startLive(id, urls, minutes); }
        catch (e) { if (e instanceof ApiError && e.code === "not_publishing" && i < 7) await sleep(1000); else throw e; }
      }
      if (started?.restreamError) setNote(localize(started.restreamError));
      if (started?.event.endsAt) setEndsAt(started.event.endsAt);
      setServerEnded(false);
      // Record what is sent, from the same tracks.
      parts.current = [];
      const mr = new MediaRecorder(ins.stream, { mimeType: type, videoBitsPerSecond: VIDEO_BITS, audioBitsPerSecond: AUDIO_BITS });
      mr.ondataavailable = (e) => { if (e.data.size) parts.current.push(e.data); };
      mr.start(1000);
      rec.current = mr;
      since.current = performance.now();
      ins.onEnded(() => { void end(t("sharingStopped")); });
      setElapsed(0);
      ending.current = false;
      setPhase({ at: "live" });
      await refetch();
    } catch (e) {
      void cleanup();
      setErr(reason(e, source, t));
      setNoCredits(e instanceof ApiError && isNoCredits(e.code) ? e.code ?? "not_enough_credits" : null);
      setPhase({ at: "setup" });
    }
  };
  // vm_spendcap: the refusal's code, so the link says add credits or raise the limit
  const [noCredits, setNoCredits] = useState<string | null>(null);

  const onUploaded = useCallback((videoId: string) => {
    linkLiveRecording(id, videoId).then(() => refetch()).catch(() => {});
    setPhase({ at: "uploaded", videoId });
  }, [id, refetch]);

  if (!event) return <p className="text-[14px] text-dim">{tc("loading")}</p>;

  // vm_share: the watch link with X, WhatsApp, Telegram, Email and the share sheet, and the QR code
  const shareBox = (
    <div className="space-y-3">
      <p className="text-[13px] text-dim">{t("watchHere")}</p>
      <LiveShareLinks id={id} title={event.title} host={event.hostName ?? `${event.wallet.slice(0, 6)}...${event.wallet.slice(-4)}`} />
      <QrCode text={watchUrl} label={t("qrLabel")} className="w-[120px] h-[120px] rounded-sm" />
    </div>
  );

  if (phase.at === "upload") {
    return (
      <Suspense fallback={<div className="h-48 scan rounded-lg" />}>
        <UploadZone initialFile={phase.file} initialTitle={event.title} onUploaded={onUploaded} />
      </Suspense>
    );
  }
  if (phase.at === "uploaded") {
    return (
      <div className="space-y-2 max-w-[640px]">
        <p className="text-[15px] text-paper">{t("inLibrary")}</p>
        <p className="text-[13.5px] text-dim">{t("pointsToIt")}</p>
        <a href={`/video/${phase.videoId}`} className="btn btn-ghost h-9 px-3.5 inline-flex items-center mt-2">{t("openVideo")}</a>
      </div>
    );
  }
  if (phase.at === "done" || (event.status === "ended" && phase.at === "setup")) {
    const d = phase.at === "done" ? phase : null;
    return (
      <div className="space-y-4 max-w-[860px]">
        <p className="text-[15px] text-paper" data-live-ended>{d ? t("endedAfter", { time: clock(d.seconds) }) : t("ended")}</p>
        {note && <p className="text-[13.5px] text-dim">{note}</p>}
        {d?.file && d.url ? (
          <>
            <video src={d.url} controls playsInline className="w-full aspect-video rounded-md bg-black" aria-label={t("theRecording")} />
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => setPhase({ at: "upload", file: d.file! })} className="btn btn-signal h-9 px-4">{t("uploadRecording")}</button>
              <a href={d.url} download={d.file.name} className="btn btn-ghost h-9 px-3.5 inline-flex items-center">{t("download")}</a>
            </div>
            <p className="text-[13px] text-dim">{t("onlyHere")}</p>
          </>
        ) : event.videoId ? (
          <a href={`/video/${event.videoId}`} className="btn btn-ghost h-9 px-3.5 inline-flex items-center">{t("openRecording")}</a>
        ) : (
          <p className="text-[13.5px] text-dim">{t("noRecording")}</p>
        )}
      </div>
    );
  }

  if (live) {
    return (
      <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-6 items-start">
        <div className="space-y-4 min-w-0">
          <div className="relative">
            <video ref={preview} muted playsInline className="w-full aspect-video rounded-md bg-black object-contain" aria-label={t("whatViewersSee")} />
            {/* vm_stage: with speakers on stage, the 2 by 2 view over the preview */}
            {phase.at === "live" && tiles.length > 1 && <StageGrid tiles={tiles} label={t("whatViewersSee")} />}
            {/* vm_reactions: what viewers send, over the host's picture */}
            {phase.at === "live" && <ReactionLayer bus={bus.current} />}
            <span className="absolute start-3 top-3 flex items-center gap-2 bg-black/70 rounded px-2.5 h-7" data-live-badge>
              <span className={clsx("w-2.5 h-2.5 rounded-full", phase.at === "live" ? "bg-error animate-pulse" : "bg-dim")} />
              <span className="tc text-paper">{phase.at === "starting" ? t("connecting") : phase.at === "ending" ? t("ending") : t("liveAt", { time: clock(elapsed) })}</span>
            </span>
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <button
              onClick={() => { if (window.confirm(t("confirmEnd"))) void end(); }}
              disabled={phase.at !== "live"}
              className="btn btn-signal h-9 px-4"
            >
              {t("endLive")}
            </button>
            <span className="tc" data-viewers>{event.viewerLimit ? t("watchingOf", { count: viewers, limit: event.viewerLimit }) : t("watching", { count: viewers })}</span>
            {event.viewerLimit != null && viewerMins != null && <span className="tc text-dim" data-viewer-minutes>{t("viewerMinutes", { minutes: viewerMins })}</span>}
            {event.restreaming && <span className="tc">{t("restreaming")}</span>}
          </div>
          {note && <p className="text-[13px] text-warn" role="status">{note}</p>}
          {phase.at === "live" && left !== null && (
            <SessionClock event={{ ...event, endsAt }} left={left} onExtended={(e) => { if (e.endsAt) setEndsAt(e.endsAt); void refetch(); }} />
          )}
          {event.captions && event.captionsAvailable && (
            <p className="text-[13px] text-paper-2" data-captions-state>
              {capState.on ? <>{t("capOn")}{capState.text ? <span className="text-dim">: <span dir="auto">{capState.text.slice(-120)}</span></span> : <span className="text-dim">{t("capListening")}</span>}</> : capState.note ?? t("capStarting")}
              {!capState.on && capState.credits && <> <AddCreditsLink /></>}
              {!capState.on && capState.note && !feed.current && (
                <button onClick={() => { setCapState({ on: false, text: "", note: null }); setCapTry((n) => n + 1); }} className="ms-2 text-paper-2 underline underline-offset-2 hover:text-paper no-min">{tc("tryAgain")}</button>
              )}
            </p>
          )}
          <p className="text-[13px] text-dim">{t("alsoRecording")}</p>
          <div className="panel p-4"><LiveSettings event={event} onSaved={() => void refetch()} /></div>
        </div>
        <aside className="space-y-4">
          {phase.at === "live" && <div className="panel p-4"><StagePanel eventId={id} bus={bus.current} live /></div>}
          <div className="panel p-4">{shareBox}</div>
          <LiveChat eventId={id} status={event.status} chatMode={event.chatMode} owner bus={bus.current} className="h-[460px]" />
        </aside>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[640px]">
      {support && !support.recorder && <p className="text-[13.5px] text-error">{t("unsupported")}</p>}
      <fieldset>
        <legend className="text-[13px] font-medium text-paper mb-2">{t("show")}</legend>
        <div className="grid sm:grid-cols-2 gap-3">
          {([["camera", t("camera"), Camera], ["screen", t("screen"), Monitor]] as const).map(([v, label, Icon]) => (
            <label key={v} className={clsx("flex items-center gap-3 p-3.5 rounded-md border cursor-pointer", source === v ? "border-paper bg-slate-2" : "border-rule hover:border-rule-lit")}>
              <input type="radio" name="live-source" className="sr-only" checked={source === v} onChange={() => setSource(v)} />
              <Icon size={18} className="text-paper-2" /> <span className="text-[14px] text-paper">{label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex items-center gap-2.5 text-[13.5px] text-paper-2 cursor-pointer">
        <input type="checkbox" checked={mic} onChange={(e) => setMic(e.target.checked)} /> {t("mic")}
      </label>

      <SessionLength minutes={minutes} onChange={setMinutes} choices={cfg?.sessionMinutes ?? SESSION_FALLBACK} max={cfg?.maxSessionMinutes ?? MAX_SESSION_FALLBACK}
        viewers={viewerLimit} onViewers={setViewersPick} viewerChoices={viewerChoices} />

      <LiveSettings event={event} onSaved={() => void refetch()} />

      <fieldset className="space-y-2">
        <legend className="text-[13px] font-medium text-paper">{t("alsoStream")}</legend>
        <p className="text-[12.5px] text-dim">{t("alsoStreamHint")}</p>
        {restream.map((u, i) => (
          <input
            key={i} value={u} type="password" autoComplete="off" spellCheck={false}
            onChange={(e) => setRestream((r) => r.map((x, j) => (j === i ? e.target.value : x)))}
            placeholder="rtmp://a.rtmp.youtube.com/live2/your-stream-key"
            aria-label={t("restreamLabel", { n: i + 1 })}
            dir="ltr"
            className="w-full h-9 px-2.5 text-[13px] tc"
          />
        ))}
        {restream.length < 3 && (
          <button onClick={() => setRestream((r) => [...r, ""])} className="text-[13px] text-paper-2 underline underline-offset-2 hover:text-paper no-min">{t("addAnother")}</button>
        )}
      </fieldset>

      {shareBox}

      <div className="space-y-2">
        <button onClick={() => void goLive()} disabled={!support?.recorder} className="btn btn-signal h-10 px-5">{t("goLive")}</button>
        {err && <p className="text-[13.5px] text-error" role="alert">{err}{noCredits && <> <AddCreditsLink code={noCredits} /></>}</p>}
      </div>
    </div>
  );
}
