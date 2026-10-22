// src/lib/genProviders.ts
// vm_generate: talking to the video generation providers (Part 17b).
//
// Two kinds of provider, each called the way its own docs describe
// (checked 21 to 22 Oct 2026):
//   fal     queue API: POST https://queue.fal.run/<endpoint> answers with a
//           request id and its status and result addresses; the status says
//           IN_QUEUE, IN_PROGRESS or COMPLETED; the result holds video.url.
//           Auth: "Authorization: Key $FAL_KEY".
//   google  Gemini Omni: POST /v1beta/interactions answers when the video is
//           made; with delivery "uri" the answer names a file, which is
//           polled until ACTIVE and then downloaded. Auth: x-goog-api-key.
// Keys come from FAL_KEY and GEMINI_API_KEY on the server and are never
// stored or sent anywhere else. The network can be swapped for a stand in.
import fs from "fs/promises";

export type Fetch = typeof fetch;
let net: Fetch = (...a) => fetch(...a);
/** For tests: the network the providers use. */
export function _setGenFetch(f: Fetch | null) { net = f ?? ((...a) => fetch(...a)); }

export type ProviderId = "fal" | "google";
export const PROVIDER_KEY: Record<ProviderId, string> = { fal: "FAL_KEY", google: "GEMINI_API_KEY" };
export const keySet = (p: ProviderId) => !!process.env[PROVIDER_KEY[p]]?.trim();

/** A failure that trying again will not fix (a refused prompt, no balance, a bad key). */
export class GenRefused extends Error {
  constructor(public code: "refused" | "provider_account" | "provider_error", message: string) { super(message); }
}

export interface GenModel {
  id: string; provider: ProviderId; endpoint: string; resolution: string;
  minSeconds: number; maxSeconds: number;
}
export interface GenRequest { prompt: string; seconds: number; aspect: "16:9" | "9:16" }

/** What a provider keeps between checks (saved on the generation row). */
export type ProviderRef =
  | { provider: "fal"; requestId: string; statusUrl: string; responseUrl: string; cancelUrl?: string }
  | { provider: "google"; interactionId: string | null; fileId: string | null; inline: boolean };

export type CheckResult =
  | { state: "running"; note?: string }
  | { state: "done"; seconds: number | null; expandedPrompt: string | null };

async function readJson(res: Response, what: string): Promise<any> {
  const text = await res.text();
  let body: any = null; try { body = JSON.parse(text); } catch { /* not JSON */ }
  if (res.ok) return body;
  const msg = String(body?.error?.message ?? body?.detail ?? body?.error ?? text ?? "").slice(0, 400);
  // A refused prompt, an account without balance and a bad key will not get better by waiting.
  if (res.status === 401 || res.status === 403 || res.status === 402) throw new GenRefused("provider_account", `${what}: the provider refused the request (${res.status}): ${msg}`);
  if (res.status === 400 || res.status === 422) throw new GenRefused("refused", `${what}: the provider refused this prompt (${res.status}): ${msg}`);
  if (res.status === 429 && /free tier|limit: 0|quota/i.test(msg)) throw new GenRefused("provider_account", `${what}: the provider account has no quota for this model (429): ${msg}`);
  throw Object.assign(new Error(`${what}: HTTP ${res.status} ${msg}`), { code: `http_${res.status}` });
}

/** The provider's input for one model, from its docs. */
export function inputFor(model: GenModel, r: GenRequest): Record<string, unknown> {
  if (model.endpoint.startsWith("alibaba/wan-3.0")) return { prompt: r.prompt, resolution: model.resolution, aspect_ratio: r.aspect, duration: r.seconds, audio: true };
  if (model.endpoint.startsWith("minimax/")) return { prompt: r.prompt, prompt_expansion_mode: "balanced", duration: r.seconds, resolution: model.resolution, aspect_ratio: r.aspect };
  if (model.provider === "google") return { model: model.endpoint, input: r.prompt, response_format: { type: "video", aspect_ratio: r.aspect, resolution: model.resolution, delivery: "uri" } };
  return { prompt: r.prompt, duration: r.seconds, aspect_ratio: r.aspect };
}

const falHeaders = () => ({ Authorization: `Key ${process.env.FAL_KEY}`, "Content-Type": "application/json" });
const GOOGLE = "https://generativelanguage.googleapis.com/v1beta";
const googleHeaders = () => ({ "x-goog-api-key": String(process.env.GEMINI_API_KEY), "Content-Type": "application/json" });

/** Finds the first video part anywhere in a Gemini answer. */
function findVideo(o: any, depth = 0): { data: string | null; uri: string | null } | null {
  if (!o || typeof o !== "object" || depth > 12) return null;
  const mime = o.mime_type ?? o.mimeType;
  if (typeof mime === "string" && mime.startsWith("video/") && (o.data || o.uri)) return { data: o.data ?? null, uri: o.uri ?? null };
  for (const v of Array.isArray(o) ? o : Object.values(o)) { const f = findVideo(v, depth + 1); if (f) return f; }
  return null;
}

/**
 * Start a generation. fal answers at once with a request to check later.
 * Google answers only when the video is made, so the file is written to
 * `file` here (or named, to download once it is ready).
 */
export async function submit(model: GenModel, r: GenRequest, file: string): Promise<{ ref: ProviderRef; written: boolean }> {
  if (!keySet(model.provider)) throw new GenRefused("provider_account", `${PROVIDER_KEY[model.provider]} is not set on the server.`);
  if (model.provider === "fal") {
    const sub = await readJson(await net(`https://queue.fal.run/${model.endpoint}`, { method: "POST", headers: falHeaders(), body: JSON.stringify(inputFor(model, r)), signal: AbortSignal.timeout(60_000) }), "fal submit");
    if (!sub?.request_id || !sub?.status_url || !sub?.response_url) throw new Error(`fal submit answered without a request: ${JSON.stringify(sub).slice(0, 300)}`);
    return { ref: { provider: "fal", requestId: String(sub.request_id), statusUrl: String(sub.status_url), responseUrl: String(sub.response_url), cancelUrl: sub.cancel_url ? String(sub.cancel_url) : undefined }, written: false };
  }
  const body = await readJson(await net(`${GOOGLE}/interactions`, { method: "POST", headers: googleHeaders(), body: JSON.stringify(inputFor(model, r)), signal: AbortSignal.timeout(15 * 60_000) }), "Gemini interactions");
  const v = findVideo(body);
  if (!v) throw new GenRefused("refused", "Gemini answered without a video, which usually means the prompt was refused.");
  if (v.data) { await fs.writeFile(file, Buffer.from(v.data, "base64")); return { ref: { provider: "google", interactionId: body?.id ?? null, fileId: null, inline: true }, written: true }; }
  const fileId = /files\/([^/?:]+)/.exec(String(v.uri))?.[1] ?? null;
  if (!fileId) throw new Error(`Gemini file address not understood: ${v.uri}`);
  return { ref: { provider: "google", interactionId: body?.id ?? null, fileId, inline: false }, written: false };
}

/** Is it done? Never waits long: the job checks again later when it is not. */
export async function check(ref: ProviderRef): Promise<CheckResult> {
  if (ref.provider === "fal") {
    const st = await readJson(await net(ref.statusUrl, { headers: falHeaders(), signal: AbortSignal.timeout(30_000) }), "fal status");
    if (st?.status !== "COMPLETED") return { state: "running", note: String(st?.status ?? "") };
    if (st.error) throw new GenRefused(/safety|content|nsfw|flag|policy/i.test(String(st.error_type ?? st.error)) ? "refused" : "provider_error", `fal: ${String(st.error_type ?? "error")}: ${String(st.error).slice(0, 300)}`);
    return { state: "done", seconds: null, expandedPrompt: null };
  }
  if (ref.inline || !ref.fileId) return { state: "done", seconds: null, expandedPrompt: null };
  const f = await readJson(await net(`${GOOGLE}/files/${ref.fileId}`, { headers: googleHeaders(), signal: AbortSignal.timeout(30_000) }), "Gemini file status");
  if (f?.state === "FAILED") throw new GenRefused("provider_error", `Gemini file failed: ${JSON.stringify(f.error ?? f).slice(0, 300)}`);
  return f?.state === "ACTIVE" ? { state: "done", seconds: null, expandedPrompt: null } : { state: "running", note: String(f?.state ?? "") };
}

/** Write the finished video to `file`. Answers what the provider said about it. */
export async function download(ref: ProviderRef, file: string): Promise<{ seconds: number | null; expandedPrompt: string | null }> {
  if (ref.provider === "fal") {
    const result = await readJson(await net(ref.responseUrl, { headers: falHeaders(), signal: AbortSignal.timeout(60_000) }), "fal result");
    const url = result?.video?.url;
    if (!url) throw new Error(`fal result has no video address: ${JSON.stringify(result).slice(0, 300)}`);
    const dl = await net(String(url), { signal: AbortSignal.timeout(10 * 60_000) });
    if (!dl.ok) throw Object.assign(new Error(`fal download: HTTP ${dl.status}`), { code: `http_${dl.status}` });
    await fs.writeFile(file, Buffer.from(await dl.arrayBuffer()));
    const secs = Number(result?.duration);
    return { seconds: Number.isFinite(secs) && secs > 0 ? secs : null, expandedPrompt: result?.expanded_prompt ?? result?.actual_prompt ?? null };
  }
  if (ref.inline) return { seconds: null, expandedPrompt: null }; // written when it was made
  const dl = await net(`${GOOGLE}/files/${ref.fileId}:download?alt=media`, { headers: googleHeaders(), signal: AbortSignal.timeout(10 * 60_000) });
  if (!dl.ok) throw Object.assign(new Error(`Gemini download: HTTP ${dl.status}`), { code: `http_${dl.status}` });
  await fs.writeFile(file, Buffer.from(await dl.arrayBuffer()));
  return { seconds: null, expandedPrompt: null };
}

/** Stop a generation nobody wants any more (the video was deleted). Best effort. */
export async function cancel(ref: ProviderRef): Promise<void> {
  if (ref.provider === "fal" && ref.cancelUrl) await net(ref.cancelUrl, { method: "PUT", headers: falHeaders(), signal: AbortSignal.timeout(15_000) }).catch(() => {});
}
