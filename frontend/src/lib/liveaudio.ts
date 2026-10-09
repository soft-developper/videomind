// vm_livechat: sends the studio's sound to the server for live captions.
//
// The sound is taken from the same audio track that goes live, turned into
// 24 kHz 16 bit mono PCM in an AudioWorklet (the format OpenAI's realtime
// transcription takes), and sent in 100 ms pieces over a WebSocket. The
// server finds the pauses and sends only speech on to OpenAI.
//
// The AudioContext runs at the device's own rate and the worklet brings it
// down to 24 kHz itself, because some browsers (Firefox) refuse to connect
// a microphone to an AudioContext at another rate.

const WORKLET = `
class Pcm24k extends AudioWorkletProcessor {
  constructor() { super(); this.step = sampleRate / 24000; this.pos = 0; this.out = new Int16Array(2400); this.n = 0; }
  process(inputs) {
    const ch = inputs[0];
    if (!ch || !ch.length) return true;
    const a = ch[0], b = ch[1];
    for (; this.pos < a.length; this.pos += this.step) {
      const i = Math.floor(this.pos);
      let v = b ? (a[i] + b[i]) / 2 : a[i];
      v = Math.max(-1, Math.min(1, v));
      this.out[this.n++] = v < 0 ? v * 0x8000 : v * 0x7fff;
      if (this.n === this.out.length) { this.port.postMessage(this.out.buffer, [this.out.buffer]); this.out = new Int16Array(2400); this.n = 0; }
    }
    this.pos -= a.length;
    return true;
  }
}
registerProcessor("pcm-24k", Pcm24k);
`;

export type CaptionFeedMessage =
  | { type: "ready" }
  | { type: "partial" | "final"; item: string; text: string }
  | { type: "stopped" | "warning"; reason: string; message?: string }
  | { type: "closed" };

/** Start sending the track's sound. Returns a function that stops it. */
export async function startCaptionFeed(track: MediaStreamTrack, socketUrl: string, onMessage: (m: CaptionFeedMessage) => void): Promise<() => void> {
  const ctx = new AudioContext();
  const url = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
  try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
  const src = ctx.createMediaStreamSource(new MediaStream([track]));
  const node = new AudioWorkletNode(ctx, "pcm-24k", { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 2, channelCountMode: "clamped-max" });
  const ws = new WebSocket(socketUrl);
  ws.binaryType = "arraybuffer";
  let stopped = false;
  node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
    // Never let a slow connection pile up sound: drop pieces past 2 seconds of backlog.
    if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 96_000) ws.send(e.data);
  };
  ws.onmessage = (e) => { try { onMessage(JSON.parse(String(e.data))); } catch { /* not ours */ } };
  ws.onclose = () => { if (!stopped) onMessage({ type: "closed" }); stop(); };
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", () => reject(new Error("The captions connection could not be opened.")), { once: true });
  }).catch((e) => { stop(); throw e; });
  src.connect(node);
  if (ctx.state === "suspended") await ctx.resume().catch(() => {});

  function stop() {
    if (stopped) return;
    stopped = true;
    try { src.disconnect(); } catch {}
    node.port.onmessage = null;
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
    void ctx.close().catch(() => {});
  }
  return stop;
}
