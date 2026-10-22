"use client";
// vm_live: the viewer's side. No wallet is needed. Before the event the
// page waits and starts by itself; during it the host's picture and sound
// play here; after it the page points to the recording.
// vm_livechat: captions over the picture (on by default, can be turned
// off), the chat beside it, and after the event its transcript.
// vm_stage (Part 21b1): the host and up to three speakers share the picture,
// and a signed in viewer can raise a hand and be invited on stage.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Room, RoomEvent, Track, type RemoteTrack } from "livekit-client";
import { Volume2, Captions } from "lucide-react";
import { clsx } from "clsx";
import { getLiveEvent, liveViewerToken, getLiveCaptions, ApiError } from "@/lib/api";
import { LiveChat } from "./LiveChat";
// vm_share, vm_reactions (Part 21a)
import { LiveShareButton } from "./LiveShare";
import { ReactionBar, ReactionLayer } from "./Reactions";
import { StageGrid, HandPanel, useTiles } from "./Stage";
import { useAuth } from "@/components/layout/AuthProvider";
import { useFormat } from "@/lib/format";
// vm_lang
import { useTranslations } from "next-intl";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const clock = (sec: number) => {
  const s = Math.max(0, Math.floor(sec)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
};

export function LiveWatch({ id }: { id: string }) {
  const t = useTranslations("liveWatch");
  const tc = useTranslations("common");
  const f = useFormat();
  const { data, error, refetch } = useQuery({
    queryKey: ["live-watch", id],
    queryFn: () => getLiveEvent(id),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2,
    // Until it is live, look again every 10 seconds. After it ends, now and then for the recording.
    // vm_livesession: while live, every 60 seconds too, so a new end time or the end shows even without the room.
    refetchInterval: (q) => (q.state.data?.event.status === "scheduled" ? 10_000 : q.state.data?.event.status === "live" ? 60_000 : q.state.data?.event.status === "ended" && !q.state.data?.event.videoId ? 30_000 : false),
  });
  const event = data?.event;
  const stage = useRef<HTMLDivElement>(null);
  const [connected, setConnected] = useState(false);
  // vm_stage: the room as state, for the picture and the stage
  const [rm, setRm] = useState<Room | null>(null);
  const [canStage, setCanStage] = useState(false);
  const { signedIn, wallet } = useAuth();
  const [needsSound, setNeedsSound] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const room = useRef<Room | null>(null);
  const bus = useRef(new EventTarget());
  const [cc, setCc] = useState(true);
  const [caption, setCaption] = useState<{ done: string; now: string; at: number }>({ done: "", now: "", at: 0 });
  const [lines, setLines] = useState<Array<{ at: number; text: string }> | null>(null);
  const { tiles } = useTiles(rm, data?.event.hostName ?? (data?.event.wallet ? short(data.event.wallet) : ""));

  useEffect(() => {
    if (event?.status !== "live") return;
    let stopped = false;
    const r = new Room({ adaptiveStream: true, dynacast: true });
    room.current = r;
    // vm_stage: pictures are drawn by StageGrid; every voice (host and speakers) plays from the page.
    const attach = (track: RemoteTrack) => {
      if (track.kind !== Track.Kind.Audio) return;
      const el = track.attach();
      el.setAttribute("data-live-audio", "");
      document.body.appendChild(el);
    };
    r.on(RoomEvent.TrackSubscribed, (track) => attach(track as RemoteTrack));
    r.on(RoomEvent.TrackUnsubscribed, (track) => { if (track.kind === Track.Kind.Audio) track.detach().forEach((el) => el.remove()); });
    r.on(RoomEvent.AudioPlaybackStatusChanged, () => setNeedsSound(!r.canPlaybackAudio));
    // vm_livechat: captions, chat and settings, sent by the server into the room.
    r.on(RoomEvent.DataReceived, (payload, _p, _k, topic) => {
      let body: any; try { body = JSON.parse(new TextDecoder().decode(payload)); } catch { return; }
      if (topic === "chat") bus.current.dispatchEvent(new CustomEvent("chat", { detail: body }));
      else if (topic === "reactions") bus.current.dispatchEvent(new CustomEvent("reaction", { detail: body }));
      else if (topic === "stage") bus.current.dispatchEvent(new CustomEvent("stage", { detail: body }));
      else if (topic === "settings") void refetch();
      else if (topic === "captions" && typeof body?.text === "string") {
        setCaption((c) => body.type === "final"
          ? { done: [c.done, body.text].filter(Boolean).join(" ").slice(-160), now: "", at: Date.now() }
          : { ...c, now: body.text, at: Date.now() });
      }
    });
    r.on(RoomEvent.Disconnected, () => { setConnected(false); setRm(null); if (!stopped) void refetch(); });
    (async () => {
      try {
        const { url, token, stage: signed } = await liveViewerToken(id);
        if (stopped) return;
        await r.connect(url, token);
        setConnected(true);
        setCanStage(!!signed);
        setRm(r);
        setNeedsSound(!r.canPlaybackAudio);
      } catch (e: any) {
        if (!stopped) { setErr(e instanceof ApiError ? e.message : t("couldNotLoad")); void refetch(); }
      }
    })();
    return () => {
      stopped = true;
      r.disconnect().catch(() => {});
      document.querySelectorAll("[data-live-audio]").forEach((el) => el.remove());
      room.current = null;
      setRm(null); setCanStage(false);
    };
    // vm_stage: signing in or out joins again, as that wallet or as a guest
  }, [event?.status, id, refetch, t, wallet]);

  useEffect(() => {
    if (event?.status !== "live") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [event?.status]);

  // A caption fades after 6 seconds without new words.
  const shownCaption = Math.max(now, caption.at) - caption.at < 6000 ? [caption.done, caption.now].filter(Boolean).join(" ").slice(-160) : "";

  // After the event: what was said, from the captions.
  useEffect(() => {
    if (event?.status !== "ended" || lines) return;
    getLiveCaptions(id).then((r) => setLines(r.lines)).catch(() => setLines([]));
  }, [event?.status, id, lines]);

  if (!event) {
    const missing = error instanceof ApiError && error.status === 404;
    return (
      <div className="py-16 max-w-[46ch]">
        <h1 className="font-display text-[20px] text-paper">{missing ? t("notFound") : tc("loading")}</h1>
        {missing && <p className="text-[14px] text-dim mt-1.5">{t("wrongLink")}</p>}
      </div>
    );
  }

  const who = event.hostName ?? short(event.wallet);
  const hasVideo = tiles.some((x) => x.host && x.track);
  return (
    <div className="pt-6 grid lg:grid-cols-[minmax(0,1fr)_320px] gap-5 items-start">
    <div className="space-y-4 min-w-0">
      <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-display text-[22px] sm:text-[26px] leading-tight text-paper" dir="auto">{event.title}</h1>
        <Link href={`/u/${event.wallet}`} className="text-[13.5px] text-paper-2 hover:text-paper hover:underline underline-offset-2">{t("by", { name: who })}</Link>
        {/* vm_livesession: when the event ends by itself */}
        {event.status === "live" && event.endsAt && (
          <p className="text-[13px] text-dim mt-0.5" data-live-ends>{t("endsAt", { time: f.date(event.endsAt, { timeStyle: "short" }) })}</p>
        )}
      </div>
      <LiveShareButton id={id} title={event.title} host={who} />
      </div>

      <div ref={stage} className="relative w-full aspect-video rounded-md bg-black overflow-hidden" data-live-stage>
        {event.status === "live" && (
          <span className="absolute start-3 top-3 z-10 flex items-center gap-2 bg-black/70 rounded px-2.5 h-7">
            <span className="w-2.5 h-2.5 rounded-full bg-error animate-pulse" />
            <span className="tc text-paper" data-live-state>{event.startedAt ? t("liveAt", { time: clock((now - event.startedAt) / 1000) }) : t("live")}</span>
          </span>
        )}
        {event.status === "live" && <StageGrid tiles={tiles} label={t("picture")} />}
        {event.status === "live" && <ReactionLayer bus={bus.current} />}
        {event.status === "live" && !hasVideo && (
          <p className="absolute inset-0 flex items-center justify-center text-[14px] text-dim">{err ?? (connected ? t("waiting") : t("connecting"))}</p>
        )}
        {event.status === "scheduled" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6" data-live-state>
            <p className="text-[16px] text-paper">{t("notStarted")}</p>
            <p className="text-[13.5px] text-dim mt-1">{t("keepOpen")}</p>
          </div>
        )}
        {event.status === "ended" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 gap-3" data-live-state>
            <p className="text-[16px] text-paper">{t("ended")}</p>
            {event.videoId
              ? <Link href={`/v/${event.videoId}`} className="btn btn-signal h-9 px-4 inline-flex items-center">{t("watchRecording")}</Link>
              : <p className="text-[13.5px] text-dim">{t("recordingSoon")}</p>}
          </div>
        )}
        {event.status === "live" && cc && shownCaption && (
          <p className="absolute inset-x-0 bottom-14 z-10 mx-auto w-fit max-w-[90%] text-center bg-black/80 text-white text-[15px] sm:text-[18px] leading-snug rounded px-3 py-1.5" data-live-caption aria-live="off" dir="auto">
            {shownCaption}
          </p>
        )}
        {event.status === "live" && event.captions && (
          <button
            onClick={() => setCc((v) => !v)} aria-pressed={cc} aria-label={t("captions")}
            className={clsx("absolute start-3 bottom-3 z-10 h-9 px-3 rounded inline-flex items-center gap-1.5 text-[13px] bg-black/70", cc ? "text-paper" : "text-dim")}
          >
            <Captions size={15} /> {cc ? t("captionsOn") : t("captionsOff")}
          </button>
        )}
        {needsSound && event.status === "live" && (
          <button onClick={() => { room.current?.startAudio().then(() => setNeedsSound(false)).catch(() => {}); }} className="absolute end-3 bottom-3 z-10 btn btn-signal h-9 px-3.5 inline-flex items-center gap-1.5">
            <Volume2 size={14} /> {t("soundOn")}
          </button>
        )}
      </div>

      {event.status === "live" && <ReactionBar eventId={id} />}
      {event.status === "live" && <HandPanel eventId={id} room={rm} canStage={canStage} signedIn={signedIn} bus={bus.current} />}

      {event.status === "ended" && !!lines?.length && (
        <details className="panel px-5 py-3" data-live-transcript>
          <summary className="cursor-pointer text-[14px] text-paper">{t("whatWasSaid", { count: lines.length })}</summary>
          <ol className="mt-3 space-y-1.5 text-[13.5px] text-paper-2">
            {lines.map((l, i) => <li key={i}><span className="tc me-2">{clock(l.at / 1000)}</span><span dir="auto">{l.text}</span></li>)}
          </ol>
        </details>
      )}
    </div>
    <LiveChat eventId={id} status={event.status} chatMode={event.chatMode} owner={false} bus={bus.current} className="lg:sticky lg:top-20 h-[420px] lg:h-[calc(100vh-120px)]" />
    </div>
  );
}
