// VideoMind, Part 17a probe: the same prompts through three video generation
// models, to compare quality, speed and cost before anything is built.
//
//   cd scripts/gen_probe
//   export GEMINI_API_KEY=...   # Google AI Studio key (Gemini Omni Flash)
//   export FAL_KEY=...          # fal.ai key (Wan 3.0 and MiniMax H3 Max)
//   node probe.mjs              # shows the plan and the estimated cost, sends nothing
//   node probe.mjs --yes        # runs it
//   node probe.mjs --yes --only wan,minimax --prompts talk
//
// Models (from each provider's own docs, 21 Oct 2026):
//   omni     Google gemini-omni-1.1-flash, POST /v1beta/interactions, 720p, 16:9
//   wan      fal alibaba/wan-3.0/text-to-video, 720p, 8 s, audio on
//   minimax  fal minimax/h3-max/text-to-video, 768P, 8 s
// Each prompt is sent twice: as a person would type it ("plain"), and as a
// director would write it ("written": subject, action, camera, light, sound),
// to see how much the written prompt matters. A model whose key is not set is
// skipped. Videos go to out/, with probe-report.json and compare.html to watch
// them side by side. No keys are written anywhere.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "out");
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const GO = args.includes("--yes");
const ONLY = flag("--only")?.split(",").map((s) => s.trim()).filter(Boolean) ?? null;
const PROMPT_IDS = flag("--prompts")?.split(",").map((s) => s.trim()).filter(Boolean) ?? null;
// The test can swap the network for a stand in.
const http = globalThis.__probeFetch ?? fetch;
const SECONDS = 8;

const PROMPTS = [
  {
    id: "talk",
    plain: "a teacher explaining blockchain consensus in a lecture hall",
    written:
      "Medium shot of a woman in her forties, a university lecturer in a navy blazer, standing beside a whiteboard covered in simple diagrams of connected boxes in a bright modern lecture hall. She looks at the camera and says clearly, in a warm and confident voice: \"Consensus means every computer agrees on the same history.\" Slow push in, soft daylight from tall windows, shallow depth of field, quiet room tone with faint chalk sounds. No captions, no on screen text.",
  },
  {
    id: "scene",
    plain: "Lagos city at sunrise, cinematic",
    written:
      "Aerial drone shot gliding slowly forward over the Lagos lagoon at sunrise, a long bridge crossing the water with early morning traffic, the city skyline behind it, warm golden light through light haze, small boats leaving gentle wakes. Smooth steady motion, natural colors. Sound: soft wind, distant traffic and birds. No text.",
  },
];

const MODELS = {
  omni: {
    label: "Google Gemini Omni Flash 1.1", key: "GEMINI_API_KEY",
    // Price per second at 720p is not on Google's model page. Artificial Analysis lists about $9.12 a minute at 1080p.
    estimateUsd: () => 9.12 / 60 * SECONDS,
    estimateNote: "estimate from Artificial Analysis (1080p rate); Google's page states no price",
    run: runOmni,
  },
  wan: {
    label: "Alibaba Wan 3.0 (fal)", key: "FAL_KEY", endpoint: "alibaba/wan-3.0/text-to-video",
    input: (prompt) => ({ prompt, resolution: "720p", aspect_ratio: "16:9", duration: SECONDS, audio: true }),
    estimateUsd: () => 0.10 * SECONDS, estimateNote: "fal: $0.10 a second at 720p",
    run: runFal,
  },
  minimax: {
    label: "MiniMax H3 Max (fal)", key: "FAL_KEY", endpoint: "minimax/h3-max/text-to-video",
    input: (prompt) => ({ prompt, prompt_expansion_mode: "balanced", duration: SECONDS, resolution: "768P", aspect_ratio: "16:9" }),
    estimateUsd: () => 0.08 * SECONDS, estimateNote: "fal: $0.08 a second at 768P after 31 Oct ($0.052 before)",
    run: runFal,
  },
};

const say = (s) => console.log(s);
function errText(e) { const p = []; for (let x = e, d = 0; x && d < 6; x = x.cause, d++) p.push(`${x.message ?? String(x)}${x.code ? ` [${x.code}]` : ""}`); return p.join(" <- "); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function json(res, what) {
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = null; }
  if (!res.ok) throw new Error(`${what}: HTTP ${res.status} ${(body?.error?.message ?? body?.detail ?? text).toString().slice(0, 400)}`);
  return body;
}

// ── Google: one request; the answer holds the video, or a file to download ──
/** Finds the first video part anywhere in the answer: { mime_type, data } or { mime_type, uri }. */
function findVideo(o, depth = 0) {
  if (!o || typeof o !== "object" || depth > 12) return null;
  const mime = o.mime_type ?? o.mimeType;
  if (typeof mime === "string" && mime.startsWith("video/") && (o.data || o.uri)) return { mime, data: o.data ?? null, uri: o.uri ?? null };
  for (const v of Array.isArray(o) ? o : Object.values(o)) { const f = findVideo(v, depth + 1); if (f) return f; }
  return null;
}
/** The answer without the video bytes, for the report. */
const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k === "data" && typeof v === "string" && v.length > 200 ? `<${v.length} base64 chars>` : v)));

async function runOmni(prompt, file) {
  const key = process.env.GEMINI_API_KEY;
  const base = "https://generativelanguage.googleapis.com/v1beta";
  const headers = { "x-goog-api-key": key, "Content-Type": "application/json" };
  const t0 = Date.now();
  const res = await http(`${base}/interactions`, {
    method: "POST", headers,
    body: JSON.stringify({ model: "gemini-omni-1.1-flash", input: prompt, response_format: { type: "video", aspect_ratio: "16:9", resolution: "720p", delivery: "uri" } }),
    signal: AbortSignal.timeout(15 * 60_000),
  });
  const body = await json(res, "Gemini interactions");
  const answeredMs = Date.now() - t0;
  const v = findVideo(body);
  if (!v) throw Object.assign(new Error("Gemini answered without a video part"), { answer: strip(body) });
  if (v.data) { await fsp.writeFile(file, Buffer.from(v.data, "base64")); return { answeredMs, delivery: "inline", answer: strip(body) }; }
  const id = /files\/([^/?:]+)/.exec(v.uri)?.[1];
  if (!id) throw new Error(`Gemini file address not understood: ${v.uri}`);
  for (let i = 0; ; i++) {
    const f = await json(await http(`${base}/files/${id}`, { headers }), "Gemini file status");
    if (f.state === "ACTIVE") break;
    if (f.state === "FAILED") throw new Error(`Gemini file failed: ${JSON.stringify(f.error ?? f).slice(0, 300)}`);
    if (i > 120) throw new Error("Gemini file not ready after 10 minutes");
    await sleep(5000);
  }
  const dl = await http(`${base}/files/${id}:download?alt=media`, { headers });
  if (!dl.ok) throw new Error(`Gemini download: HTTP ${dl.status}`);
  await fsp.writeFile(file, Buffer.from(await dl.arrayBuffer()));
  return { answeredMs, delivery: "uri", answer: strip(body) };
}

// ── fal: submit to the queue, poll the status, read the result, download ──
async function runFal(prompt, file, model) {
  const headers = { Authorization: `Key ${process.env.FAL_KEY}`, "Content-Type": "application/json" };
  const t0 = Date.now();
  const sub = await json(await http(`https://queue.fal.run/${model.endpoint}`, { method: "POST", headers, body: JSON.stringify(model.input(prompt)) }), "fal submit");
  if (!sub.status_url || !sub.response_url) throw new Error(`fal submit answered without status and response addresses: ${JSON.stringify(sub).slice(0, 300)}`);
  let firstStartMs = null;
  for (let i = 0; ; i++) {
    const st = await json(await http(sub.status_url, { headers }), "fal status");
    if (st.status === "IN_PROGRESS" && firstStartMs === null) firstStartMs = Date.now() - t0;
    if (st.status === "COMPLETED") { if (st.error) throw new Error(`fal: ${st.error_type ?? "error"}: ${String(st.error).slice(0, 300)}`); break; }
    if (i > 360) throw new Error("fal: not done after 30 minutes");
    await sleep(5000);
  }
  const result = await json(await http(sub.response_url, { headers }), "fal result");
  const url = result?.video?.url;
  if (!url) throw new Error(`fal result has no video address: ${JSON.stringify(result).slice(0, 300)}`);
  const dl = await http(url);
  if (!dl.ok) throw new Error(`fal download: HTTP ${dl.status}`);
  await fsp.writeFile(file, Buffer.from(await dl.arrayBuffer()));
  return { requestId: sub.request_id, startedMs: firstStartMs, expandedPrompt: result.expanded_prompt ?? result.actual_prompt ?? null, reportedSeconds: result.duration ?? null, seed: result.seed ?? null };
}

/** Length, size, picture and sound of a file, with ffprobe when it is installed. */
function facts(file) {
  const out = { bytes: fs.statSync(file).size };
  try {
    const j = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], { encoding: "utf8" }));
    const v = j.streams.find((s) => s.codec_type === "video"), a = j.streams.find((s) => s.codec_type === "audio");
    Object.assign(out, { seconds: Number(j.format?.duration) || null, width: v?.width ?? null, height: v?.height ?? null, videoCodec: v?.codec_name ?? null, audio: a ? a.codec_name : "none" });
  } catch { out.note = "ffprobe not found: length and size not read"; }
  return out;
}

// ── plan ──
const models = Object.entries(MODELS).filter(([id]) => !ONLY || ONLY.includes(id));
const prompts = PROMPTS.filter((p) => !PROMPT_IDS || PROMPT_IDS.includes(p.id));
const runs = [];
for (const [id, m] of models) {
  if (!process.env[m.key]) { say(`Skipping ${m.label}: ${m.key} is not set.`); continue; }
  for (const p of prompts) for (const kind of ["plain", "written"]) runs.push({ model: id, m, prompt: p, kind });
}
const total = runs.reduce((a, r) => a + r.m.estimateUsd(), 0);
say(`\nPlan: ${runs.length} videos, about ${SECONDS} s each.`);
for (const [id, m] of models) if (process.env[m.key]) say(`  ${id.padEnd(8)} ${m.label}: about $${m.estimateUsd().toFixed(2)} a video (${m.estimateNote})`);
say(`Estimated total: about $${total.toFixed(2)} in real money on your provider accounts.`);
if (!runs.length) { say("Nothing to run. Set GEMINI_API_KEY and/or FAL_KEY first (do not paste them anywhere else)."); process.exit(1); }
if (!GO) { say("\nNothing was sent. Run again with --yes to generate."); process.exit(0); }

// ── run: one model at a time, both prompts in turn ──
await fsp.mkdir(OUT, { recursive: true });
const report = { probeVersion: 1, startedAt: new Date().toISOString(), host: process.env.RENDER ? "render" : "this machine", seconds: SECONDS, estimatedUsd: +total.toFixed(2), prompts: PROMPTS, results: [] };
for (const r of runs) {
  const name = `${r.model}_${r.prompt.id}_${r.kind}.mp4`;
  const file = path.join(OUT, name);
  say(`\n== ${r.m.label}, ${r.prompt.id}, ${r.kind}`);
  const t0 = Date.now();
  const row = { model: r.model, label: r.m.label, prompt: r.prompt.id, kind: r.kind, file: name, estimatedUsd: +r.m.estimateUsd().toFixed(3) };
  try {
    const extra = await r.m.run(r.prompt[r.kind], file, r.m);
    Object.assign(row, { ok: true, totalMs: Date.now() - t0, ...extra, ...facts(file) });
    say(`   done in ${(row.totalMs / 1000).toFixed(0)} s: ${row.seconds ? row.seconds.toFixed(1) + " s, " : ""}${row.width ? `${row.width}x${row.height}, ` : ""}sound ${row.audio ?? "?"}, ${(row.bytes / 1048576).toFixed(1)} MB`);
  } catch (e) {
    Object.assign(row, { ok: false, totalMs: Date.now() - t0, error: errText(e).slice(0, 1500), answer: e.answer ?? undefined });
    say(`   FAILED: ${row.error.slice(0, 400)}`);
  }
  report.results.push(row);
  await fsp.writeFile(path.join(HERE, "probe-report.json"), JSON.stringify(report, null, 2));
}

// ── a page to watch them side by side ──
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const cell = (row) => row ? (row.ok ? `<video src="out/${esc(row.file)}" controls preload="metadata"></video><p>${(row.totalMs / 1000).toFixed(0)} s to make${row.seconds ? `, ${row.seconds.toFixed(1)} s long` : ""}, about $${row.estimatedUsd}</p>` : `<p class="err">Failed: ${esc(row.error.slice(0, 200))}</p>`) : "<p>Not run</p>";
let html = `<!doctype html><meta charset="utf-8"><title>Video generation probe</title><style>body{font:14px system-ui;background:#111;color:#ddd;margin:24px}table{border-collapse:collapse}td,th{border:1px solid #333;padding:8px;vertical-align:top}video{width:360px;display:block}.err{color:#f77}p{margin:6px 0 0;max-width:360px}</style><h1>Video generation probe, ${esc(report.startedAt.slice(0, 10))}</h1>`;
for (const p of prompts) for (const kind of ["plain", "written"]) {
  html += `<h2>${esc(p.id)}, ${kind}</h2><p>${esc(p[kind])}</p><table><tr>${models.map(([, m]) => `<th>${esc(m.label)}</th>`).join("")}</tr><tr>`;
  html += models.map(([id]) => `<td>${cell(report.results.find((x) => x.model === id && x.prompt === p.id && x.kind === kind))}</td>`).join("") + "</tr></table>";
}
await fsp.writeFile(path.join(HERE, "compare.html"), html);
report.finishedAt = new Date().toISOString();
await fsp.writeFile(path.join(HERE, "probe-report.json"), JSON.stringify(report, null, 2));
const ok = report.results.filter((x) => x.ok).length;
say(`\nDone: ${ok} of ${report.results.length} videos made.`);
say(`Watch them: open ${path.join(HERE, "compare.html")} in your browser.`);
say(`Report: ${path.join(HERE, "probe-report.json")} (no keys in it). Paste it back to Claude, with which videos you liked.`);
