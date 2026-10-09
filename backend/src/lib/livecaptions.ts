// src/lib/livecaptions.ts
// vm_livechat: live captions while the host speaks.
//
// Checked against OpenAI's documentation on 9 Oct 2026:
//   * realtime transcription with gpt-live-transcribe: a session of type
//     "transcription", 24 kHz 16 bit mono PCM sent as base64 in
//     input_audio_buffer.append; the model has no server side turn
//     detection, so the caller commits each turn (input_audio_buffer.commit)
//     after its own pause detection
//   * text arrives as conversation.item.input_audio_transcription.delta
//     events, and the finished line as ...completed; completed events of
//     different turns may arrive out of order, so they are matched by item_id
//   * $0.017 per minute of audio (gpt-live-transcribe model page)
//   * the WebSocket address for a transcription only session is not in the
//     guide; wss://api.openai.com/v1/realtime?intent=transcription is the one
//     OpenAI's cookbook uses, so it is a setting (LIVE_CAPTIONS_URL). A
//     session lasts at most 60 minutes, so a new one is opened every 55
//
// How it runs: the studio sends the microphone as 24 kHz PCM to this
// server over a WebSocket (/api/live/<id>/captions, opened with a one use
// ticket). The server finds the pauses, sends only speech (plus a moment
// before it) to OpenAI, and sends the text to every viewer through the
// LiveKit room. Finished lines are kept with the event. The OpenAI key
// never leaves the server.
import crypto from "crypto";
import type { IncomingMessage, Server } from "http";
import type { Duplex } from "stream";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { allowedOrigins } from "./auth.js";
import { getEvent, liveConfig, broadcast, save, type LiveEvent } from "./live.js";
import { addCaption } from "./livechat.js";
import { recordUsage } from "./usage.js";

const RATE = 24_000;
export const captionsUrl = () => process.env.LIVE_CAPTIONS_URL?.trim() || "wss://api.openai.com/v1/realtime?intent=transcription";
export const captionsModel = () => process.env.LIVE_CAPTIONS_MODEL?.trim() || "gpt-live-transcribe";
/** Minutes of captions one event may use (the audio actually sent). */
export const maxMinutes = () => Math.max(1, Number(process.env.LIVE_CAPTIONS_MAX_MINUTES) || 180);
export const captionsAvailable = () => !!liveConfig() && !!process.env.OPENAI_API_KEY?.trim() && process.env.LIVE_CAPTIONS !== "off";

// Pause detection. Levels are the root mean square of the samples, 0 to 1.
const LEVEL = () => Number(process.env.LIVE_CAPTIONS_LEVEL) || 0.012;   // about -38 dBFS
const PAUSE_MS = () => Number(process.env.LIVE_CAPTIONS_PAUSE_MS) || 550;
const MIN_SPEECH_MS = 250;
const MAX_TURN_MS = () => Number(process.env.LIVE_CAPTIONS_MAX_TURN_MS) || 9000;
const PREROLL_MS = 300;
const ROTATE_MS = () => Number(process.env.LIVE_CAPTIONS_ROTATE_MS) || 55 * 60_000;

// ── one use tickets (a browser cannot put a header on a WebSocket) ────────────

function key(): Buffer {
  const c = liveConfig();
  if (!c) throw new Error("live is off");
  return Buffer.from(crypto.hkdfSync("sha256", c.secret, "videomind", "live captions ticket", 32));
}
const usedTickets = new Map<string, number>();
export function makeTicket(eventId: string): string {
  const body = Buffer.from(JSON.stringify({ e: eventId, x: Date.now() + 60_000, n: crypto.randomBytes(9).toString("base64url") })).toString("base64url");
  return `${body}.${crypto.createHmac("sha256", key()).update(body).digest("base64url")}`;
}
export function useTicket(ticket: string, eventId: string): boolean {
  const [body, sig] = String(ticket ?? "").split(".");
  if (!body || !sig || !liveConfig()) return false;
  const want = crypto.createHmac("sha256", key()).update(body).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return false;
  try {
    const j = JSON.parse(Buffer.from(body, "base64url").toString());
    if (j.e !== eventId || !(j.x > Date.now()) || usedTickets.has(j.n)) return false;
    usedTickets.set(j.n, j.x);
    for (const [n, x] of usedTickets) if (x < Date.now()) usedTickets.delete(n);
    return true;
  } catch { return false; }
}

// ── a session: the studio on one side, OpenAI on the other ───────────────────

const sessions = new Map<string, CaptionSession>();
export const activeCaptions = (eventId: string) => sessions.get(eventId) ?? null;

const level = (pcm: Buffer) => {
  let sum = 0; const n = pcm.length >> 1;
  for (let i = 0; i < n; i++) { const v = pcm.readInt16LE(i * 2) / 32768; sum += v * v; }
  return n ? Math.sqrt(sum / n) : 0;
};
const msOf = (bytes: number) => (bytes / 2 / RATE) * 1000;

class CaptionSession {
  private up: WebSocket | null = null;
  private upOpenedAt = 0;
  private upReady = false;
  private pending: string[] = [];          // messages waiting for the OpenAI socket to open
  private preroll: Buffer[] = [];
  private prerollMs = 0;
  private inTurn = false;
  private speechMs = 0;
  private silenceMs = 0;
  private turnMs = 0;
  private turnStart = 0;                   // ms since the event started
  private commits: number[] = [];          // start times of committed turns, in order
  private items = new Map<string, { at: number; text: string; sentAt: number }>();
  private sentMs = 0;                      // audio sent to OpenAI in this session
  private billedMs = 0;                    // of which written to the ledger and the event
  private reconnects: number[] = [];
  private closed = false;
  private ping: NodeJS.Timeout;
  private flushTimer: NodeJS.Timeout;

  constructor(private e: LiveEvent, private host: WebSocket) {
    this.ping = setInterval(() => { try { host.ping(); } catch {} }, 25_000);
    this.flushTimer = setInterval(() => { void this.flush().then(() => this.recheck()); }, 30_000);
    host.on("message", (data, isBinary) => this.fromHost(data, isBinary));
    host.on("close", () => this.close("host_left"));
    host.on("error", () => this.close("host_left"));
    this.openUpstream();
  }

  tell(msg: Record<string, unknown>) {
    if (this.host.readyState === WebSocket.OPEN) this.host.send(JSON.stringify(msg));
  }

  private openUpstream() {
    const ws = new WebSocket(captionsUrl(), { headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}` } });
    const prev = this.up;
    this.up = ws; this.upReady = false; this.upOpenedAt = Date.now(); this.commits = [];
    ws.on("open", () => {
      ws.send(JSON.stringify({
        type: "session.update",
        session: {
          type: "transcription",
          audio: { input: { format: { type: "audio/pcm", rate: RATE }, transcription: { model: captionsModel(), delay: "low" }, turn_detection: null } },
        },
      }));
      this.upReady = true;
      for (const m of this.pending.splice(0)) ws.send(m);
      this.tell({ type: "ready" });
    });
    ws.on("message", (data) => this.fromUpstream(ws, data));
    ws.on("close", () => {
      if (this.closed || ws !== this.up) return;
      // Lost the connection to OpenAI: try again a few times, then stop.
      const now = Date.now();
      this.reconnects = this.reconnects.filter((t) => now - t < 5 * 60_000);
      if (this.reconnects.length >= 3) { this.tell({ type: "stopped", reason: "unavailable", message: "Captions stopped: the captioning service kept disconnecting." }); this.close("upstream_lost"); return; }
      this.reconnects.push(now);
      this.inTurn = false; this.commits = [];
      setTimeout(() => { if (!this.closed) this.openUpstream(); }, 1000);
    });
    ws.on("error", () => { /* the close handler decides */ });
    // A rotated session keeps its socket a little longer for lines still on their way.
    if (prev) setTimeout(() => { try { prev.close(); } catch {} }, 15_000);
  }

  private toUpstream(msg: Record<string, unknown>) {
    const s = JSON.stringify(msg);
    if (this.up && this.upReady && this.up.readyState === WebSocket.OPEN) this.up.send(s);
    else if (this.pending.length < 400) this.pending.push(s);
  }

  private nowMs() { return this.e.startedAt ? Date.now() - this.e.startedAt : 0; }

  private fromHost(data: RawData, isBinary: boolean) {
    if (this.closed || !isBinary) return;
    const pcm = Buffer.isBuffer(data) ? data : Buffer.concat(Array.isArray(data) ? data : [Buffer.from(data as ArrayBuffer)]);
    if (pcm.length < 2 || pcm.length % 2 || pcm.length > RATE * 2) return;   // at most a second per message
    const ms = msOf(pcm.length);
    const loud = level(pcm) >= LEVEL();

    if (!this.inTurn) {
      this.preroll.push(pcm); this.prerollMs += ms;
      while (this.prerollMs - msOf(this.preroll[0].length) >= PREROLL_MS) this.prerollMs -= msOf(this.preroll.shift()!.length);
      if (!loud) return;
      // Speech starts: send what came just before it too, so the first word is whole.
      if (Date.now() - this.upOpenedAt > ROTATE_MS()) this.openUpstream();
      this.inTurn = true; this.speechMs = 0; this.silenceMs = 0; this.turnMs = 0;
      this.turnStart = Math.max(0, this.nowMs() - this.prerollMs);
      for (const b of this.preroll) this.send(b);
      this.preroll = []; this.prerollMs = 0;
      this.speechMs = ms;
      return;
    }
    this.send(pcm);
    this.turnMs += ms;
    if (loud) { this.speechMs += ms; this.silenceMs = 0; } else this.silenceMs += ms;
    if (this.silenceMs >= PAUSE_MS() || this.turnMs >= MAX_TURN_MS()) {
      if (this.speechMs >= MIN_SPEECH_MS) { this.toUpstream({ type: "input_audio_buffer.commit" }); this.commits.push(this.turnStart); }
      else this.toUpstream({ type: "input_audio_buffer.clear" });
      this.inTurn = false;
      // A turn cut for length goes on at once as a new one.
      if (this.silenceMs < PAUSE_MS()) { this.inTurn = true; this.turnStart = this.nowMs(); this.speechMs = 0; this.silenceMs = 0; this.turnMs = 0; }
    }
    if (this.e.captionSeconds * 1000 + this.sentMs >= maxMinutes() * 60_000) {
      this.tell({ type: "stopped", reason: "limit", message: `Captions stopped: this event used its ${maxMinutes()} minutes of captions.` });
      this.close("limit");
    }
  }

  private send(pcm: Buffer) {
    this.toUpstream({ type: "input_audio_buffer.append", audio: pcm.toString("base64") });
    this.sentMs += msOf(pcm.length);
  }

  private fromUpstream(ws: WebSocket, data: RawData) {
    let ev: any;
    try { ev = JSON.parse(data.toString()); } catch { return; }
    const t = String(ev?.type ?? "");
    if (t === "input_audio_buffer.committed" && ev.item_id && ws === this.up) {
      const at = this.commits.shift();
      if (at !== undefined && !this.items.has(ev.item_id)) this.items.set(ev.item_id, { at, text: "", sentAt: 0 });
      return;
    }
    if (t === "conversation.item.input_audio_transcription.delta" && ev.item_id) {
      const it = this.items.get(ev.item_id) ?? { at: this.nowMs(), text: "", sentAt: 0 };
      it.text += String(ev.delta ?? "");
      this.items.set(ev.item_id, it);
      if (Date.now() - it.sentAt >= 150) {
        it.sentAt = Date.now();
        void broadcast(this.e, "captions", { type: "partial", item: ev.item_id, text: it.text.trim(), at: it.at });
        this.tell({ type: "partial", item: ev.item_id, text: it.text.trim() });
      }
      return;
    }
    if (t === "conversation.item.input_audio_transcription.completed" && ev.item_id) {
      const it = this.items.get(ev.item_id); this.items.delete(ev.item_id);
      const text = String(ev.transcript ?? "").replace(/\s+/g, " ").trim();
      const at = it?.at ?? this.nowMs();
      void broadcast(this.e, "captions", { type: "final", item: ev.item_id, text, at });
      this.tell({ type: "final", item: ev.item_id, text });
      if (text) void addCaption(this.e.id, ev.item_id, at, text).catch(() => {});
      return;
    }
    if (t === "error") {
      const msg = String(ev?.error?.message ?? "error").replace(/sk-[A-Za-z0-9_-]+/g, "[key]").slice(0, 200);
      console.warn(`[captions] ${this.e.id}: ${ev?.error?.code ?? ""} ${msg}`);
      const fatal = /invalid_api_key|insufficient_quota|model_not_found|unsupported/i.test(`${ev?.error?.code ?? ""} ${ev?.error?.type ?? ""}`);
      this.tell({ type: fatal ? "stopped" : "warning", reason: "service", message: `Captions: ${msg}` });
      if (fatal) this.close("service_error");
    }
  }

  /** The event may have ended, or the host turned captions off, elsewhere. */
  private async recheck() {
    const fresh = await getEvent(this.e.id).catch(() => null);
    if (!fresh || this.closed) return;
    if (fresh.status !== "live") { this.tell({ type: "stopped", reason: "ended" }); this.close("ended"); }
    else if (!fresh.captions) { this.tell({ type: "stopped", reason: "off", message: "Captions are turned off for this event." }); this.close("off"); }
  }

  /** Write the audio sent so far to the event and the ledger. */
  private async flush() {
    const ms = this.sentMs - this.billedMs;
    if (ms < 1000) return;
    const seconds = Math.floor(ms / 1000);
    this.billedMs += seconds * 1000;
    this.e.captionSeconds += seconds;
    await save(this.e.id, { caption_seconds: this.e.captionSeconds }).catch(() => {});
    await recordUsage({
      metric: "audio_seconds", quantity: seconds, provider: "openai", model: captionsModel(),
      feature: "live_captions", ownerWallet: this.e.wallet, actorWallet: this.e.wallet, meta: { eventId: this.e.id },
    });
  }

  close(why: string) {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.ping); clearInterval(this.flushTimer);
    if (sessions.get(this.e.id) === this) sessions.delete(this.e.id);
    if (this.inTurn && this.speechMs >= MIN_SPEECH_MS) { this.toUpstream({ type: "input_audio_buffer.commit" }); this.commits.push(this.turnStart); }
    void this.flush();
    try { if (this.host.readyState === WebSocket.OPEN) this.host.close(1000, why.slice(0, 60)); } catch {}
    // Keep listening a few seconds for the last lines, then hang up.
    const up = this.up;
    setTimeout(() => { try { up?.close(); } catch {} }, 5000);
    console.log(`[captions] ${this.e.id} closed (${why}), ${Math.round(this.sentMs / 1000)} s sent`);
  }
}

/** Stop the captions of an event (it ended, or the host turned them off). */
export function stopCaptions(eventId: string, why: string, message?: string) {
  const s = sessions.get(eventId);
  if (!s) return;
  s.tell({ type: "stopped", reason: why, message });
  s.close(why);
}

// ── the WebSocket endpoint ────────────────────────────────────────────────────

const PATH = /^\/api\/live\/([0-9a-f-]{36})\/captions(?:\?|$)/i;

export function attachCaptions(server: Server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: RATE * 2 + 1024 });
  server.on("upgrade", async (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const m = PATH.exec(req.url ?? "");
    const refuse = (code: number, text: string) => { socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); socket.destroy(); };
    if (!m) return refuse(404, "Not Found");
    try {
      const origin = String(req.headers.origin ?? "").replace(/\/+$/, "");
      if (!allowedOrigins().includes(origin)) return refuse(403, "Forbidden");
      const ticket = new URL(req.url!, "http://x").searchParams.get("ticket") ?? "";
      if (!captionsAvailable() || !useTicket(ticket, m[1])) return refuse(401, "Unauthorized");
      const e = await getEvent(m[1]);
      if (!e || e.status !== "live" || !e.captions) return refuse(409, "Conflict");
      wss.handleUpgrade(req, socket, head, (ws) => {
        sessions.get(e.id)?.close("replaced");
        sessions.set(e.id, new CaptionSession(e, ws));
      });
    } catch { refuse(500, "Internal Server Error"); }
  });
  return wss;
}
