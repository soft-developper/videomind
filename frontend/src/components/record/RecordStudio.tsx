"use client";
// vm_record: record the screen or the camera, with the microphone, in the
// browser, then send the recording through the usual upload.
//
// The recording is kept in the browser until it is uploaded (Chrome keeps
// large recordings on disk, not in memory). Closing the tab before
// uploading loses it, so the page warns, and a copy can be downloaded.
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Monitor, Camera, Mic, MicOff, Pause, Play, Square } from "lucide-react";
import { clsx } from "clsx";
import { UploadZone } from "@/components/upload/UploadZone";
import {
  canRecord, openInputs, pickType, fixWebmDuration, recordingTitle,
  VIDEO_BITS, AUDIO_BITS, MAX_SECONDS, type Source, type Inputs,
} from "@/lib/record";

const clock = (sec: number) => {
  const s = Math.max(0, Math.floor(sec)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
};
const size = (n: number) => (n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(2)} GB`);

type Phase =
  | { at: "setup" }
  | { at: "recording"; paused: boolean }
  | { at: "done"; file: File; url: string; seconds: number; title: string }
  | { at: "upload"; file: File; title: string };

/** Why the browser said no, in words a person can act on. */
function reason(err: any, source: Source): string {
  const name = String(err?.name ?? "");
  if (name === "NotAllowedError") return source === "screen"
    ? "Sharing was cancelled, or the browser is not allowed to record the screen. Try again and choose what to share."
    : "The browser was not allowed to use the camera or microphone. Allow it in the address bar, then try again.";
  if (name === "NotFoundError") return source === "camera" ? "No camera or microphone was found." : "No microphone was found. Turn the microphone off, or connect one.";
  if (name === "NotReadableError") return "The camera or microphone is being used by another app. Close it and try again.";
  return `Recording could not start: ${err?.message ?? "unknown error"}.`;
}

export function RecordStudio() {
  const [support, setSupport] = useState<ReturnType<typeof canRecord> | null>(null);
  const [source, setSource] = useState<Source>("screen");
  const [mic, setMic] = useState(true);
  const [systemAudio, setSystemAudio] = useState(true);
  const [phase, setPhase] = useState<Phase>({ at: "setup" });
  const [err, setErr] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [bytes, setBytes] = useState(0);
  const [level, setLevel] = useState(0);

  const inputs = useRef<Inputs | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const parts = useRef<Blob[]>([]);
  // Time recorded so far, not counting pauses: what is banked plus the running stretch.
  const banked = useRef(0);
  const runningSince = useRef<number | null>(null);
  const preview = useRef<HTMLVideoElement>(null);
  const meter = useRef<{ ctx: AudioContext; raf: number } | null>(null);

  useEffect(() => { setSupport(canRecord()); }, []);
  const seconds = () => banked.current + (runningSince.current ? (performance.now() - runningSince.current) / 1000 : 0);

  // Leaving the page loses a recording that has not been uploaded.
  const unsaved = phase.at === "recording" || phase.at === "done";
  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  const stopMeter = () => {
    if (meter.current) { cancelAnimationFrame(meter.current.raf); meter.current.ctx.close().catch(() => {}); meter.current = null; }
    setLevel(0);
  };
  const startMeter = (stream: MediaStream) => {
    const track = stream.getAudioTracks()[0];
    if (!track) return;
    const ctx = new AudioContext();
    const an = ctx.createAnalyser(); an.fftSize = 512;
    ctx.createMediaStreamSource(new MediaStream([track])).connect(an);
    const data = new Uint8Array(an.fftSize);
    const tick = () => {
      an.getByteTimeDomainData(data);
      let peak = 0; for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i] - 128));
      setLevel(Math.min(1, peak / 100));
      meter.current!.raf = requestAnimationFrame(tick);
    };
    meter.current = { ctx, raf: requestAnimationFrame(tick) };
  };

  const finish = useCallback(async () => {
    const r = rec.current;
    if (!r || r.state === "inactive") return;
    if (runningSince.current) { banked.current += (performance.now() - runningSince.current) / 1000; runningSince.current = null; }
    await new Promise<void>((resolve) => { r.addEventListener("stop", () => resolve(), { once: true }); r.stop(); });
    inputs.current?.stop(); inputs.current = null; stopMeter();
    const type = r.mimeType || "video/webm";
    let blob = new Blob(parts.current, { type });
    parts.current = [];
    const secs = banked.current;
    if (type.startsWith("video/webm")) blob = await fixWebmDuration(blob, Math.round(secs * 1000));
    const title = recordingTitle();
    const ext = type.startsWith("video/mp4") ? ".mp4" : ".webm";
    const file = new File([blob], `${title.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase()}${ext}`, { type: type.split(";")[0] });
    setPhase({ at: "done", file, url: URL.createObjectURL(file), seconds: secs, title });
  }, []);

  // A clock for the screen, and the stop at the longest recording allowed.
  useEffect(() => {
    if (phase.at !== "recording") return;
    const t = setInterval(() => {
      const s = seconds(); setElapsed(s);
      if (s >= MAX_SECONDS) void finish();
    }, 250);
    return () => clearInterval(t);
  }, [phase, finish]);

  const start = async () => {
    setErr(null);
    const type = pickType();
    if (!type) { setErr("This browser cannot record video."); return; }
    let ins: Inputs;
    try { ins = await openInputs(source, { mic, systemAudio: source === "screen" && systemAudio }); }
    catch (e) { setErr(reason(e, source)); return; }
    inputs.current = ins;
    parts.current = []; banked.current = 0; setBytes(0); setElapsed(0);
    const r = new MediaRecorder(ins.stream, { mimeType: type, videoBitsPerSecond: VIDEO_BITS, audioBitsPerSecond: AUDIO_BITS });
    r.ondataavailable = (e) => { if (e.data.size) { parts.current.push(e.data); setBytes((b) => b + e.data.size); } };
    r.onerror = () => { setErr("The browser stopped recording. What was recorded so far is kept."); void finish(); };
    rec.current = r;
    // Ending the share from the browser's own bar ends the recording.
    ins.onEnded(() => { void finish(); });
    r.start(1000);
    runningSince.current = performance.now();
    if (preview.current) { preview.current.srcObject = ins.preview; preview.current.play().catch(() => {}); }
    startMeter(ins.stream);
    setPhase({ at: "recording", paused: false });
  };

  const pause = () => {
    const r = rec.current; if (!r) return;
    if (r.state === "recording") {
      r.pause();
      if (runningSince.current) { banked.current += (performance.now() - runningSince.current) / 1000; runningSince.current = null; }
      setPhase({ at: "recording", paused: true });
    } else if (r.state === "paused") {
      r.resume(); runningSince.current = performance.now();
      setPhase({ at: "recording", paused: false });
    }
  };

  const discard = () => {
    if (phase.at === "done") {
      if (!window.confirm("Throw this recording away? It has not been uploaded.")) return;
      URL.revokeObjectURL(phase.url);
    }
    setPhase({ at: "setup" }); setElapsed(0); setBytes(0);
  };

  // Stop everything if the page is left mid recording.
  useEffect(() => () => { inputs.current?.stop(); stopMeter(); }, []);
  // The preview element exists only while recording.
  useEffect(() => {
    if (phase.at === "recording" && preview.current && inputs.current && !preview.current.srcObject) {
      preview.current.srcObject = inputs.current.preview; preview.current.play().catch(() => {});
    }
  }, [phase]);

  if (!support) return null;
  if (!support.recorder || (!support.screen && !support.camera)) {
    return <p className="text-[14px] text-dim max-w-[60ch]">This browser cannot record video. Use a recent Chrome, Edge, Firefox or Safari on a computer, or record with another app and upload the file.</p>;
  }

  if (phase.at === "upload") {
    return (
      <Suspense fallback={<div className="h-48 scan rounded-lg" />}>
        <UploadZone initialFile={phase.file} initialTitle={phase.title} />
      </Suspense>
    );
  }

  if (phase.at === "done") {
    return (
      <div className="space-y-4 max-w-[860px]">
        <video src={phase.url} controls playsInline className="w-full aspect-video rounded-md bg-black" aria-label="Your recording" />
        <p className="tc" data-recording-done>
          {clock(phase.seconds)}, {size(phase.file.size)}, {phase.file.type === "video/mp4" ? "MP4" : "WebM"}
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setPhase({ at: "upload", file: phase.file, title: phase.title })} className="btn btn-signal h-9 px-4">Upload this recording</button>
          <a href={phase.url} download={phase.file.name} className="btn btn-ghost h-9 px-3.5 inline-flex items-center">Download a copy</a>
          <button onClick={discard} className="btn btn-ghost h-9 px-3.5">Record again</button>
        </div>
        <p className="text-[13px] text-dim">The recording is only in this browser until it is uploaded.</p>
      </div>
    );
  }

  if (phase.at === "recording") {
    return (
      <div className="space-y-4 max-w-[860px]">
        <div className="relative">
          <video ref={preview} muted playsInline className="w-full aspect-video rounded-md bg-black object-contain" aria-label="What is being recorded" />
          <span className="absolute left-3 top-3 flex items-center gap-2 bg-black/70 rounded px-2.5 h-7">
            <span className={clsx("w-2.5 h-2.5 rounded-full", phase.paused ? "bg-dim" : "bg-error animate-pulse")} />
            <span className="tc text-paper" data-recording-clock>{phase.paused ? "Paused" : "Recording"} {clock(elapsed)}</span>
          </span>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={pause} className="btn btn-ghost h-9 px-3.5 inline-flex items-center gap-1.5">
            {phase.paused ? <><Play size={13} /> Resume</> : <><Pause size={13} /> Pause</>}
          </button>
          <button onClick={() => void finish()} className="btn btn-signal h-9 px-4 inline-flex items-center gap-1.5"><Square size={12} /> Stop</button>
          <span className="tc">{size(bytes)}</span>
          {mic && (
            <span className="flex items-center gap-2" aria-label="Sound level">
              <Mic size={13} className="text-dim" />
              <span className="w-24 h-1.5 rounded-full bg-rule overflow-hidden"><span className="block h-full bg-marker" style={{ width: `${Math.round(level * 100)}%` }} /></span>
            </span>
          )}
        </div>
        <p className="text-[13px] text-dim">Recording stops by itself at {clock(MAX_SECONDS)}. {source === "screen" ? "Ending the share from the browser's bar stops it too." : ""}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[640px]">
      <fieldset>
        <legend className="text-[13px] font-medium text-paper mb-2">Record</legend>
        <div className="grid sm:grid-cols-2 gap-3">
          {([
            ["screen", "Screen", "A window, a browser tab or the whole screen. Slides and demos.", Monitor, support.screen],
            ["camera", "Camera", "You, talking to the camera.", Camera, support.camera],
          ] as const).map(([id, label, note, Icon, ok]) => (
            <label key={id} className={clsx("flex gap-3 p-3.5 rounded-md border cursor-pointer", source === id ? "border-paper bg-slate-2" : "border-rule hover:border-rule-lit", !ok && "opacity-40 cursor-not-allowed")}>
              <input type="radio" name="record-source" className="sr-only" checked={source === id} disabled={!ok} onChange={() => setSource(id)} />
              <Icon size={18} className="text-paper-2 shrink-0 mt-0.5" />
              <span>
                <span className="block text-[14px] text-paper">{label}</span>
                <span className="block text-[12.5px] text-dim mt-0.5">{ok ? note : "This browser cannot do this."}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="space-y-2.5">
        <label className="flex items-center gap-2.5 text-[13.5px] text-paper-2 cursor-pointer">
          <input type="checkbox" checked={mic} onChange={(e) => setMic(e.target.checked)} />
          {mic ? <Mic size={13} /> : <MicOff size={13} />} Record my microphone
        </label>
        {source === "screen" && (
          <label className="flex items-center gap-2.5 text-[13.5px] text-paper-2 cursor-pointer">
            <input type="checkbox" checked={systemAudio} onChange={(e) => setSystemAudio(e.target.checked)} />
            Include the sound of what I share, when the browser offers it
          </label>
        )}
      </div>

      <div className="space-y-2">
        <button onClick={() => void start()} className="btn btn-signal h-10 px-5">Start recording</button>
        {err && <p className="text-[13.5px] text-error" role="alert">{err}</p>}
        <p className="text-[13px] text-dim">The browser asks what to share and for the microphone. Nothing is sent until you choose to upload.</p>
      </div>
    </div>
  );
}
