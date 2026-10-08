// vm_record: recording in the browser with MediaRecorder.
//
// What is recorded is the screen (with the tab's or system sound when the
// browser offers it) or the camera, plus the microphone. Sounds are mixed
// with an AudioContext, which keeps running when the tab is in the
// background, as it is while the screen is being recorded.
//
// Format: MP4 where the browser can write it (Chrome 126 and later,
// Safari), otherwise WebM. Chrome's WebM states no duration, so players
// cannot seek in it: fixWebmDuration() writes the duration into the file's
// header when recording stops. (The server also measures files that state
// no duration; see measureDuration in backend/src/lib/media.ts.)

export type Source = "screen" | "camera";

/** Formats in order of preference. */
const TYPES = [
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4;codecs=avc1,mp4a.40.2",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

export function pickType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  return TYPES.find((t) => { try { return MediaRecorder.isTypeSupported(t); } catch { return false; } }) ?? null;
}

export function canRecord(): { screen: boolean; camera: boolean; recorder: boolean } {
  const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
  return {
    screen: !!md && typeof md.getDisplayMedia === "function",
    camera: !!md && typeof md.getUserMedia === "function",
    recorder: !!pickType(),
  };
}

/** About 2.5 Mbit/s for the picture: a 720p or 1080p screen stays sharp, an hour is a little over 1 GB. */
export const VIDEO_BITS = 2_500_000;
export const AUDIO_BITS = 128_000;
/** Recording stops by itself after this long. Transcription takes up to 4 hours per video. */
export const MAX_SECONDS = 3 * 3600;

export interface Inputs {
  stream: MediaStream;       // what the recorder records: one video track, at most one mixed audio track
  preview: MediaStream;      // what the page shows while recording
  stop: () => void;          // ends every track and the audio mixing
  /** called when the person ends the screen share from the browser's own bar */
  onEnded: (fn: () => void) => void;
}

/** Ask the browser for the screen or camera, and the microphone, and mix the sound. */
export async function openInputs(source: Source, opts: { mic: boolean; micId?: string; systemAudio: boolean }): Promise<Inputs> {
  const md = navigator.mediaDevices;
  const tracks: MediaStreamTrack[] = [];
  let picture: MediaStream;
  if (source === "screen") {
    picture = await md.getDisplayMedia({
      video: { frameRate: { ideal: 30, max: 30 }, width: { ideal: 1920, max: 1920 }, height: { ideal: 1080, max: 1080 } },
      audio: opts.systemAudio,
    });
  } else {
    picture = await md.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } }, audio: false });
  }
  tracks.push(...picture.getTracks());
  let mic: MediaStream | null = null;
  if (opts.mic) {
    try {
      mic = await md.getUserMedia({ audio: { deviceId: opts.micId ? { exact: opts.micId } : undefined, echoCancellation: true, noiseSuppression: true } });
      tracks.push(...mic.getTracks());
    } catch (err) {
      tracks.forEach((t) => t.stop());
      throw err;
    }
  }

  // Mix every sound into one track.
  const sounds = [...picture.getAudioTracks(), ...(mic?.getAudioTracks() ?? [])];
  let ctx: AudioContext | null = null;
  let mixed: MediaStreamTrack | null = null;
  if (sounds.length) {
    ctx = new AudioContext();
    const out = ctx.createMediaStreamDestination();
    for (const t of sounds) ctx.createMediaStreamSource(new MediaStream([t])).connect(out);
    mixed = out.stream.getAudioTracks()[0] ?? null;
  }
  const video = picture.getVideoTracks()[0];
  const stream = new MediaStream([video, ...(mixed ? [mixed] : [])]);
  return {
    stream,
    preview: new MediaStream([video]),
    stop: () => { tracks.forEach((t) => t.stop()); mixed?.stop(); ctx?.close().catch(() => {}); },
    onEnded: (fn) => { video.addEventListener("ended", fn, { once: true }); },
  };
}

// ── WebM duration ─────────────────────────────────────────────────────────────

const ID_SEGMENT = 0x18538067, ID_INFO = 0x1549a966, ID_TIMECODE_SCALE = 0x2ad7b1, ID_DURATION = 0x4489;

function readId(b: Uint8Array, at: number): { id: number; len: number } | null {
  const first = b[at];
  if (first === undefined || first === 0) return null;
  let len = 1;
  while (len <= 4 && !(first & (0x80 >> (len - 1)))) len++;
  if (len > 4 || at + len > b.length) return null;
  let id = 0;
  for (let i = 0; i < len; i++) id = id * 256 + b[at + i];
  return { id, len };
}
function readSize(b: Uint8Array, at: number): { size: number; len: number; unknown: boolean } | null {
  const first = b[at];
  if (first === undefined || first === 0) return null;
  let len = 1;
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
  if (len > 8 || at + len > b.length) return null;
  let size = first & (0xff >> len);
  let allOnes = size === (0xff >> len);
  for (let i = 1; i < len; i++) { size = size * 256 + b[at + i]; if (b[at + i] !== 0xff) allOnes = false; }
  return { size, len, unknown: allOnes };
}
function writeSize(size: number, len: number): Uint8Array<ArrayBuffer> | null {
  if (size >= 2 ** (7 * len) - 1) return null;
  const out = new Uint8Array(len);
  let v = size;
  for (let i = len - 1; i >= 0; i--) { out[i] = v % 256; v = Math.floor(v / 256); }
  out[0] |= 0x80 >> (len - 1);
  return out;
}

/**
 * Write the duration into a WebM file's Segment Info, so players can seek.
 * Only the first 256 KB is read; the rest of the file is passed through.
 * Returns the blob unchanged when it cannot be done safely.
 */
export async function fixWebmDuration(blob: Blob, durationMs: number): Promise<Blob> {
  try {
    const head: Uint8Array<ArrayBuffer> = new Uint8Array(await blob.slice(0, 256 * 1024).arrayBuffer());
    let at = 0;
    // EBML header
    const h = readId(head, at); if (!h || h.id !== 0x1a45dfa3) return blob;
    const hs = readSize(head, at + h.len); if (!hs || hs.unknown) return blob;
    at += h.len + hs.len + hs.size;
    // Segment
    const seg = readId(head, at); if (!seg || seg.id !== ID_SEGMENT) return blob;
    const segSizeAt = at + seg.len;
    const ss = readSize(head, segSizeAt); if (!ss) return blob;
    at = segSizeAt + ss.len;
    // Children of the Segment, up to Info
    while (at < head.length) {
      const c = readId(head, at); if (!c) return blob;
      const cs = readSize(head, at + c.len); if (!cs || cs.unknown) return blob;
      if (c.id !== ID_INFO) { at += c.len + cs.len + cs.size; continue; }
      const infoStart = at, contentStart = at + c.len + cs.len, contentEnd = contentStart + cs.size;
      if (contentEnd > head.length) return blob;
      // Inside Info: the timecode scale and any duration
      let scale = 1_000_000, durAt = -1, durLen = 0;
      for (let p = contentStart; p < contentEnd;) {
        const e = readId(head, p); if (!e) return blob;
        const es = readSize(head, p + e.len); if (!es) return blob;
        const v = p + e.len + es.len;
        if (e.id === ID_TIMECODE_SCALE) { let x = 0; for (let i = 0; i < es.size; i++) x = x * 256 + head[v + i]; if (x > 0) scale = x; }
        if (e.id === ID_DURATION) { durAt = v; durLen = es.size; }
        p = v + es.size;
      }
      const value = (durationMs * 1_000_000) / scale;
      if (durAt >= 0 && (durLen === 8 || durLen === 4)) {
        const out = head.slice(0, contentEnd);
        const dv = new DataView(out.buffer);
        if (durLen === 8) dv.setFloat64(durAt, value); else dv.setFloat32(durAt, value);
        return new Blob([out, blob.slice(contentEnd)], { type: blob.type });
      }
      // No duration yet: add one (ID 0x4489, 8 byte float) at the end of Info.
      const add = new Uint8Array(11);
      add.set([0x44, 0x89, 0x88]);
      new DataView(add.buffer).setFloat64(3, value);
      const newInfoSize = writeSize(cs.size + 11, cs.len) ?? writeSize(cs.size + 11, 8);
      if (!newInfoSize) return blob;
      const grow = 11 + (newInfoSize.length - cs.len);
      const parts: BlobPart[] = [];
      // A Segment of known size grows with it; one of unknown size is left as it is.
      if (!ss.unknown) {
        const newSeg = writeSize(ss.size + grow, ss.len); if (!newSeg) return blob;
        parts.push(head.slice(0, segSizeAt), newSeg, head.slice(segSizeAt + ss.len, infoStart));
      } else {
        parts.push(head.slice(0, infoStart));
      }
      parts.push(head.slice(infoStart, infoStart + c.len), newInfoSize, head.slice(contentStart, contentEnd), add, blob.slice(contentEnd));
      return new Blob(parts, { type: blob.type });
    }
    return blob;
  } catch {
    return blob;
  }
}

/** "Recording 8 Oct 2026, 14:30" */
export function recordingTitle(d = new Date()): string {
  return `Recording ${d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}, ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}
