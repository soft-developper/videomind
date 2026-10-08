"use client";
// vm_present: Presentation Mode. A projector view of one video for a room:
// the video large, captions large enough to read from the back, the
// chapter playing, and a QR code that opens the shared page at the moment
// on the screen, so the room can follow on their phones.
//
// Keys (a presentation clicker sends Page Up and Page Down):
//   Space or K      play or pause
//   Left, Right     back or forward 10 seconds (also J and L)
//   Page Down, Down next chapter (also N)
//   Page Up, Up     start of this chapter, or the one before (also P)
//   Q code, C captions, F full screen, M sound, ? the list of keys
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import { ArrowLeft, Captions, CaptionsOff, Maximize, Minimize, Pause, Play, QrCode as QrIcon, Keyboard } from "lucide-react";
import { getVideo, getCaptions, momentFromUrl, ApiError } from "@/lib/api";
import { QrCode } from "@/components/share/QrCode";
import { sharedLink } from "@/lib/qr";

interface Cue { start: number; end: number; text: string }

/** 00:01:02.500 or 01:02.500 -> seconds */
function cueTime(s: string): number {
  const p = s.trim().split(":").map(Number);
  return p.reduce((a, x) => a * 60 + x, 0);
}
/** The cues of a WebVTT file, in order. */
function parseVtt(vtt: string): Cue[] {
  const out: Cue[] = [];
  for (const block of vtt.replace(/\r/g, "").split(/\n{2,}/)) {
    const lines = block.split("\n");
    const i = lines.findIndex((l) => l.includes("-->"));
    if (i < 0) continue;
    const [a, b] = lines[i].split("-->");
    const start = cueTime(a), end = cueTime(b.trim().split(/\s+/)[0]);
    const text = lines.slice(i + 1).join("\n").replace(/<[^>]+>/g, "").trim();
    if (Number.isFinite(start) && Number.isFinite(end) && text) out.push({ start, end, text });
  }
  return out;
}

const clock = (sec: number) => {
  const s = Math.max(0, Math.floor(sec)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
};
/** The code points at the moment on screen, in steps of 10 seconds so it does not change all the time. */
const QR_STEP = 10;

const KEYS: Array<[string, string]> = [
  ["Space or K", "Play or pause"],
  ["Left or J", "Back 10 seconds"],
  ["Right or L", "Forward 10 seconds"],
  ["Page Down, Down or N", "Next chapter"],
  ["Page Up, Up or P", "Start of this chapter, or the one before"],
  ["Q", "Show or hide the code"],
  ["C", "Captions on or off"],
  ["F", "Full screen"],
  ["M", "Sound on or off"],
  ["?", "This list"],
];

export default function Present({ params }: { params: { id: string } }) {
  const { data: video, isLoading, error } = useQuery({
    queryKey: ["present-video", params.id],
    queryFn: () => getVideo(params.id),
    retry: (count, e) => !(e instanceof ApiError && (e.status === 403 || e.status === 404)) && count < 1,
  });
  const hasSpeech = video?.status === "ready" && (video.ai?.transcript?.length ?? 0) > 0;
  const { data: vtt } = useQuery({
    queryKey: ["captions", params.id],
    queryFn: () => getCaptions(params.id),
    enabled: hasSpeech, staleTime: Infinity, retry: false,
  });
  const cues = useMemo(() => parseVtt(vtt ?? ""), [vtt]);
  const searchParams = useSearchParams();
  const [startAt] = useState(() => momentFromUrl(searchParams.get("t")));

  const v = useRef<HTMLVideoElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [showQr, setShowQr] = useState(true);
  const [cc, setCc] = useState(true);
  const [full, setFull] = useState(false);
  const [help, setHelp] = useState(false);
  const [failed, setFailed] = useState(false);
  // While playing, the controls step aside after a few still seconds. The code and captions stay.
  const [idle, setIdle] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout>>();
  const wake = useCallback(() => {
    setIdle(false);
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setIdle(true), 2500);
  }, []);
  useEffect(() => () => clearTimeout(idleTimer.current), []);

  const marks = useMemo(
    () => (video?.ai?.chapters ?? []).slice().sort((a, b) => a.startSeconds - b.startSeconds),
    [video?.ai?.chapters],
  );
  let ch = -1;
  for (let i = 0; i < marks.length && marks[i].startSeconds <= t + 0.25; i++) ch = i;
  const cue = cc ? cues.find((c) => c.start <= t && t < c.end) : undefined;
  const length = video?.meta?.durationSeconds || dur;

  const jump = useCallback((s: number) => {
    const el = v.current; if (!el) return;
    const end = isFinite(el.duration) ? el.duration : Infinity;
    el.currentTime = Math.min(Math.max(0, s), end);
    setT(el.currentTime);
  }, []);
  const toggle = useCallback(() => {
    const el = v.current; if (!el) return;
    if (el.paused) el.play().catch(() => {}); else el.pause();
  }, []);
  const prevChapter = useCallback(() => {
    if (ch < 0) return jump(0);
    jump(t - marks[ch].startSeconds > 3 || ch === 0 ? marks[ch].startSeconds : marks[ch - 1].startSeconds);
  }, [ch, t, marks, jump]);
  const nextChapter = useCallback(() => { if (ch + 1 < marks.length) jump(marks[ch + 1].startSeconds); }, [ch, marks, jump]);
  const fullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else stage.current?.requestFullscreen?.().catch(() => {});
  }, []);
  useEffect(() => {
    const f = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", f);
    return () => document.removeEventListener("fullscreenchange", f);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const k = e.key;
      const act: Record<string, () => void> = {
        " ": toggle, k: toggle, K: toggle,
        ArrowLeft: () => jump(t - 10), j: () => jump(t - 10), J: () => jump(t - 10),
        ArrowRight: () => jump(t + 10), l: () => jump(t + 10), L: () => jump(t + 10),
        PageDown: nextChapter, ArrowDown: nextChapter, n: nextChapter, N: nextChapter,
        PageUp: prevChapter, ArrowUp: prevChapter, p: prevChapter, P: prevChapter,
        q: () => setShowQr((x) => !x), Q: () => setShowQr((x) => !x),
        c: () => setCc((x) => !x), C: () => setCc((x) => !x),
        f: fullscreen, F: fullscreen,
        m: () => setMuted((x) => !x), M: () => setMuted((x) => !x),
        "?": () => setHelp((x) => !x),
        Escape: () => setHelp(false),
      };
      const run = act[k];
      if (!run) return;
      e.preventDefault();   // no page scrolling, and Space does not also press a focused button
      run();
      wake();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [t, toggle, jump, nextChapter, prevChapter, fullscreen, wake]);

  useEffect(() => { if (v.current) v.current.muted = muted; }, [muted]);

  if (isLoading) {
    return <div className="fixed inset-0 bg-black flex items-center justify-center text-dim text-[15px]">Loading the video</div>;
  }
  const isPrivateErr = !video && error instanceof ApiError && error.code === "private";
  if (!video || video.status !== "ready") {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center px-6">
        <div className="text-center space-y-3 max-w-sm">
          <p className="font-display text-[22px] text-paper">
            {isPrivateErr ? "This video is private" : !video ? "This video was not found" : "This video is still being processed"}
          </p>
          <p className="text-[14px] text-dim leading-relaxed">
            {isPrivateErr ? "Only its owner can present it. Sign in with the owner's wallet first." : !video ? "It may have been deleted, or the link is wrong." : "Present it once it is ready."}
          </p>
          <Link href="/" className="btn btn-ghost h-9 px-3.5 inline-flex items-center mt-2">Open VideoMind</Link>
        </div>
      </div>
    );
  }

  const shareable = (video.visibility ?? "unlisted") !== "private";
  const qrAt = Math.floor(t / QR_STEP) * QR_STEP;
  const link = sharedLink(params.id, qrAt >= QR_STEP ? qrAt : null);
  const shortLink = `${typeof window === "undefined" ? "" : window.location.host}/v/${params.id.slice(0, 8)}…`;
  const chrome = !idle || !playing;

  return (
    <div
      ref={stage}
      onMouseMove={wake}
      className={clsx("fixed inset-0 bg-black text-paper flex flex-col", !chrome && "cursor-none")}
      data-present
    >
      {/* Top bar */}
      <div className={clsx("h-12 shrink-0 flex items-center gap-3 px-4 transition-opacity duration-300", chrome ? "opacity-100" : "opacity-0")}>
        <Link href={video.isOwner ? `/video/${params.id}` : `/v/${params.id}`} className="flex items-center gap-1.5 text-[13px] text-dim hover:text-paper no-min" aria-label="Leave Presentation Mode">
          <ArrowLeft size={14} /> Exit
        </Link>
        <p className="flex-1 min-w-0 truncate text-[14px] text-paper-2">{video.title}</p>
        <div className="flex items-center gap-1">
          {[
            { on: showQr, act: () => setShowQr((x) => !x), label: showQr ? "Hide the code (Q)" : "Show the code (Q)", icon: <QrIcon size={15} /> },
            { on: cc, act: () => setCc((x) => !x), label: cc ? "Captions off (C)" : "Captions on (C)", icon: cc ? <Captions size={15} /> : <CaptionsOff size={15} /> },
            { on: full, act: fullscreen, label: full ? "Leave full screen (F)" : "Full screen (F)", icon: full ? <Minimize size={15} /> : <Maximize size={15} /> },
            { on: help, act: () => setHelp((x) => !x), label: "Keys (?)", icon: <Keyboard size={15} /> },
          ].map((b) => (
            <button
              key={b.label}
              onClick={b.act}
              aria-label={b.label}
              title={b.label}
              aria-pressed={b.on}
              className={clsx("w-9 h-9 flex items-center justify-center rounded hover:bg-white/10 no-min", b.on ? "text-paper" : "text-dim")}
            >
              {b.icon}
            </button>
          ))}
        </div>
      </div>

      {/* Stage */}
      <div className="flex-1 min-h-0 flex flex-col landscape:flex-row gap-5 px-5 pb-3">
        <div className="flex-1 min-w-0 min-h-0 flex flex-col">
          <div className="flex-1 min-h-0 relative">
            <video
              ref={v}
              src={video.streamUrl ?? undefined}
              poster={video.posterUrl ?? undefined}
              playsInline
              preload="metadata"
              onClick={toggle}
              onLoadedMetadata={(e) => {
                const el = e.currentTarget;
                setDur(isFinite(el.duration) ? el.duration : 0);
                if (startAt && startAt < el.duration) { el.currentTime = startAt; setT(startAt); }
              }}
              onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
              onPlay={() => { setPlaying(true); wake(); }}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
              onError={() => setFailed(true)}
              className="absolute inset-0 w-full h-full object-contain bg-black"
            />
            {failed && (
              <p className="absolute inset-0 flex items-center justify-center text-center px-6 text-[16px] text-dim">
                This browser cannot play the file. Try another browser, or present it from the computer it was made on.
              </p>
            )}
            {!playing && !failed && (
              <button
                onClick={toggle}
                aria-label="Play"
                className="absolute inset-0 m-auto w-20 h-20 rounded-full bg-black/60 border border-white/20 flex items-center justify-center hover:bg-black/80 no-min"
              >
                <Play size={30} className="ml-1" />
              </button>
            )}
          </div>
          {/* Captions, large, under the picture so they never cover a slide */}
          {cc && hasSpeech && (
            <p
              aria-live="off"
              data-present-caption
              className="shrink-0 min-h-[2.5em] pt-3 text-center font-medium leading-[1.2] whitespace-pre-line text-[clamp(18px,2.4vw,42px)] text-paper"
            >
              {cue?.text ?? ""}
            </p>
          )}
        </div>

        {showQr && (
          <aside
            aria-label="Follow along"
            className="shrink-0 flex flex-col items-center justify-center gap-3 landscape:w-[clamp(170px,22vw,380px)] pb-2"
          >
            {shareable ? (
              <>
                <QrCode text={link} label="QR code that opens this video at this moment" className="w-[min(60vw,38vh)] landscape:w-full rounded-md" />
                <p className="text-[clamp(15px,1.5vw,24px)] font-semibold text-paper text-center">Scan to follow along</p>
                <p className="tc text-center break-all">{shortLink}</p>
              </>
            ) : (
              <p className="text-[clamp(14px,1.3vw,20px)] text-dim text-center leading-snug max-w-[28ch]">
                This video is private, so there is no code to scan. Make it unlisted or public to let the room follow along.
              </p>
            )}
            {ch >= 0 && (
              <div className="text-center mt-2 max-w-full">
                <p className="tc">Chapter {ch + 1} of {marks.length}</p>
                <p className="text-[clamp(14px,1.3vw,20px)] text-paper-2 leading-snug">{marks[ch].title}</p>
              </div>
            )}
          </aside>
        )}
      </div>

      {/* Bottom: play, time, chapters along the bar */}
      <div className={clsx("shrink-0 h-12 flex items-center gap-3 px-5 transition-opacity duration-300", chrome ? "opacity-100" : "opacity-0")}>
        <button onClick={toggle} aria-label={playing ? "Pause" : "Play"} className="w-9 h-9 flex items-center justify-center rounded hover:bg-white/10 no-min">
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <span className="tc w-[5.5em]">{clock(t)}</span>
        <div
          className="relative flex-1 h-[6px] rounded-full bg-white/15 cursor-pointer"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            if (length) jump(((e.clientX - r.left) / r.width) * length);
          }}
          aria-hidden
        >
          <span className="absolute inset-y-0 left-0 rounded-full bg-signal" style={{ width: `${length ? Math.min(100, (t / length) * 100) : 0}%` }} />
          {length > 0 && marks.map((m) => (
            <span key={m.startSeconds} className="absolute top-[-3px] bottom-[-3px] w-[2px] bg-black/70" style={{ left: `${(m.startSeconds / length) * 100}%` }} />
          ))}
        </div>
        <span className="tc w-[5.5em] text-right">{clock(length)}</span>
      </div>

      {help && (
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center p-6" onClick={() => setHelp(false)}>
          <div role="dialog" aria-label="Keys" className="popover p-5 w-[min(460px,100%)]" onClick={(e) => e.stopPropagation()}>
            <p className="text-[15px] font-semibold mb-3">Keys</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-1.5 text-[13.5px]">
              {KEYS.map(([k, what]) => (
                <div key={k} className="contents">
                  <dt className="tc text-paper">{k}</dt>
                  <dd className="text-paper-2">{what}</dd>
                </div>
              ))}
            </dl>
            <p className="text-[12.5px] text-dim mt-3">A presentation clicker moves between chapters.</p>
          </div>
        </div>
      )}
    </div>
  );
}
