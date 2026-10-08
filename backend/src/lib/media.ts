// src/lib/media.ts
// vm_media: what FFmpeg does for VideoMind today.
//
//   probeFile      the facts of a video: length, size, codecs
//   makePictures   one frame as two JPEGs, for the player and the cards
//
// Both read the original where it lies. For a file in the bucket that
// is a signed address, so a 10 GB lecture is never copied to this
// machine: FFmpeg asks storage for the few byte ranges it needs.
//
// Turning videos into streams (HLS) is NOT done here. It was measured
// on this service on 8 Oct 2026 and runs at about half playback speed
// for 360p alone, so it waits for more compute.
//
// The file is whatever a user uploaded, so FFmpeg is only allowed to
// treat it as a plain video container. Formats that are really lists of
// other addresses (HLS, concat, and so on) are refused: opened here,
// they would make this server fetch whatever the list names.
import { spawn } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import type { MediaFacts } from "../types/video.js";

/** Containers a browser upload can be: MP4 and MOV, MKV and WebM, AVI. */
const FORMATS = "mov,matroska,avi";

export class MediaError extends Error {
  constructor(public code: string, message: string, public retryable: boolean) {
    super(message); this.name = "MediaError";
  }
}

interface Ran { code: number | null; signal: string | null; out: string; err: string; timedOut: boolean; missing: boolean }

function run(cmd: string, args: string[], timeoutMs: number): Promise<Ran> {
  return new Promise((resolve) => {
    let out = "", err = "", timedOut = false, missing = false, done = false;
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    // The web server shares this CPU: FFmpeg runs at low priority.
    if (child.pid) { try { os.setPriority(child.pid, 10); } catch {} }
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
    const end = (code: number | null, signal: string | null) => {
      if (done) return; done = true;
      clearTimeout(timer);
      resolve({ code, signal, out, err: err.slice(-2000), timedOut, missing });
    };
    child.stdout.on("data", (d) => { if (out.length < 2_000_000) out += d; });
    child.stderr.on("data", (d) => { err += d; if (err.length > 20_000) err = err.slice(-10_000); });
    child.on("error", (e: NodeJS.ErrnoException) => { missing = e.code === "ENOENT"; err += String(e.message); end(null, null); });
    child.on("close", (code, signal) => end(code, signal));
  });
}

/** Where FFmpeg reads from, and which protocols it may use to get there. */
function inputArgs(input: string): string[] {
  const remote = /^https?:\/\//i.test(input);
  return [
    "-protocol_whitelist", remote ? "http,https,tls,tcp" : "file",
    "-format_whitelist", FORMATS,
    // A stalled connection to storage ends the read instead of hanging the job.
    ...(remote ? ["-rw_timeout", "30000000"] : []),
    "-i", input,
  ];
}

/** Turn a failed run into an error that says whether trying again can help. */
function failure(r: Ran, what: string): MediaError {
  if (r.missing) return new MediaError("no_ffmpeg", "FFmpeg is not installed on this server.", false);
  if (r.timedOut) return new MediaError("media_timeout", `${what} took too long and was stopped.`, true);
  if (r.signal === "SIGKILL") return new MediaError("media_killed", `${what} was stopped by the system, most likely for using too much memory.`, true);
  const text = r.err.replace(/https?:\/\/\S+/g, "[address]");            // never keep a signed address in an error
  // Storage or the network: worth another attempt.
  if (/timed out|Connection (refused|reset)|HTTP error 5|Server returned 5|I\/O error|Temporary failure|Network is unreachable|Broken pipe/i.test(text)) {
    return new MediaError("media_network", `${what} could not read the file from storage.`, true);
  }
  if (/HTTP error 40[34]|Server returned 40[34]|No such file/i.test(text)) {
    return new MediaError("source_missing", "The uploaded file is no longer in storage.", false);
  }
  const last = text.trim().split("\n").filter(Boolean).pop() ?? "";
  return new MediaError("unreadable", `${what} could not read this file as a video${last ? `: ${last.slice(0, 200)}` : "."}`, false);
}

// ── what is installed ─────────────────────────────────────────────────────

let tools: { ffmpeg: string | null; checkedAt: number } | null = null;

/** Look for FFmpeg once at startup. Its absence is logged and nothing else stops working. */
export async function checkMediaTools(): Promise<string | null> {
  const r = await run("ffmpeg", ["-hide_banner", "-version"], 15_000);
  const version = r.code === 0 ? (/ffmpeg version (\S+)/.exec(r.out)?.[1] ?? "unknown") : null;
  tools = { ffmpeg: version, checkedAt: Date.now() };
  if (version) console.log(`[media] ffmpeg ${version}`);
  else console.warn("[media] FFmpeg was not found. Uploads still work; thumbnails and video facts are skipped.");
  return version;
}

export function mediaHealth(): { ffmpeg: string | null } {
  return { ffmpeg: tools?.ffmpeg ?? null };
}

// ── facts ─────────────────────────────────────────────────────────────────

function rate(v: unknown): number | undefined {
  const m = /^(\d+)\/(\d+)$/.exec(String(v ?? ""));
  if (!m || Number(m[2]) === 0) return undefined;
  const fps = Number(m[1]) / Number(m[2]);
  return fps > 0 && fps < 1000 ? Math.round(fps * 100) / 100 : undefined;
}

const num = (v: unknown): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/**
 * Can browsers play this file as it is? "yes" means all current ones,
 * "some" means it depends on the browser or the device, "no" means none.
 */
export function browserPlayable(f: Pick<MediaFacts, "container" | "videoCodec" | "audioCodec" | "pixelFormat" | "hasVideo">): "yes" | "some" | "no" {
  if (!f.hasVideo) return "no";
  const container = f.container ?? "";
  const v = f.videoCodec ?? "";
  const a = f.audioCodec ?? "";
  if (container === "avi") return "no";
  const eightBit = !f.pixelFormat || /^yuvj?420p$/.test(f.pixelFormat);
  let video: "yes" | "some" | "no";
  if (v === "h264") video = eightBit ? "yes" : "no";
  else if (v === "vp8" || v === "vp9") video = "yes";
  else if (v === "av1" || v === "hevc") video = "some";
  else video = "no";
  if (video === "no") return "no";
  const audio: "yes" | "some" = !a || ["aac", "mp3", "opus", "vorbis"].includes(a) ? "yes" : "some";   // a video with odd sound still shows its picture
  // H.264 in MP4 or MOV and VP8/VP9 in WebM are the safe pairs. MKV plays in some browsers only.
  const pair = container === "mp4" ? (v === "vp8" ? "some" : "yes")
    : container === "webm" ? (v === "vp8" || v === "vp9" || v === "av1" ? "yes" : "some")
    : "some";
  return video === "yes" && audio === "yes" && pair === "yes" ? "yes" : "some";
}

function containerOf(formatName: string, majorBrand: string | undefined, input: string): string {
  const ext = path.extname(input.split("?")[0]).toLowerCase();
  if (/matroska|webm/.test(formatName)) return ext === ".webm" ? "webm" : (ext === ".mkv" ? "mkv" : "webm");
  if (/avi/.test(formatName)) return "avi";
  if (/mov|mp4/.test(formatName)) return (majorBrand ?? "").trim().toLowerCase() === "qt" ? "mov" : "mp4";
  return formatName.split(",")[0] || "unknown";
}

export async function probeFile(input: string, timeoutMs = 60_000): Promise<MediaFacts> {
  const r = await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", ...inputArgs(input)], timeoutMs);
  if (r.code !== 0) throw failure(r, "Reading the video");
  let j: any;
  try { j = JSON.parse(r.out); } catch { throw new MediaError("unreadable", "Reading the video gave an answer that could not be understood.", false); }
  const streams: any[] = Array.isArray(j.streams) ? j.streams : [];
  // A cover picture inside an audio file is reported as a video stream. It is not one.
  const video = streams.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  const audio = streams.find((s) => s.codec_type === "audio");
  const duration = num(j.format?.duration) ?? num(video?.duration) ?? num(audio?.duration);
  // A phone held upright records a sideways picture plus a note to turn it.
  const turn = Number(video?.tags?.rotate ?? (video?.side_data_list ?? []).find((d: any) => d.rotation !== undefined)?.rotation ?? 0);
  const sideways = Math.abs(turn) % 180 === 90;
  const width = num(video?.width), height = num(video?.height);
  const facts: MediaFacts = {
    hasVideo: !!video,
    hasAudio: !!audio,
    durationSeconds: duration !== undefined ? Math.round(duration * 1000) / 1000 : undefined,
    width: sideways ? height : width,
    height: sideways ? width : height,
    fps: rate(video?.avg_frame_rate) ?? rate(video?.r_frame_rate),
    videoCodec: video?.codec_name ? String(video.codec_name) : undefined,
    audioCodec: audio?.codec_name ? String(audio.codec_name) : undefined,
    pixelFormat: video?.pix_fmt ? String(video.pix_fmt) : undefined,
    container: containerOf(String(j.format?.format_name ?? ""), j.format?.tags?.major_brand, input),
    bitrateKbps: num(j.format?.bit_rate) !== undefined ? Math.round(num(j.format?.bit_rate)! / 1000) : undefined,
    playable: "no",
    inspectedAt: Date.now(),
  };
  facts.playable = browserPlayable(facts);
  return facts;
}

// ── pictures ──────────────────────────────────────────────────────────────

export interface Pictures { poster: string; thumb: string }

/** The moment the picture is taken: a tenth of the way in, where a lecture usually shows its first slide. */
export function pictureTime(durationSeconds: number | undefined): number {
  if (!durationSeconds || durationSeconds < 2) return 0;
  return Math.round(Math.min(durationSeconds * 0.1, 120) * 100) / 100;
}

/**
 * Write poster.jpg (up to 1280 wide, for the player) and thumb.jpg (up
 * to 480 wide, for library cards) into dir. One frame is decoded once
 * and scaled twice. Neither is ever made larger than the video.
 */
export async function makePictures(input: string, atSeconds: number, dir: string, timeoutMs = 180_000): Promise<Pictures> {
  const poster = path.join(dir, "poster.jpg"), thumb = path.join(dir, "thumb.jpg");
  const attempt = (at: number) => run("ffmpeg", [
    "-hide_banner", "-nostdin", "-loglevel", "error", "-y",
    "-threads", "1",                                  // one decoder thread: a 4K frame must fit in this service's memory
    "-ss", String(at), ...inputArgs(input),
    "-an", "-sn", "-dn",
    "-filter_complex", "[0:v:0]scale='min(1280,iw)':-2,split=2[big][s];[s]scale='min(480,iw)':-2[small]",
    "-map", "[big]", "-frames:v", "1", "-q:v", "4", "-update", "1", poster,
    "-map", "[small]", "-frames:v", "1", "-q:v", "5", "-update", "1", thumb,
  ], timeoutMs);
  const made = async () => ((await fs.stat(poster).catch(() => null))?.size ?? 0) > 0 && ((await fs.stat(thumb).catch(() => null))?.size ?? 0) > 0;

  let r = await attempt(atSeconds);
  // Some files report a length they do not have. If nothing came out, take the first frame.
  if (r.code === 0 && !(await made()) && atSeconds > 0) r = await attempt(0);
  if (r.code !== 0) throw failure(r, "Taking a picture");
  if (!(await made())) throw new MediaError("no_picture", "No picture could be taken from this video.", false);
  return { poster, thumb };
}
