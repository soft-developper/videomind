"use client";
import {
  useState, useRef, useEffect, forwardRef, useImperativeHandle,
} from "react";
import { Play, Pause, Volume2, VolumeX, Maximize, AlertTriangle } from "lucide-react";
import { clsx } from "clsx";

export interface VideoPlayerHandle {
  seekTo: (seconds: number) => void;
  getCurrentTime: () => number;
}

interface Props {
  streamUrl: string | null;
  title: string;
  shelbyAddress?: string;
  blobName?: string;
  onDuration?: (seconds: number) => void;
  onTimeUpdate?: (seconds: number) => void;
}

export const VideoPlayer = forwardRef<VideoPlayerHandle, Props>(
  function VideoPlayer({ streamUrl, onDuration, onTimeUpdate }, ref) {
    const v = useRef<HTMLVideoElement>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [playing, setPlaying] = useState(false);
    const [muted, setMuted] = useState(false);
    const [show, setShow] = useState(true);
    const hide = useRef<ReturnType<typeof setTimeout>>();
    const durSent = useRef(false);

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
        <div className="aspect-video bg-void border border-rule flex items-center justify-center">
          <span className="tc">No stream</span>
        </div>
      );
    }

    return (
      <div
        className="relative aspect-video bg-void border border-rule group overflow-hidden"
        onMouseMove={bump}
        onMouseLeave={() => playing && setShow(false)}
      >
        {loading && !error && (
          <div className="absolute inset-0 flex items-center justify-center z-10 bg-void">
            <div className="flex items-center gap-2.5">
              <span className="dot dot-work" />
              <span className="tc">Loading from Shelby</span>
            </div>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10 bg-void px-6 text-center">
            <AlertTriangle size={20} className="text-error" />
            <p className="font-display text-[17px] text-paper">Blob unavailable</p>
            <p className="text-[12px] font-sans text-dim max-w-xs leading-relaxed">
              This video may have expired on Shelby. Renew it to restore access.
            </p>
          </div>
        )}

        <video
          ref={v}
          src={streamUrl}
          className="w-full h-full object-contain"
          preload="metadata"
          onClick={toggle}
          onLoadStart={() => setLoading(true)}
          onCanPlay={() => setLoading(false)}
          onLoadedMetadata={() => {
            const el = v.current;
            if (!el || durSent.current || !isFinite(el.duration)) return;
            durSent.current = true;
            onDuration?.(el.duration);
          }}
          onTimeUpdate={() => onTimeUpdate?.(v.current?.currentTime ?? 0)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onError={() => { setError(true); setLoading(false); }}
          onEnded={() => setPlaying(false)}
        />

        {/* Minimal chrome — the Intelligence Strip below is the real interface */}
        <div className={clsx(
          "absolute inset-x-0 bottom-0 flex items-center gap-3 px-3 h-10 bg-void/80 border-t border-rule transition-all duration-200 z-20",
          show || !playing ? "opacity-100 translate-y-0" : "opacity-0 translate-y-full"
        )}>
          <button onClick={toggle} className="text-paper hover:text-signal transition-colors no-min">
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
          <span className="tc ml-auto">Scrub on the strip below</span>
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

        {/* Big play */}
        {!playing && !loading && !error && (
          <button onClick={toggle} className="absolute inset-0 flex items-center justify-center z-10">
            <span className="w-14 h-14 bg-signal flex items-center justify-center">
              <Play size={20} className="text-void ml-1" fill="currentColor" />
            </span>
          </button>
        )}
      </div>
    );
  }
);
