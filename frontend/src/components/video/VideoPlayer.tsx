"use client";
import { useState, useRef, useEffect } from "react";
import { Play, Pause, Volume2, VolumeX, Maximize, Loader2, AlertTriangle, Film, ExternalLink } from "lucide-react";
import { clsx } from "clsx";

interface VideoPlayerProps {
  streamUrl: string | null;
  title: string;
  shelbyAddress?: string;
  blobName?: string;
}

export function VideoPlayer({ streamUrl, title, shelbyAddress, blobName }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>();

  // Auto-hide controls
  const resetHideTimer = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setShowControls(true);
    hideTimer.current = setTimeout(() => {
      if (playing) setShowControls(false);
    }, 3000);
  };

  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current); }, []);

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play(); setPlaying(true); }
    else { v.pause(); setPlaying(false); }
    resetHideTimer();
  }

  function toggleMute() {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }

  function toggleFullscreen() {
    const v = videoRef.current;
    if (!v) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else v.requestFullscreen();
  }

  function onTimeUpdate() {
    const v = videoRef.current;
    if (!v) return;
    setCurrentTime(v.currentTime);
    setProgress(v.duration ? (v.currentTime / v.duration) * 100 : 0);
  }

  function seek(e: React.MouseEvent<HTMLDivElement>) {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    v.currentTime = pct * v.duration;
  }

  function formatTime(s: number) {
    if (!s || isNaN(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  }

  // No stream URL — show placeholder
  if (!streamUrl) {
    return (
      <div className="aspect-video rounded-2xl bg-dark-800 border border-white/[0.06] flex flex-col items-center justify-center gap-4">
        <Film size={40} className="text-white/10" strokeWidth={1} />
        <p className="text-white/30 text-sm font-mono">Video stream unavailable</p>
      </div>
    );
  }

  return (
    <div
      className="relative aspect-video rounded-2xl overflow-hidden bg-black border border-white/[0.06] group"
      onMouseMove={resetHideTimer}
      onMouseLeave={() => playing && setShowControls(false)}
    >
      {/* Loading spinner */}
      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-dark-950/80 z-10">
          <div className="flex flex-col items-center gap-3">
            <Loader2 size={28} className="text-volt animate-spin" />
            <p className="text-xs font-mono text-white/40">Loading from Shelby...</p>
          </div>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-dark-950/90 z-10">
          <AlertTriangle size={28} className="text-red-400" />
          <div className="text-center">
            <p className="text-sm text-white/60 font-dm mb-1">Could not load video from Shelby</p>
            <p className="text-xs text-white/30 font-mono">The blob may have expired or the URL is incorrect</p>
          </div>
          {streamUrl && (
            <a
              href={streamUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-volt/20 bg-volt/5 text-volt text-xs font-mono hover:bg-volt/10 transition-all"
            >
              <ExternalLink size={12} />
              Open direct URL
            </a>
          )}
        </div>
      )}

      {/* Video element */}
      <video
        ref={videoRef}
        src={streamUrl}
        className="w-full h-full object-contain"
        preload="metadata"
        onClick={togglePlay}
        onLoadStart={() => setLoading(true)}
        onCanPlay={() => setLoading(false)}
        onLoadedMetadata={() => setDuration(videoRef.current?.duration ?? 0)}
        onTimeUpdate={onTimeUpdate}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onError={() => { setError(true); setLoading(false); }}
        onEnded={() => setPlaying(false)}
      />

      {/* Custom controls overlay */}
      <div className={clsx(
        "absolute inset-x-0 bottom-0 transition-all duration-300 z-20",
        showControls || !playing ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
      )}>
        {/* Gradient */}
        <div className="h-24 bg-gradient-to-t from-black/80 to-transparent absolute inset-x-0 bottom-0 pointer-events-none" />

        <div className="relative px-4 pb-4 pt-8 space-y-2">
          {/* Progress bar */}
          <div
            className="h-1 bg-white/20 rounded-full cursor-pointer group/bar"
            onClick={seek}
          >
            <div
              className="h-full progress-bar rounded-full relative transition-all"
              style={{ width: `${progress}%` }}
            >
              <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-volt rounded-full shadow-lg opacity-0 group-hover/bar:opacity-100 transition-opacity" />
            </div>
          </div>

          {/* Controls row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Play/Pause */}
              <button
                onClick={togglePlay}
                className="w-8 h-8 rounded-lg bg-volt/10 hover:bg-volt/20 border border-volt/20 flex items-center justify-center transition-all"
              >
                {playing
                  ? <Pause size={14} className="text-volt" />
                  : <Play size={14} className="text-volt ml-0.5" />
                }
              </button>

              {/* Mute */}
              <button onClick={toggleMute} className="text-white/40 hover:text-white transition-colors">
                {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
              </button>

              {/* Time */}
              <span className="font-mono text-xs text-white/40">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>

            <div className="flex items-center gap-3">
              {/* Shelby badge */}
              {shelbyAddress && (
                <a
                  href={`https://explorer.shelby.xyz/testnet/accounts/${shelbyAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 px-2 py-1 rounded bg-volt/10 border border-volt/20 hover:bg-volt/20 transition-all"
                  title="View on Shelby Explorer"
                >
                  <span className="font-mono text-[10px] text-volt">⚡ Shelby</span>
                </a>
              )}

              {/* Fullscreen */}
              <button onClick={toggleFullscreen} className="text-white/40 hover:text-white transition-colors">
                <Maximize size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Big play button in center when paused */}
      {!playing && !loading && !error && (
        <button
          onClick={togglePlay}
          className="absolute inset-0 flex items-center justify-center z-10"
        >
          <div className="w-16 h-16 rounded-full bg-volt/20 border border-volt/30 backdrop-blur-sm flex items-center justify-center hover:bg-volt/30 transition-all">
            <Play size={24} className="text-volt ml-1" />
          </div>
        </button>
      )}
    </div>
  );
}
