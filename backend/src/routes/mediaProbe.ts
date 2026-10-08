// src/routes/mediaProbe.ts
// vm_media_probe: a measurement, not a feature. It answers one question
// before transcoding is built: can THIS server run FFmpeg, and how fast?
//
//   GET /api/health/media          what this server is, and the last run
//   GET /api/health/media?run=1    start a run (one at a time, at most
//                                  one every 10 minutes), then show it
//
// A run makes its own test video (no user file is touched), then does
// the work transcoding would do, smallest first: one picture, a 360p
// stream, a 720p + 360p ladder, a 1080p stream. Every step is written to
// the database BEFORE it starts, so if the server is stopped for using
// too much memory, the step that did it is still on record.
//
// This file and its table (media_probe_steps) are removed when
// transcoding itself is built.
import { Router } from "express";
import { spawn } from "child_process";
import crypto from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { getDb } from "../lib/db.js";

const router = Router();

const COOLDOWN_MS = 10 * 60_000;
const STEP_TIMEOUT_MS = 4 * 60_000;
const SOURCE_SECONDS = 20;
const SOURCE_1080_SECONDS = 10;

let running: string | null = null;      // run id, while a run is in progress in this process
let tableReady: Promise<void> | null = null;

function ready(): Promise<void> {
  tableReady ??= getDb().execute(`CREATE TABLE IF NOT EXISTS media_probe_steps (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id      TEXT NOT NULL,
    step        TEXT NOT NULL,
    state       TEXT NOT NULL,
    detail      TEXT,
    started_at  INTEGER NOT NULL,
    finished_at INTEGER
  )`).then(() => undefined).catch((err) => { tableReady = null; throw err; });
  return tableReady;
}

// ── running a command ─────────────────────────────────────────────────────

interface Ran { code: number | null; signal: string | null; ms: number; out: string; err: string; peakMb: number | null; timedOut: boolean; missing: boolean }

/** Highest memory the process has used so far, in MB. Linux only. */
async function peakOf(pid: number): Promise<number | null> {
  try {
    const status = await fs.readFile(`/proc/${pid}/status`, "utf8");
    const m = /VmHWM:\s+(\d+)\s+kB/.exec(status);
    return m ? Math.round(Number(m[1]) / 1024) : null;
  } catch { return null; }
}

function run(cmd: string, args: string[], timeoutMs = STEP_TIMEOUT_MS): Promise<Ran> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let out = "", err = "", peakMb: number | null = null, timedOut = false, missing = false, done = false;
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    // The web server comes first: the measurement runs at low priority.
    if (child.pid) { try { os.setPriority(child.pid, 10); } catch {} }
    const poll = setInterval(async () => {
      if (!child.pid) return;
      const p = await peakOf(child.pid);
      if (p !== null && (peakMb === null || p > peakMb)) peakMb = p;
    }, 200);
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
    const end = (code: number | null, signal: string | null) => {
      if (done) return; done = true;
      clearInterval(poll); clearTimeout(timer);
      resolve({ code, signal, ms: Date.now() - t0, out, err: err.slice(-1500), peakMb, timedOut, missing });
    };
    child.stdout.on("data", (d) => { if (out.length < 200_000) out += d; });
    child.stderr.on("data", (d) => { err += d; if (err.length > 20_000) err = err.slice(-10_000); });
    child.on("error", (e: NodeJS.ErrnoException) => { missing = e.code === "ENOENT"; err += String(e.message); end(null, null); });
    child.on("close", (code, signal) => end(code, signal));
  });
}

// ── what this server is ───────────────────────────────────────────────────

const readText = (p: string) => fs.readFile(p, "utf8").then((s) => s.trim()).catch(() => null);

async function environment() {
  const cpuMax = await readText("/sys/fs/cgroup/cpu.max");                 // "<quota> <period>" or "max <period>"
  const memMax = await readText("/sys/fs/cgroup/memory.max");
  let cpuLimit: number | null = null;
  if (cpuMax) {
    const [quota, period] = cpuMax.split(/\s+/);
    if (quota !== "max" && Number(period) > 0) cpuLimit = Math.round((Number(quota) / Number(period)) * 100) / 100;
  }
  const memLimitMb = memMax && memMax !== "max" && Number(memMax) > 0 ? Math.round(Number(memMax) / 1048576) : null;
  let tmpFreeMb: number | null = null;
  try {
    const st = await (fs as any).statfs(os.tmpdir());
    tmpFreeMb = Math.round((Number(st.bavail) * Number(st.bsize)) / 1048576);
  } catch {}
  return {
    node: process.version,
    platform: `${os.platform()} ${os.arch()}`,
    cpusVisible: os.cpus().length,
    cpuModel: os.cpus()[0]?.model ?? null,
    /** CPUs this service may actually use. null means no limit was found. */
    cpuLimit,
    memoryTotalMb: Math.round(os.totalmem() / 1048576),
    /** Memory this service may use before it is stopped. null means no limit was found. */
    memoryLimitMb: memLimitMb,
    serverMemoryNowMb: Math.round(process.memoryUsage().rss / 1048576),
    tmpDir: os.tmpdir(),
    tmpFreeMb,
    onRender: !!process.env.RENDER,
    renderServiceType: process.env.RENDER_SERVICE_TYPE ?? null,
    commit: (process.env.RENDER_GIT_COMMIT ?? "").slice(0, 7) || null,
  };
}

// ── the steps ─────────────────────────────────────────────────────────────

async function dirStats(dir: string): Promise<{ files: number; kb: number; names: string[] }> {
  let files = 0, bytes = 0; const names: string[] = [];
  async function walk(d: string, rel: string) {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name), r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(p, r);
      else { files++; bytes += (await fs.stat(p)).size; if (names.length < 12) names.push(r); }
    }
  }
  await walk(dir, "").catch(() => {});
  return { files, kb: Math.round(bytes / 1024), names };
}

/** What a step reports about an FFmpeg run over `seconds` of video. */
function measured(r: Ran, seconds: number) {
  return {
    ms: r.ms,
    /** above 1 means faster than the video plays */
    speed: r.ms > 0 ? Math.round((seconds / (r.ms / 1000)) * 100) / 100 : null,
    peakMemoryMb: r.peakMb,
  };
}

class StepFailed extends Error {
  constructor(message: string, public detail: Record<string, unknown> = {}) { super(message); }
}

function check(r: Ran, what: string) {
  if (r.missing) throw new StepFailed(`${what}: the program is not installed on this server.`);
  if (r.timedOut) throw new StepFailed(`${what}: stopped after ${STEP_TIMEOUT_MS / 60_000} minutes without finishing.`, { ms: r.ms, peakMemoryMb: r.peakMb });
  // Killed from outside without our timeout: on a small instance this is the system reclaiming memory.
  if (r.signal === "SIGKILL") throw new StepFailed(`${what}: the system stopped FFmpeg. That usually means it used more memory than this service is allowed.`, { ms: r.ms, peakMemoryMb: r.peakMb });
  if (r.code !== 0) throw new StepFailed(`${what}: exit code ${r.code}${r.signal ? `, signal ${r.signal}` : ""}.`, { ms: r.ms, peakMemoryMb: r.peakMb, lastOutput: r.err.slice(-600) });
}

const X264 = ["-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-g", "120", "-keyint_min", "120", "-sc_threshold", "0"];
const HLS = ["-f", "hls", "-hls_time", "4", "-hls_playlist_type", "vod", "-hls_segment_type", "fmp4", "-hls_flags", "independent_segments"];

type Step = { name: string; what: string; run: (dir: string) => Promise<Record<string, unknown>> };

const STEPS: Step[] = [
  {
    name: "tools", what: "FFmpeg and ffprobe are installed, with the encoders and formats transcoding needs",
    run: async () => {
      const v = await run("ffmpeg", ["-hide_banner", "-version"], 20_000); check(v, "ffmpeg -version");
      const p = await run("ffprobe", ["-hide_banner", "-version"], 20_000);
      const enc = await run("ffmpeg", ["-hide_banner", "-encoders"], 20_000);
      const mux = await run("ffmpeg", ["-hide_banner", "-muxers"], 20_000);
      const proto = await run("ffmpeg", ["-hide_banner", "-protocols"], 20_000);
      const has = (text: string, re: RegExp) => re.test(text);
      const result = {
        ffmpeg: v.out.split("\n")[0]?.trim() ?? null,
        ffprobe: p.missing ? null : (p.out.split("\n")[0]?.trim() ?? null),
        libx264: has(enc.out, /\blibx264\b/),
        aac: has(enc.out, /^\s*A\S*\s+aac\b/m),
        mjpeg: has(enc.out, /\bmjpeg\b/),
        hlsMuxer: has(mux.out, /\bhls\b/),
        /** FFmpeg can read a file straight from storage over HTTPS */
        httpsInput: has(proto.out, /\bhttps\b/),
      };
      if (!result.libx264) throw new StepFailed("FFmpeg is installed but has no H.264 encoder (libx264).", result);
      if (!result.hlsMuxer) throw new StepFailed("FFmpeg is installed but cannot write HLS.", result);
      return result;
    },
  },
  {
    name: "source", what: `make a ${SOURCE_SECONDS} second 720p test video with sound (the stand in for an upload)`,
    run: async (dir) => {
      const r = await run("ffmpeg", ["-hide_banner", "-y", "-f", "lavfi", "-i", `testsrc2=size=1280x720:rate=30:duration=${SOURCE_SECONDS}`,
        "-f", "lavfi", "-i", `sine=frequency=440:duration=${SOURCE_SECONDS}`,
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", path.join(dir, "source.mp4")]);
      check(r, "making the test video");
      return { ...measured(r, SOURCE_SECONDS), kb: Math.round((await fs.stat(path.join(dir, "source.mp4"))).size / 1024) };
    },
  },
  {
    name: "probe", what: "read the length, size and codecs of a video (ffprobe)",
    run: async (dir) => {
      const r = await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", path.join(dir, "source.mp4")], 30_000);
      check(r, "ffprobe");
      const j = JSON.parse(r.out);
      const video = (j.streams ?? []).find((s: any) => s.codec_type === "video");
      return { ms: r.ms, durationSeconds: Number(j.format?.duration), width: video?.width, height: video?.height, codec: video?.codec_name };
    },
  },
  {
    name: "thumbnail", what: "take one picture from the video for a library card",
    run: async (dir) => {
      const r = await run("ffmpeg", ["-hide_banner", "-y", "-ss", "5", "-i", path.join(dir, "source.mp4"), "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "4", path.join(dir, "thumb.jpg")], 60_000);
      check(r, "taking a picture");
      return { ms: r.ms, peakMemoryMb: r.peakMb, kb: Math.round((await fs.stat(path.join(dir, "thumb.jpg"))).size / 1024) };
    },
  },
  {
    name: "hls_360p", what: "turn the video into one 360p stream (HLS, 4 second parts)",
    run: async (dir) => {
      const out = path.join(dir, "h360"); await fs.mkdir(out, { recursive: true });
      const r = await run("ffmpeg", ["-hide_banner", "-y", "-i", path.join(dir, "source.mp4"), "-vf", "scale=-2:360", ...X264, "-b:v", "800k", "-maxrate", "856k", "-bufsize", "1200k",
        "-c:a", "aac", "-b:a", "96k", ...HLS, "-hls_segment_filename", path.join(out, "seg_%03d.m4s"), path.join(out, "playlist.m3u8")]);
      check(r, "the 360p stream");
      return { ...measured(r, SOURCE_SECONDS), output: await dirStats(out) };
    },
  },
  {
    name: "hls_ladder", what: "turn the video into 720p and 360p streams in one go, with a master playlist (what a lecture would get)",
    run: async (dir) => {
      const out = path.join(dir, "ladder"); await fs.mkdir(out, { recursive: true });
      const r = await run("ffmpeg", ["-hide_banner", "-y", "-i", path.join(dir, "source.mp4"),
        "-filter_complex", "[0:v]split=2[a][b];[a]scale=-2:720[v720];[b]scale=-2:360[v360]",
        "-map", "[v720]", "-map", "0:a", "-map", "[v360]", "-map", "0:a",
        ...X264, "-b:v:0", "2800k", "-maxrate:v:0", "2996k", "-bufsize:v:0", "4200k", "-b:v:1", "800k", "-maxrate:v:1", "856k", "-bufsize:v:1", "1200k",
        "-c:a", "aac", "-b:a:0", "128k", "-b:a:1", "96k",
        ...HLS, "-master_pl_name", "master.m3u8", "-var_stream_map", "v:0,a:0,name:720p v:1,a:1,name:360p",
        "-hls_segment_filename", path.join(out, "%v", "seg_%03d.m4s"), path.join(out, "%v", "playlist.m3u8")]);
      check(r, "the 720p and 360p ladder");
      const stats = await dirStats(out);
      const master = await fs.readFile(path.join(out, "master.m3u8"), "utf8").catch(() => "");
      return { ...measured(r, SOURCE_SECONDS), output: stats, masterListsBoth: /720p\/playlist\.m3u8/.test(master) && /360p\/playlist\.m3u8/.test(master) };
    },
  },
  {
    name: "hls_1080p", what: `turn ${SOURCE_1080_SECONDS} seconds of 1080p video into a 1080p stream (the heaviest thing transcoding would do)`,
    run: async (dir) => {
      const src = path.join(dir, "source1080.mp4");
      const make = await run("ffmpeg", ["-hide_banner", "-y", "-f", "lavfi", "-i", `testsrc2=size=1920x1080:rate=30:duration=${SOURCE_1080_SECONDS}`,
        "-f", "lavfi", "-i", `sine=frequency=440:duration=${SOURCE_1080_SECONDS}`,
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", src]);
      check(make, "making the 1080p test video");
      const out = path.join(dir, "h1080"); await fs.mkdir(out, { recursive: true });
      const r = await run("ffmpeg", ["-hide_banner", "-y", "-i", src, ...X264, "-b:v", "5000k", "-maxrate", "5350k", "-bufsize", "7500k",
        "-c:a", "aac", "-b:a", "128k", ...HLS, "-hls_segment_filename", path.join(out, "seg_%03d.m4s"), path.join(out, "playlist.m3u8")]);
      check(r, "the 1080p stream");
      return { ...measured(r, SOURCE_1080_SECONDS), makeSourceMs: make.ms, output: await dirStats(out) };
    },
  },
];

async function execute(runId: string) {
  const db = getDb();
  // Folders left behind by a run that was cut off.
  for (const name of await fs.readdir(os.tmpdir()).catch(() => [] as string[])) {
    if (name.startsWith("vm-media-probe-")) await fs.rm(path.join(os.tmpdir(), name), { recursive: true, force: true }).catch(() => {});
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vm-media-probe-"));
  try {
    for (const step of STEPS) {
      const startedAt = Date.now();
      const ins = await db.execute({
        sql: "INSERT INTO media_probe_steps (run_id, step, state, detail, started_at) VALUES (?, ?, 'started', ?, ?)",
        args: [runId, step.name, JSON.stringify({ what: step.what }), startedAt],
      });
      const rowId = Number(ins.lastInsertRowid);
      const finish = (state: string, detail: Record<string, unknown>) => db.execute({
        sql: "UPDATE media_probe_steps SET state = ?, detail = ?, finished_at = ? WHERE id = ?",
        args: [state, JSON.stringify({ what: step.what, ...detail }), Date.now(), rowId],
      });
      try {
        await finish("done", await step.run(dir));
      } catch (err: any) {
        await finish("failed", { error: String(err?.message ?? err), ...(err instanceof StepFailed ? err.detail : {}) });
        console.error(`[media probe] ${step.name} failed: ${err?.message ?? err}`);
        break;                                  // the steps after it are heavier: no point
      }
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// ── the report ────────────────────────────────────────────────────────────

async function lastRun() {
  const db = getDb();
  const head = await db.execute("SELECT run_id, MIN(started_at) AS started_at FROM media_probe_steps GROUP BY run_id ORDER BY started_at DESC LIMIT 1");
  if (!head.rows.length) return null;
  const runId = String((head.rows[0] as any).run_id);
  const rows = await db.execute({ sql: "SELECT step, state, detail, started_at, finished_at FROM media_probe_steps WHERE run_id = ? ORDER BY id", args: [runId] });
  const inThisProcess = running === runId;
  const steps = rows.rows.map((r: any) => {
    let detail: Record<string, unknown> = {};
    try { detail = JSON.parse(String(r.detail ?? "{}")); } catch {}
    let state = String(r.state);
    // "started" with nobody working on it: the server went away mid step.
    if (state === "started" && !inThisProcess) state = "interrupted";
    return { step: String(r.step), state, ...detail };
  });
  const interrupted = steps.find((s) => s.state === "interrupted");
  return {
    runId, startedAt: new Date(Number((head.rows[0] as any).started_at)).toISOString(),
    startedAtMs: Number((head.rows[0] as any).started_at),
    state: inThisProcess ? "running" : interrupted ? "interrupted" : steps.some((s) => s.state === "failed") ? "failed" : steps.length === STEPS.length ? "complete" : "stopped early",
    note: interrupted
      ? `The server stopped while "${interrupted.step}" was running. On a small instance that usually means the step used more memory than the service is allowed.`
      : undefined,
    stepsPlanned: STEPS.map((s) => s.name),
    steps,
  };
}

router.get("/", async (req, res) => {
  try {
    await ready();
    let message = "Add ?run=1 to this address to start a run. It takes one to ten minutes. Then reload this address without ?run=1 to follow it.";
    let last = await lastRun();

    if (req.query.run !== undefined) {
      const sinceLast = last ? Date.now() - last.startedAtMs : Infinity;
      if (running) message = "A run is in progress. Reload to follow it.";
      else if (sinceLast < COOLDOWN_MS) {
        message = `The last run started ${Math.round(sinceLast / 60_000)} minute(s) ago. A new one can be started ${Math.ceil((COOLDOWN_MS - sinceLast) / 60_000)} minute(s) from now. Its result is below.`;
      } else {
        const runId = crypto.randomUUID();
        running = runId;
        execute(runId)
          .catch((err) => console.error(`[media probe] run failed: ${err?.message ?? err}`))
          .finally(() => { running = null; });
        message = "Run started. Reload this address in a minute to follow it.";
        // Give the first step a moment to be written, so this answer already shows the run.
        await new Promise((r) => setTimeout(r, 400));
        last = await lastRun();
      }
    } else if (running) message = "A run is in progress. Reload to follow it.";
    else if (last) message = "Result of the last run is below. Add ?run=1 to run again (at most once every 10 minutes).";

    res.setHeader("Cache-Control", "no-store");
    const { startedAtMs: _drop, ...lastOut } = last ?? ({} as any);
    return res.json({ probe: "media", message, environment: await environment(), lastRun: last ? lastOut : null });
  } catch (err: any) {
    return res.status(500).json({ error: `The media probe hit a problem: ${err?.message ?? err}` });
  }
});

export default router;
