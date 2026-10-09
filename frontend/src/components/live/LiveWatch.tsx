"use client";
// vm_live: the viewer's side. No wallet is needed. Before the event the
// page waits and starts by itself; during it the host's picture and sound
// play here; after it the page points to the recording.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Room, RoomEvent, Track, type RemoteTrack } from "livekit-client";
import { Volume2 } from "lucide-react";
import { getLiveEvent, liveViewerToken, ApiError } from "@/lib/api";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const clock = (sec: number) => {
  const s = Math.max(0, Math.floor(sec)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
};

export function LiveWatch({ id }: { id: string }) {
  const { data, error, refetch } = useQuery({
    queryKey: ["live-watch", id],
    queryFn: () => getLiveEvent(id),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2,
    // Until it is live, look again every 10 seconds. After it ends, now and then for the recording.
    refetchInterval: (q) => (q.state.data?.event.status === "scheduled" ? 10_000 : q.state.data?.event.status === "ended" && !q.state.data?.event.videoId ? 30_000 : false),
  });
  const event = data?.event;
  const stage = useRef<HTMLDivElement>(null);
  const [connected, setConnected] = useState(false);
  const [hasVideo, setHasVideo] = useState(false);
  const [needsSound, setNeedsSound] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const room = useRef<Room | null>(null);

  useEffect(() => {
    if (event?.status !== "live") return;
    let stopped = false;
    const r = new Room({ adaptiveStream: true, dynacast: true });
    room.current = r;
    const attach = (track: RemoteTrack) => {
      if (!stage.current) return;
      const el = track.attach();
      if (track.kind === Track.Kind.Video) {
        el.className = "absolute inset-0 w-full h-full object-contain";
        el.setAttribute("aria-label", "The live picture");
        stage.current.querySelectorAll("video").forEach((v) => v.remove());
        stage.current.appendChild(el);
        setHasVideo(true);
      } else {
        el.setAttribute("data-live-audio", "");
        document.body.appendChild(el);
      }
    };
    r.on(RoomEvent.TrackSubscribed, (track) => attach(track as RemoteTrack));
    r.on(RoomEvent.TrackUnsubscribed, (track) => { track.detach().forEach((el) => el.remove()); if (track.kind === Track.Kind.Video) setHasVideo(false); });
    r.on(RoomEvent.AudioPlaybackStatusChanged, () => setNeedsSound(!r.canPlaybackAudio));
    r.on(RoomEvent.Disconnected, () => { setConnected(false); setHasVideo(false); if (!stopped) void refetch(); });
    (async () => {
      try {
        const { url, token } = await liveViewerToken(id);
        if (stopped) return;
        await r.connect(url, token);
        setConnected(true);
        setNeedsSound(!r.canPlaybackAudio);
      } catch (e: any) {
        if (!stopped) { setErr(e instanceof ApiError ? e.message : "The live picture could not be loaded. Reload the page to try again."); void refetch(); }
      }
    })();
    return () => {
      stopped = true;
      r.disconnect().catch(() => {});
      document.querySelectorAll("[data-live-audio]").forEach((el) => el.remove());
      room.current = null;
    };
  }, [event?.status, id, refetch]);

  useEffect(() => {
    if (event?.status !== "live") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [event?.status]);

  if (!event) {
    const missing = error instanceof ApiError && error.status === 404;
    return (
      <div className="py-16 max-w-[46ch]">
        <h1 className="font-display text-[20px] text-paper">{missing ? "This live event was not found" : "Loading"}</h1>
        {missing && <p className="text-[14px] text-dim mt-1.5">The link may be wrong.</p>}
      </div>
    );
  }

  const who = event.hostName ?? short(event.wallet);
  return (
    <div className="space-y-4 pt-6">
      <div>
        <h1 className="font-display text-[22px] sm:text-[26px] leading-tight text-paper">{event.title}</h1>
        <Link href={`/u/${event.wallet}`} className="text-[13.5px] text-paper-2 hover:text-paper hover:underline underline-offset-2">By {who}</Link>
      </div>

      <div ref={stage} className="relative w-full aspect-video rounded-md bg-black overflow-hidden" data-live-stage>
        {event.status === "live" && (
          <span className="absolute left-3 top-3 z-10 flex items-center gap-2 bg-black/70 rounded px-2.5 h-7">
            <span className="w-2.5 h-2.5 rounded-full bg-error animate-pulse" />
            <span className="tc text-paper" data-live-state>Live{event.startedAt ? ` ${clock((now - event.startedAt) / 1000)}` : ""}</span>
          </span>
        )}
        {event.status === "live" && !hasVideo && (
          <p className="absolute inset-0 flex items-center justify-center text-[14px] text-dim">{err ?? (connected ? "Waiting for the picture" : "Connecting")}</p>
        )}
        {event.status === "scheduled" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6" data-live-state>
            <p className="text-[16px] text-paper">This live event has not started yet</p>
            <p className="text-[13.5px] text-dim mt-1">Keep this page open. It starts playing by itself.</p>
          </div>
        )}
        {event.status === "ended" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 gap-3" data-live-state>
            <p className="text-[16px] text-paper">This live event has ended</p>
            {event.videoId
              ? <Link href={`/v/${event.videoId}`} className="btn btn-signal h-9 px-4 inline-flex items-center">Watch the recording</Link>
              : <p className="text-[13.5px] text-dim">The recording appears here once the host uploads it.</p>}
          </div>
        )}
        {needsSound && event.status === "live" && (
          <button onClick={() => { room.current?.startAudio().then(() => setNeedsSound(false)).catch(() => {}); }} className="absolute right-3 bottom-3 z-10 btn btn-signal h-9 px-3.5 inline-flex items-center gap-1.5">
            <Volume2 size={14} /> Turn sound on
          </button>
        )}
      </div>
    </div>
  );
}
