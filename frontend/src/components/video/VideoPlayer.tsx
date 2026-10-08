"use client";
import {
  useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle,
} from "react";
import { Play, Pause, Volume2, VolumeX, Maximize, AlertTriangle, Captions, CaptionsOff, SkipBack, SkipForward } from "lucide-react";
import { clsx } from "clsx";
import Link from "next/link";

export interface VideoPlayerHandle {
  seekTo: (seconds: number) => void;
  getCurrentTime: () => number;
}

interface Props {
  streamUrl: string | null;
  title: string;
  shelbyAddress?: string;
  blobName?: string;
  /** vm_upload: where the file is served from */
  source?: "storage" | "shelby" | null;
  /** vm_media: the picture shown until playback starts */
  poster?: string | null;
  /** what the file is ("HEVC in MOV") when browsers cannot all play it */
  format?: string | null;
  /** vm_captions: WebVTT text. A captions button appears when there is some. */
  captions?: string | null;
  /** vm_workspace: the bar names the chapter playing and steps between chapters */
  chapters?: Array<{ title: string; startSeconds: number }>;
  /** vm_workspace: where to start, for a link to a moment (?t=). The video waits for play. */
  startAt?: number | null;
  /** vm_progress: startAt is where this viewer stopped last time; say so, and offer to start over */
  resumed?: boolean;
  onStartOver?: () => void;
  /** vm_progress: where the viewer is, for remembering it */
  onProgress?: (seconds: number, duration: number, reason: "tick" | "pause" | "end") => void;
  /** vm_courses: the next lesson, offered when this one ends */
  upNext?: { title: string; href: string } | null;
  onDuration?: (seconds: number) => void;
  onTimeUpdate?: (seconds: number) => void;
}

/** vm_captions: whether this viewer last left captions on. Kept in this browser only. */
const CC_KEY = "vm.captions";
/** 75 -> "1:15" */
const readable = (sec: number) => { const s = Math.floor(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`; };
/** Height of the control bar (h-10). */
const BAR_PX = 40;
function ccPreference(): boolean {
  try { return localStorage.getItem(CC_KEY) === "on"; } catch { return false; }
}

export const VideoPlayer = forwardRef<VideoPlayerHandle, Props>(
  function VideoPlayer({ streamUrl, source, poster, format, captions, chapters, startAt, resumed, onStartOver, onProgress, upNext, onDuration, onTimeUpdate }, ref) {
    const v = useRef<HTMLVideoElement>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [playing, setPlaying] = useState(false);
    const [muted, setMuted] = useState(false);
    const [show, setShow] = useState(true);
    const hide = useRef<ReturnType<typeof setTimeout>>();
    const durSent = useRef(false);
    const started = useRef(false);
    // vm_progress: "Resumed at 12:30", until a few seconds into playing or Start over.
    const [chip, setChip] = useState<number | null>(null);
    // vm_courses: the video has played to its end
    const [ended, setEnded] = useState(false);
    const begin = useCallback((at: number) => {
      const el = v.current;
      if (!el || started.current || !(at > 0) || (isFinite(el.duration) && at >= el.duration)) return;
      started.current = true; el.currentTime = at; setNow(at);
      if (resumed) setChip(at);
    }, [resumed]);
    // The place to start can arrive after the video has loaded (it is fetched). Apply it if nothing has played yet.
    useEffect(() => {
      const el = v.current;
      if (startAt && el && el.readyState >= 1 && el.paused && el.currentTime < 1) begin(startAt);
    }, [startAt, begin]);
    useEffect(() => {
      if (chip === null || !playing) return;
      const t = setTimeout(() => setChip(null), 6000);
      return () => clearTimeout(t);
    }, [chip, playing]);

    // vm_workspace: the chapter playing, and the ones either side of it.
    const [now, setNow] = useState(0);
    const marks = (chapters ?? []).slice().sort((a, b) => a.startSeconds - b.startSeconds);
    let ch = -1;
    for (let i = 0; i < marks.length && marks[i].startSeconds <= now + 0.25; i++) ch = i;
    const jump = (s: number) => {
      const el = v.current; if (!el) return;
      el.currentTime = Math.max(0, s); setNow(el.currentTime);
    };
    // Back goes to the start of this chapter, or to the one before when it has only just begun.
    const prevChapter = () => {
      if (ch < 0) return jump(0);
      jump(now - marks[ch].startSeconds > 3 || ch === 0 ? marks[ch].startSeconds : marks[ch - 1].startSeconds);
    };
    const nextChapter = () => { if (ch + 1 < marks.length) jump(marks[ch + 1].startSeconds); };

    // vm_captions: the text becomes a file the browser can load as a track.
    // Captions start off, unless this viewer turned them on last time.
    const [ccUrl, setCcUrl] = useState<string | null>(null);
    const [ccOn, setCcOn] = useState(false);
    useEffect(() => { setCcOn(ccPreference()); }, []);
    useEffect(() => {
      if (!captions) { setCcUrl(null); return; }
      const url = URL.createObjectURL(new Blob([captions], { type: "text/vtt" }));
      setCcUrl(url);
      return () => URL.revokeObjectURL(url);
    }, [captions]);
    useEffect(() => {
      const track = v.current?.textTracks?.[0];
      if (track) track.mode = ccOn ? "showing" : "hidden";
    }, [ccOn, ccUrl]);
    // While the control bar is up, captions sit just above it instead of under it.
    const barUp = show || !playing;
    const placeCues = useCallback(() => {
      const el = v.current, track = el?.textTracks?.[0];
      if (!el || !track?.cues) return;
      const h = el.getBoundingClientRect().height || 1;
      const above = Math.max(0, 100 - ((BAR_PX + 6) / h) * 100);
      for (const cue of Array.from(track.cues) as VTTCue[]) {
        if (barUp) { cue.snapToLines = false; cue.line = above; cue.lineAlign = "end"; }
        else { cue.snapToLines = true; cue.line = "auto"; }
      }
    }, [barUp]);
    useEffect(() => { placeCues(); }, [placeCues, ccOn, ccUrl]);
    const toggleCaptions = () => {
      const on = !ccOn;
      setCcOn(on);
      try { localStorage.setItem(CC_KEY, on ? "on" : "off"); } catch {}
    };

    useImperativeHandle(ref, () => ({
      seekTo: (s: number) => {
        const el = v.current;
        if (!el) return;
        el.currentTime = s;
        el.play().catch(() => {});
        setPlaying(true);
      },
      getCurrentTime: () => v.current?.currentTime ?? 0,
    }));

    const bump = () => {
      if (hide.current) clearTimeout(hide.current);
      setShow(true);
      hide.current = setTimeout(() => { if (playing) setShow(false); }, 2600);
    };

    useEffect(() => () => { if (hide.current) clearTimeout(hide.current); }, []);

    const toggle = () => {
      const el = v.current;
      if (!el) return;
      el.paused ? (el.play(), setPlaying(true)) : (el.pause(), setPlaying(false));
      bump();
    };

    if (!streamUrl) {
      return (
        <div className="aspect-video rounded-md bg-screen border border-rule flex items-center justify-center">
          <span className="tc">This video has no file to play yet</span>
        </div>
      );
    }

    return (
      <div
        className="relative aspect-video rounded-md bg-screen border border-rule group overflow-hidden"
        onMouseMove={bump}
        onMouseLeave={() => playing && setShow(false)}
      >
        {loading && !error && (
          <div className={clsx("absolute inset-0 flex items-center justify-center z-10 pointer-events-none", !poster && "bg-screen")}>
            <div className={clsx("flex items-center gap-2.5", poster && "px-3 py-1.5 rounded bg-screen/85 border border-rule")}>
              <span className="dot dot-work" />
              <span className="tc">Loading the video</span>
            </div>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10 bg-screen px-6 text-center">
            <AlertTriangle size={20} className="text-error" />
            <p className="font-display text-[17px] text-paper">
              {source === "shelby" ? "This video could not be loaded from Shelby" : "This video could not be played"}
            </p>
            <p className="text-[12px] font-sans text-dim max-w-xs leading-relaxed">
              {source === "shelby"
                ? "The network may be unreachable right now, or the paid storage period may have ended."
                : format
                  ? `This file is ${format}, which this browser cannot play. An MP4 with H.264 video plays everywhere.`
                  : "The file may be in a format this browser cannot play, or storage may be unreachable right now."}
            </p>
          </div>
        )}

        <video
          ref={v}
          src={streamUrl}
          poster={poster ?? undefined}
          className="w-full h-full object-contain"
          preload="metadata"
          onClick={toggle}
          onLoadStart={() => setLoading(true)}
          onCanPlay={() => setLoading(false)}
          onLoadedMetadata={() => {
            const el = v.current;
            // vm_workspace: a link to a moment opens there, paused
            if (startAt) begin(startAt);
            if (!el || durSent.current || !isFinite(el.duration)) return;
            durSent.current = true;
            onDuration?.(el.duration);
          }}
          onTimeUpdate={() => { const el = v.current; const t = el?.currentTime ?? 0; setNow(t); onTimeUpdate?.(t); if (el && !el.paused) onProgress?.(t, el.duration, "tick"); }}
          onSeeked={() => { const t = v.current?.currentTime ?? 0; setNow(t); onTimeUpdate?.(t); }}
          onPlay={() => { setPlaying(true); setEnded(false); }}
          onPause={() => { setPlaying(false); const el = v.current; if (el && !el.ended) onProgress?.(el.currentTime, el.duration, "pause"); }}
          onError={() => { setError(true); setLoading(false); }}
          onEnded={() => { setPlaying(false); setEnded(true); const el = v.current; if (el) onProgress?.(el.duration, el.duration, "end"); }}
        >
          {ccUrl && (
            <track
              key={ccUrl}
              kind="captions"
              label="Captions"
              src={ccUrl}
              onLoad={() => { const t = v.current?.textTracks?.[0]; if (t) t.mode = ccOn ? "showing" : "hidden"; placeCues(); }}
            />
          )}
        </video>

        {/* Minimal chrome - the Intelligence Strip below is the real interface */}
        <div className={clsx(
          "absolute inset-x-0 bottom-0 flex items-center gap-3 px-3 h-10 bg-void/80 border-t border-rule transition-all duration-200 z-20",
          show || !playing ? "opacity-100 translate-y-0" : "opacity-0 translate-y-full"
        )}>
          <button onClick={toggle} aria-label={playing ? "Pause" : "Play"} className="text-paper-2 hover:text-paper transition-colors no-min">
            {playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
          </button>
          <button
            onClick={() => {
              const el = v.current; if (!el) return;
              el.muted = !el.muted; setMuted(el.muted);
            }}
            className="text-dim hover:text-paper transition-colors no-min"
          >
            {muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
          </button>
          {marks.length > 0 ? (
            <>
              <button onClick={prevChapter} aria-label="Previous chapter" title="Previous chapter" className="text-dim hover:text-paper transition-colors no-min">
                <SkipBack size={13} />
              </button>
              <button onClick={nextChapter} disabled={ch + 1 >= marks.length} aria-label="Next chapter" title="Next chapter" className="text-dim hover:text-paper transition-colors no-min disabled:opacity-40">
                <SkipForward size={13} />
              </button>
              <span className="text-[12.5px] text-paper-2 truncate min-w-0" aria-live="off">
                {ch >= 0 ? <><span className="tc mr-1.5">{ch + 1}/{marks.length}</span>{marks[ch].title}</> : <span className="text-dim">Before the first chapter</span>}
              </span>
              <span className="ml-auto" />
            </>
          ) : (
            <>
              <span className="tc ml-auto truncate hidden sm:block">Use the timeline below to move through the video</span>
              <span className="ml-auto sm:hidden" />
            </>
          )}
          {ccUrl && (
            <button
              onClick={toggleCaptions}
              aria-label={ccOn ? "Turn captions off" : "Turn captions on"}
              aria-pressed={ccOn}
              title={ccOn ? "Captions on" : "Captions off"}
              className={clsx("transition-colors no-min", ccOn ? "text-paper" : "text-dim hover:text-paper")}
            >
              {ccOn ? <Captions size={14} /> : <CaptionsOff size={14} />}
            </button>
          )}
          <button
            onClick={() => {
              const el = v.current; if (!el) return;
              document.fullscreenElement ? document.exitFullscreen() : el.requestFullscreen();
            }}
            className="text-dim hover:text-paper transition-colors no-min"
          >
            <Maximize size={13} />
          </button>
        </div>

        {/* vm_progress: where this viewer stopped last time */}
        {chip !== null && (
          <div className="absolute top-3 left-3 z-20 flex items-center gap-2 pl-3 pr-1.5 h-8 rounded bg-screen/90 border border-rule" role="status">
            <span className="text-[12.5px] text-paper-2">Resumed at <span className="tc text-paper">{readable(chip)}</span></span>
            <button
              onClick={() => { const el = v.current; if (el) { el.currentTime = 0; setNow(0); } setChip(null); onStartOver?.(); }}
              className="h-6 px-2 rounded text-[12.5px] text-paper hover:bg-slate-2 no-min"
            >
              Start over
            </button>
          </div>
        )}

        {/* vm_courses: at the end of a lesson, the next one */}
        {ended && upNext && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-screen/80 px-6">
            <div className="text-center space-y-3 max-w-sm">
              <p className="tc">Up next in this course</p>
              <p className="text-[16px] font-medium text-paper leading-snug">{upNext.title}</p>
              <div className="flex items-center justify-center gap-2">
                <Link href={upNext.href} className="btn btn-signal h-9 px-4 inline-flex items-center">Play next lesson</Link>
                <button onClick={() => setEnded(false)} className="btn btn-ghost h-9 px-3.5">Stay here</button>
              </div>
            </div>
          </div>
        )}

        {/* Big play */}
        {!playing && !loading && !error && (
          <button onClick={toggle} className="absolute inset-0 flex items-center justify-center z-10">
            <span className="w-14 h-14 rounded-full bg-paper/95 flex items-center justify-center">
              <Play size={20} className="text-void ml-1" fill="currentColor" />
            </span>
          </button>
        )}
      </div>
    );
  }
);
