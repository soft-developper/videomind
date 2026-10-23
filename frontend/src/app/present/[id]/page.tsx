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
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import { ArrowLeft, Captions, CaptionsOff, Maximize, Minimize, Pause, Play, QrCode as QrIcon, Keyboard } from "lucide-react";
import { getVideo, momentFromUrl, ApiError } from "@/lib/api";
// vm_translate: captions and chapters in the language chosen on the video page (?lang=)
import { useVideoText } from "@/lib/useVideoText";
import { QrCode } from "@/components/share/QrCode";
import { sharedLink } from "@/lib/qr";
import { useViewCounter } from "@/lib/useViewCounter";
// vm_lang
import { useTranslations } from "next-intl";

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

/** The keys, named in the reader's language, and what each does. */
const KEYS = ["play", "back", "forward", "next", "prev", "code", "captions", "full", "sound", "list"] as const;

export default function Present(props: { params: Promise<{ id: string }> }) {
  // vm_next15: params arrive as a promise in Next 15
  const params = use(props.params);
  const t_ = useTranslations("present");
  const tv = useTranslations("videoPage");
  const tpub = useTranslations("public");
  const { data: video, isLoading, error } = useQuery({
    queryKey: ["present-video", params.id],
    queryFn: () => getVideo(params.id),
    retry: (count, e) => !(e instanceof ApiError && (e.status === 403 || e.status === 404)) && count < 1,
  });
  // vm_analytics: a room watching counts as one view (the owner presenting is not counted)
  const views = useViewCounter(video?.status === "ready" ? video.id : null);
  const hasSpeech = video?.status === "ready" && (video.ai?.transcript?.length ?? 0) > 0;
  const searchParams = useSearchParams();
  const text = useVideoText(video, { prefer: searchParams.get("lang") });
  const vtt = text.captions;
  const cues = useMemo(() => parseVtt(vtt ?? ""), [vtt]);
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
  const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const wake = useCallback(() => {
    setIdle(false);
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setIdle(true), 2500);
  }, []);
  useEffect(() => () => clearTimeout(idleTimer.current), []);

  const marks = useMemo(
    () => (text.ai?.chapters ?? []).slice().sort((a, b) => a.startSeconds - b.startSeconds),
    [text.ai?.chapters],
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
    return <div className="fixed inset-0 bg-black flex items-center justify-center text-dim text-[15px]">{t_("loading")}</div>;
  }
  const isPrivateErr = !video && error instanceof ApiError && error.code === "private";
  if (!video || video.status !== "ready") {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center px-6">
        <div className="text-center space-y-3 max-w-sm">
          <p className="font-display text-[22px] text-paper">
            {isPrivateErr ? tv("privateTitle") : !video ? tv("notFoundTitle") : t_("processingTitle")}
          </p>
          <p className="text-[14px] text-dim leading-relaxed">
            {isPrivateErr ? t_("privateBody") : !video ? t_("notFoundBody") : t_("processingBody")}
          </p>
          <Link href="/" className="btn btn-ghost h-9 px-3.5 inline-flex items-center mt-2">{tpub("open")}</Link>
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
        <Link href={video.isOwner ? `/video/${params.id}` : `/v/${params.id}`} className="flex items-center gap-1.5 text-[13px] text-dim hover:text-paper no-min" aria-label={t_("leave")}>
          <ArrowLeft size={14} className="rtl:rotate-180" /> {t_("exit")}
        </Link>
        <p className="flex-1 min-w-0 truncate text-[14px] text-paper-2" dir="auto">{video.title}</p>
        <div className="flex items-center gap-1">
          {[
            { id: "qr", on: showQr, act: () => setShowQr((x) => !x), label: showQr ? t_("hideCode") : t_("showCode"), icon: <QrIcon size={15} /> },
            { id: "cc", on: cc, act: () => setCc((x) => !x), label: cc ? t_("captionsOff") : t_("captionsOn"), icon: cc ? <Captions size={15} /> : <CaptionsOff size={15} /> },
            { id: "full", on: full, act: fullscreen, label: full ? t_("leaveFull") : t_("full"), icon: full ? <Minimize size={15} /> : <Maximize size={15} /> },
            { id: "keys", on: help, act: () => setHelp((x) => !x), label: t_("keysButton"), icon: <Keyboard size={15} /> },
          ].map((b) => (
            <button
              key={b.id}
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
              onTimeUpdate={(e) => { const el = e.currentTarget; setT(el.currentTime); views.onTime(el.currentTime, el.duration, !el.paused); }}
              onPlay={() => { setPlaying(true); wake(); }}
              onPause={() => { setPlaying(false); views.flush(); }}
              onEnded={(e) => { setPlaying(false); views.onTime(e.currentTarget.duration, e.currentTarget.duration, true); views.flush(); }}
              onError={() => setFailed(true)}
              className="absolute inset-0 w-full h-full object-contain bg-black"
            />
            {failed && (
              <p className="absolute inset-0 flex items-center justify-center text-center px-6 text-[16px] text-dim">
                {t_("cannotPlay")}
              </p>
            )}
            {!playing && !failed && (
              <button
                onClick={toggle}
                aria-label={t_("play")}
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
              dir="auto"
              className="shrink-0 min-h-[2.5em] pt-3 text-center font-medium leading-[1.2] whitespace-pre-line text-[clamp(18px,2.4vw,42px)] text-paper"
            >
              {cue?.text ?? ""}
            </p>
          )}
        </div>

        {showQr && (
          <aside
            aria-label={t_("follow")}
            className="shrink-0 flex flex-col items-center justify-center gap-3 landscape:w-[clamp(170px,22vw,380px)] pb-2"
          >
            {shareable ? (
              <>
                <QrCode text={link} label={t_("qrLabel")} className="w-[min(60vw,38vh)] landscape:w-full rounded-md" />
                <p className="text-[clamp(15px,1.5vw,24px)] font-semibold text-paper text-center">{t_("scan")}</p>
                <p className="tc text-center break-all" dir="ltr">{shortLink}</p>
              </>
            ) : (
              <p className="text-[clamp(14px,1.3vw,20px)] text-dim text-center leading-snug max-w-[28ch]">
                {t_("privateNoCode")}
              </p>
            )}
            {ch >= 0 && (
              <div className="text-center mt-2 max-w-full">
                <p className="tc">{t_("chapterOf", { n: ch + 1, total: marks.length })}</p>
                <p className="text-[clamp(14px,1.3vw,20px)] text-paper-2 leading-snug" dir="auto">{marks[ch].title}</p>
              </div>
            )}
          </aside>
        )}
      </div>

      {/* Bottom: play, time, chapters along the bar */}
      {/* The timeline runs left to right in every language, like the player's. */}
      <div dir="ltr" className={clsx("shrink-0 h-12 flex items-center gap-3 px-5 transition-opacity duration-300", chrome ? "opacity-100" : "opacity-0")}>
        <button onClick={toggle} aria-label={playing ? t_("pause") : t_("play")} className="w-9 h-9 flex items-center justify-center rounded hover:bg-white/10 no-min">
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
          <div role="dialog" aria-label={t_("keys")} className="popover p-5 w-[min(460px,100%)]" onClick={(e) => e.stopPropagation()}>
            <p className="text-[15px] font-semibold mb-3">{t_("keys")}</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-1.5 text-[13.5px]">
              {KEYS.map((k) => (
                <div key={k} className="contents">
                  <dt className="tc text-paper">{t_(`key.${k}`)}</dt>
                  <dd className="text-paper-2">{t_(`does.${k}`)}</dd>
                </div>
              ))}
            </dl>
            <p className="text-[12.5px] text-dim mt-3">{t_("clicker")}</p>
          </div>
        </div>
      )}
    </div>
  );
}
