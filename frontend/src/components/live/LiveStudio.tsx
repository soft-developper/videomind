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
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Room, RoomEvent, Track } from "livekit-client";
import { Monitor, Camera, Copy, Check } from "lucide-react";
import { clsx } from "clsx";
import { UploadZone } from "@/components/upload/UploadZone";
import { QrCode } from "@/components/share/QrCode";
import { openInputs, pickType, fixWebmDuration, VIDEO_BITS, AUDIO_BITS, MAX_SECONDS, canRecord, type Source, type Inputs } from "@/lib/record";
import {
  getLiveEvent, liveHostToken, startLive, endLive, liveStats, linkLiveRecording, ApiError, type LiveEventInfo,
  updateLiveSettings, liveCaptionsSocket, type ChatMode,
} from "@/lib/api";
import { startCaptionFeed } from "@/lib/liveaudio";
import { LiveChat } from "./LiveChat";

const CHAT_CHOICES: Array<[ChatMode, string, string]> = [
  ["anyone", "Anyone with a name", "No wallet needed. You can delete messages and block people."],
  ["wallets", "Signed in wallets only", "Viewers without a wallet can read but not write."],
  ["off", "Chat off", "Only you can write."],
];

/** Who may chat and whether captions are made. Saved at once; works before and during the event. */
function LiveSettings({ event, onSaved }: { event: LiveEventInfo; onSaved: () => void }) {
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
      setErr(x instanceof ApiError ? x.message : "That did not save. Try again.");
    }
    finally { setBusy(false); }
  };
  return (
    <div className="space-y-4" aria-label="Chat and captions">
      <fieldset className="space-y-1.5" disabled={busy}>
        <legend className="text-[13px] font-medium text-paper mb-1">Who can write in the chat</legend>
        {CHAT_CHOICES.map(([v, label, hint]) => (
          <label key={v} className="flex items-start gap-2.5 cursor-pointer">
            <input type="radio" name="chat-mode" checked={mode === v} onChange={() => void change({ chatMode: v })} className="mt-1" />
            <span><span className="block text-[13.5px] text-paper">{label}</span><span className="block text-[12.5px] text-dim">{hint}</span></span>
          </label>
        ))}
      </fieldset>
      <div>
        <label className={clsx("flex items-center gap-2.5 text-[13.5px] cursor-pointer", event.captionsAvailable ? "text-paper" : "text-dim")}>
          <input type="checkbox" checked={event.captionsAvailable ? captions : false} disabled={busy || !event.captionsAvailable} onChange={(e) => void change({ captions: e.target.checked })} />
          Live captions
        </label>
        <p className="text-[12.5px] text-dim mt-1 pl-6">
          {event.captionsAvailable
            ? `What you say appears as text for viewers, in English or the language you speak. Uses OpenAI, about $1 for each hour you speak; up to ${event.captionLimitMinutes ?? 180} minutes per event.`
            : "Live captions are not set up on this server."}
        </p>
      </div>
      {err && <p className="text-[12.5px] text-error" role="alert">{err}</p>}
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

function reason(err: any, source: Source): string {
  const name = String(err?.name ?? "");
  if (name === "NotAllowedError") return source === "screen"
    ? "Sharing was cancelled, or the browser is not allowed to share the screen."
    : "The browser was not allowed to use the camera or microphone. Allow it in the address bar, then try again.";
  if (name === "NotFoundError") return "No camera or microphone was found.";
  if (name === "NotReadableError") return "The camera or microphone is being used by another app.";
  if (err instanceof ApiError) return err.message;
  return `Going live did not work: ${err?.message ?? "unknown error"}.`;
}

export function LiveStudio({ id }: { id: string }) {
  const { data, refetch } = useQuery({ queryKey: ["live", id], queryFn: () => getLiveEvent(id) });
  const event: LiveEventInfo | undefined = data?.event;

  const [source, setSource] = useState<Source>("camera");
  const [mic, setMic] = useState(true);
  const [restream, setRestream] = useState<string[]>([""]);
  const [phase, setPhase] = useState<Phase>({ at: "setup" });
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [viewers, setViewers] = useState(0);
  const [copied, setCopied] = useState(false);
  const [support, setSupport] = useState<ReturnType<typeof canRecord> | null>(null);
  useEffect(() => { setSupport(canRecord()); }, []);

  const room = useRef<Room | null>(null);
  const bus = useRef(new EventTarget());
  const feed = useRef<(() => void) | null>(null);
  const [capState, setCapState] = useState<{ on: boolean; text: string; note: string | null }>({ on: false, text: "", note: null });
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
    const t = setInterval(() => setElapsed((performance.now() - since.current) / 1000), 500);
    const s = setInterval(() => { liveStats(id).then((x) => setViewers(x.viewers)).catch(() => {}); }, 10_000);
    liveStats(id).then((x) => setViewers(x.viewers)).catch(() => {});
    return () => { clearInterval(t); clearInterval(s); };
  }, [phase, id]);

  useEffect(() => {
    if (phase.at === "live" && preview.current && inputs.current && !preview.current.srcObject) {
      preview.current.srcObject = inputs.current.preview; preview.current.play().catch(() => {});
    }
  }, [phase]);

  const stopFeed = () => { feed.current?.(); feed.current = null; };
  const cleanup = async () => {
    stopFeed();
    await room.current?.disconnect().catch(() => {}); room.current = null;
    inputs.current?.stop(); inputs.current = null;
  };
  useEffect(() => () => { void cleanup(); }, []);

  const stopRecording = async (): Promise<File | null> => {
    const r = rec.current; rec.current = null;
    if (!r || r.state === "inactive") return null;
    await new Promise<void>((res) => { r.addEventListener("stop", () => res(), { once: true }); r.stop(); });
    const type = r.mimeType || "video/webm";
    let blob = new Blob(parts.current, { type }); parts.current = [];
    if (!blob.size) return null;
    if (type.startsWith("video/webm")) blob = await fixWebmDuration(blob, Math.round(((performance.now() - since.current) / 1000) * 1000));
    const ext = type.startsWith("video/mp4") ? ".mp4" : ".webm";
    return new File([blob], `live-${id.slice(0, 8)}${ext}`, { type: type.split(";")[0] });
  };

  const end = useCallback(async (why?: string) => {
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
    if (!track) { setCapState({ on: false, text: "", note: "Captions need sound: the microphone is off and nothing else is heard." }); return; }
    let cancelled = false;
    (async () => {
      try {
        const url = await liveCaptionsSocket(id);
        if (cancelled) return;
        const stop = await startCaptionFeed(track, url, (m) => {
          if (m.type === "ready") setCapState({ on: true, text: "", note: null });
          else if (m.type === "partial" || m.type === "final") setCapState((c) => ({ ...c, on: true, text: m.text }));
          else if (m.type === "warning") setCapState((c) => ({ ...c, note: m.message ?? null }));
          else if (m.type === "stopped") { feed.current = null; setCapState({ on: false, text: "", note: m.reason === "off" || m.reason === "ended" ? null : m.message ?? "Captions stopped." }); }
          else if (m.type === "closed") { feed.current = null; setCapState((c) => ({ on: false, text: "", note: c.note ?? "The captions connection closed." })); }
        });
        if (cancelled) stop(); else feed.current = stop;
      } catch (e) {
        if (!cancelled) setCapState({ on: false, text: "", note: e instanceof ApiError ? e.message : "Captions could not start." });
      }
    })();
    return () => { cancelled = true; };
  }, [wantCaptions, id, capTry]);

  // A live event stops by itself at the longest recording allowed.
  useEffect(() => { if (phase.at === "live" && elapsed >= MAX_SECONDS) void end("The live event reached its longest length and was ended."); }, [elapsed, phase, end]);

  const goLive = async () => {
    setErr(null); setNote(null);
    const type = pickType();
    if (!type) { setErr("This browser cannot record video, which a live event also does."); return; }
    let ins: Inputs;
    try { ins = await openInputs(source, { mic, systemAudio: source === "screen" }); }
    catch (e) { setErr(reason(e, source)); return; }
    inputs.current = ins;
    setPhase({ at: "starting" });
    try {
      const { url, token } = await liveHostToken(id);
      const r = new Room({ adaptiveStream: false, dynacast: true });
      room.current = r;
      r.on(RoomEvent.DataReceived, (payload, _p, _k, topic) => {
        if (topic !== "chat") return;
        try { bus.current.dispatchEvent(new CustomEvent("chat", { detail: JSON.parse(new TextDecoder().decode(payload)) })); } catch { /* not ours */ }
      });
      await r.connect(url, token);
      const [video] = ins.stream.getVideoTracks();
      const [audio] = ins.stream.getAudioTracks();
      await r.localParticipant.publishTrack(video, { source: source === "screen" ? Track.Source.ScreenShare : Track.Source.Camera, name: source, simulcast: true });
      if (audio) await r.localParticipant.publishTrack(audio, { source: Track.Source.Microphone, name: "sound" });
      // The live server may take a moment to list the tracks.
      const urls = restream.map((u) => u.trim()).filter(Boolean);
      let started: Awaited<ReturnType<typeof startLive>> | null = null;
      for (let i = 0; i < 8 && !started; i++) {
        try { started = await startLive(id, urls); }
        catch (e) { if (e instanceof ApiError && e.code === "not_publishing" && i < 7) await sleep(1000); else throw e; }
      }
      if (started?.restreamError) setNote(started.restreamError);
      // Record what is sent, from the same tracks.
      parts.current = [];
      const mr = new MediaRecorder(ins.stream, { mimeType: type, videoBitsPerSecond: VIDEO_BITS, audioBitsPerSecond: AUDIO_BITS });
      mr.ondataavailable = (e) => { if (e.data.size) parts.current.push(e.data); };
      mr.start(1000);
      rec.current = mr;
      since.current = performance.now();
      ins.onEnded(() => { void end("Sharing was stopped from the browser, so the live event ended."); });
      setElapsed(0);
      setPhase({ at: "live" });
      await refetch();
    } catch (e) {
      void cleanup();
      setErr(reason(e, source));
      setPhase({ at: "setup" });
    }
  };

  const onUploaded = useCallback((videoId: string) => {
    linkLiveRecording(id, videoId).then(() => refetch()).catch(() => {});
    setPhase({ at: "uploaded", videoId });
  }, [id, refetch]);

  if (!event) return <p className="text-[14px] text-dim">Loading</p>;

  const shareBox = (
    <div className="flex items-start gap-4 flex-wrap">
      <QrCode text={watchUrl} label="QR code for the live page" className="w-[120px] h-[120px] rounded-sm shrink-0" />
      <div className="space-y-2 min-w-0">
        <p className="text-[13px] text-dim">Viewers watch here, no wallet needed:</p>
        <p className="tc text-paper-2 break-all">{watchUrl}</p>
        <button
          onClick={() => { navigator.clipboard.writeText(watchUrl).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1600); }}
          className="btn btn-ghost h-8 px-3 text-[13px] inline-flex items-center gap-1.5"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy link"}
        </button>
      </div>
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
        <p className="text-[15px] text-paper">The recording is in your library and is being processed.</p>
        <p className="text-[13.5px] text-dim">The live page now points viewers to it.</p>
        <a href={`/video/${phase.videoId}`} className="btn btn-ghost h-9 px-3.5 inline-flex items-center mt-2">Open the video</a>
      </div>
    );
  }
  if (phase.at === "done" || (event.status === "ended" && phase.at === "setup")) {
    const d = phase.at === "done" ? phase : null;
    return (
      <div className="space-y-4 max-w-[860px]">
        <p className="text-[15px] text-paper" data-live-ended>This live event has ended{d ? ` after ${clock(d.seconds)}` : ""}.</p>
        {note && <p className="text-[13.5px] text-dim">{note}</p>}
        {d?.file && d.url ? (
          <>
            <video src={d.url} controls playsInline className="w-full aspect-video rounded-md bg-black" aria-label="The recording" />
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => setPhase({ at: "upload", file: d.file! })} className="btn btn-signal h-9 px-4">Upload the recording</button>
              <a href={d.url} download={d.file.name} className="btn btn-ghost h-9 px-3.5 inline-flex items-center">Download a copy</a>
            </div>
            <p className="text-[13px] text-dim">The recording is only in this browser until it is uploaded.</p>
          </>
        ) : event.videoId ? (
          <a href={`/video/${event.videoId}`} className="btn btn-ghost h-9 px-3.5 inline-flex items-center">Open the recording</a>
        ) : (
          <p className="text-[13.5px] text-dim">There is no recording in this browser.</p>
        )}
      </div>
    );
  }

  if (live) {
    return (
      <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-6 items-start">
        <div className="space-y-4 min-w-0">
          <div className="relative">
            <video ref={preview} muted playsInline className="w-full aspect-video rounded-md bg-black object-contain" aria-label="What viewers see" />
            <span className="absolute left-3 top-3 flex items-center gap-2 bg-black/70 rounded px-2.5 h-7" data-live-badge>
              <span className={clsx("w-2.5 h-2.5 rounded-full", phase.at === "live" ? "bg-error animate-pulse" : "bg-dim")} />
              <span className="tc text-paper">{phase.at === "starting" ? "Connecting" : phase.at === "ending" ? "Ending" : `Live ${clock(elapsed)}`}</span>
            </span>
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <button
              onClick={() => { if (window.confirm("End the live event for everyone?")) void end(); }}
              disabled={phase.at !== "live"}
              className="btn btn-signal h-9 px-4"
            >
              End live
            </button>
            <span className="tc" data-viewers>{viewers} watching</span>
            {event.restreaming && <span className="tc">Restreaming</span>}
          </div>
          {note && <p className="text-[13px] text-warn" role="status">{note}</p>}
          {event.captions && event.captionsAvailable && (
            <p className="text-[13px] text-paper-2" data-captions-state>
              {capState.on ? <>Captions on{capState.text ? <span className="text-dim">: {capState.text.slice(-120)}</span> : <span className="text-dim">, listening</span>}</> : capState.note ?? "Captions starting"}
              {!capState.on && capState.note && !feed.current && (
                <button onClick={() => { setCapState({ on: false, text: "", note: null }); setCapTry((n) => n + 1); }} className="ml-2 text-paper-2 underline underline-offset-2 hover:text-paper no-min">Try again</button>
              )}
            </p>
          )}
          <p className="text-[13px] text-dim">This browser is also recording. Keep this tab open until you end the live event.</p>
          <div className="panel p-4"><LiveSettings event={event} onSaved={() => void refetch()} /></div>
        </div>
        <aside className="space-y-4">
          <div className="panel p-4">{shareBox}</div>
          <LiveChat eventId={id} status={event.status} chatMode={event.chatMode} owner bus={bus.current} className="h-[460px]" />
        </aside>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[640px]">
      {support && !support.recorder && <p className="text-[13.5px] text-error">This browser cannot record video, which a live event also does. Use a recent Chrome, Edge, Firefox or Safari on a computer.</p>}
      <fieldset>
        <legend className="text-[13px] font-medium text-paper mb-2">Show</legend>
        <div className="grid sm:grid-cols-2 gap-3">
          {([["camera", "Camera", Camera], ["screen", "Screen", Monitor]] as const).map(([v, label, Icon]) => (
            <label key={v} className={clsx("flex items-center gap-3 p-3.5 rounded-md border cursor-pointer", source === v ? "border-paper bg-slate-2" : "border-rule hover:border-rule-lit")}>
              <input type="radio" name="live-source" className="sr-only" checked={source === v} onChange={() => setSource(v)} />
              <Icon size={18} className="text-paper-2" /> <span className="text-[14px] text-paper">{label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex items-center gap-2.5 text-[13.5px] text-paper-2 cursor-pointer">
        <input type="checkbox" checked={mic} onChange={(e) => setMic(e.target.checked)} /> Use my microphone
      </label>

      <LiveSettings event={event} onSaved={() => void refetch()} />

      <fieldset className="space-y-2">
        <legend className="text-[13px] font-medium text-paper">Also stream to (optional)</legend>
        <p className="text-[12.5px] text-dim">An RTMP address with its stream key, from YouTube Live, Twitch or another site. It is used for this event only and never stored. Restreaming uses LiveKit transcoding minutes.</p>
        {restream.map((u, i) => (
          <input
            key={i} value={u} type="password" autoComplete="off" spellCheck={false}
            onChange={(e) => setRestream((r) => r.map((x, j) => (j === i ? e.target.value : x)))}
            placeholder="rtmp://a.rtmp.youtube.com/live2/your-stream-key"
            aria-label={`Restream address ${i + 1}`}
            className="w-full h-9 px-2.5 text-[13px] tc"
          />
        ))}
        {restream.length < 3 && (
          <button onClick={() => setRestream((r) => [...r, ""])} className="text-[13px] text-paper-2 underline underline-offset-2 hover:text-paper no-min">Add another</button>
        )}
      </fieldset>

      {shareBox}

      <div className="space-y-2">
        <button onClick={() => void goLive()} disabled={!support?.recorder} className="btn btn-signal h-10 px-5">Go live</button>
        {err && <p className="text-[13.5px] text-error" role="alert">{err}</p>}
      </div>
    </div>
  );
}
