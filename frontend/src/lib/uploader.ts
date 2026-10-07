// src/lib/uploader.ts
// vm_upload: sends a file to storage in parts, and keeps going.
//
// A part that fails is sent again by itself. When the network drops,
// the upload waits and continues from the parts that already arrived.
// After a closed tab or a restart, starting again with the same file
// asks the server which parts it has and sends only the rest.
import { getUpload, getPartUrls, completeUpload, absoluteUrl, ApiError, type UploadInfo } from "./api";

export type UploadPhase = "starting" | "uploading" | "waiting" | "finishing" | "done" | "stopped";

export interface UploadProgress {
  phase: UploadPhase;
  uploadedBytes: number;
  totalBytes: number;
  partsDone: number;
  partCount: number;
}

/** Thrown when storage refuses the browser outright: almost always a missing CORS rule on the bucket. */
export class StorageBlockedError extends Error {
  constructor() {
    super("Storage is refusing uploads from this site. If the bucket is new, its CORS policy must allow PUT from this site's address. Press Resume to try again.");
    this.name = "StorageBlockedError";
  }
}

/** Thrown by start() when stop() was called. Not a failure: the upload can be started again. */
export class UploadStopped extends Error {
  constructor() { super("Upload paused."); this.name = "UploadStopped"; }
}

const CONCURRENCY = 3;
/** Seconds to wait before trying a failed part again. The last value repeats. */
const BACKOFF = [1, 2, 4, 8, 15];
/** Give up after this many failures in a row with nothing getting through (about ten minutes). */
const MAX_FAILS = 45;
/** Failures in a row, with nothing ever getting through while online, before the browser is judged to be blocked. */
const BLOCKED_AFTER = 4;
/** A part that makes no progress for this long is cut off and tried again. */
const STALL_MS = 60_000;

interface PutResult { ok: boolean; status: number }

export class ResumableUpload {
  private stopped = false;
  private done = new Set<number>();
  private loaded = new Map<number, number>();        // bytes sent of parts in flight
  private xhrs = new Set<XMLHttpRequest>();
  private urls = new Map<number, { url: string; until: number }>();
  private failsInRow = 0;
  private everSucceeded = false;
  private phase: UploadPhase = "starting";
  private wake: (() => void) | null = null;

  constructor(
    private file: File,
    private info: UploadInfo,
    private onProgress: (p: UploadProgress) => void,
  ) {}

  /** Stop sending. What has arrived stays in storage, so a later start continues from it. */
  stop() {
    this.stopped = true;
    this.xhrs.forEach((x) => x.abort());
    this.wake?.();
    this.setPhase("stopped");
  }

  private sizeOf(n: number) {
    return n < this.info.partCount ? this.info.partSize : this.info.size - (this.info.partCount - 1) * this.info.partSize;
  }

  private emit() {
    let bytes = 0;
    this.done.forEach((n) => { bytes += this.sizeOf(n); });
    this.loaded.forEach((b, n) => { if (!this.done.has(n)) bytes += Math.min(b, this.sizeOf(n)); });
    this.onProgress({
      phase: this.phase, uploadedBytes: Math.min(bytes, this.info.size), totalBytes: this.info.size,
      partsDone: this.done.size, partCount: this.info.partCount,
    });
  }
  private setPhase(p: UploadPhase) { this.phase = p; this.emit(); }

  private sleep(ms: number) {
    return new Promise<void>((resolve) => {
      const t = setTimeout(done, ms);
      const online = () => done();
      const self = this;
      function done() { clearTimeout(t); window.removeEventListener("online", online); self.wake = null; resolve(); }
      window.addEventListener("online", online);     // the network came back: do not sit out the wait
      this.wake = done;
    });
  }

  private async urlFor(n: number, pending: number[]): Promise<string> {
    const hit = this.urls.get(n);
    if (hit && hit.until > Date.now()) return hit.url;
    // Ask for this part and the next few in one request.
    const batch = [n, ...pending.filter((x) => x !== n)].slice(0, 20);
    const { urls, expiresIn } = await getPartUrls(this.info.videoId, batch);
    const until = Date.now() + (expiresIn - 120) * 1000;
    Object.keys(urls).forEach((k) => this.urls.set(Number(k), { url: absoluteUrl(urls[k]), until }));
    return this.urls.get(n)!.url;
  }

  private put(n: number, url: string): Promise<PutResult> {
    return new Promise((resolve) => {
      const start = (n - 1) * this.info.partSize;
      const xhr = new XMLHttpRequest();
      let stall: ReturnType<typeof setTimeout>;
      const arm = () => { clearTimeout(stall); stall = setTimeout(() => xhr.abort(), STALL_MS); };
      const end = (r: PutResult) => { clearTimeout(stall); this.xhrs.delete(xhr); this.loaded.delete(n); resolve(r); };
      xhr.upload.onprogress = (e) => { arm(); this.loaded.set(n, e.loaded); this.emit(); };
      xhr.onload = () => end({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status });
      xhr.onerror = () => end({ ok: false, status: 0 });
      xhr.onabort = () => end({ ok: false, status: 0 });
      xhr.open("PUT", url);
      this.xhrs.add(xhr); arm();
      xhr.send(this.file.slice(start, start + this.sizeOf(n)));
    });
  }

  private async worker(queue: number[]) {
    while (!this.stopped) {
      const n = queue.shift();
      if (n === undefined) return;
      for (;;) {
        if (this.stopped) return;
        let result: PutResult;
        try { result = await this.put(n, await this.urlFor(n, queue)); }
        catch (err) {
          // Asking for an address failed. A clear refusal ends the upload; no answer means the network.
          if (err instanceof ApiError && err.status >= 400 && err.status < 500 && ![408, 429].includes(err.status)) throw err;
          result = { ok: false, status: 0 };
        }
        if (this.stopped) return;
        if (result.ok) {
          this.done.add(n); this.failsInRow = 0; this.everSucceeded = true;
          if (this.phase !== "uploading") this.setPhase("uploading"); else this.emit();
          break;
        }
        if (result.status === 403) this.urls.delete(n);            // the address ran out: get a new one
        else if (result.status >= 400 && result.status < 500 && ![408, 429].includes(result.status)) {
          throw new Error(`Storage refused part ${n} (${result.status}).`);
        }
        this.failsInRow++;
        // Online, nothing has ever got through, and the request never
        // reached a server answer: the browser is being blocked.
        if (result.status === 0 && !this.everSucceeded && navigator.onLine && this.failsInRow >= BLOCKED_AFTER) {
          throw new StorageBlockedError();
        }
        if (this.failsInRow >= MAX_FAILS) throw new Error("The connection has been down for too long. Press Resume when it is back.");
        this.setPhase("waiting");
        await this.sleep(BACKOFF[Math.min(this.failsInRow - 1, BACKOFF.length - 1)] * 1000);
      }
    }
  }

  /** Send everything that has not arrived yet, then join the parts. Resolves when the file is whole in storage. */
  async start(): Promise<{ id: string; status: string }> {
    this.stopped = false; this.failsInRow = 0;
    this.setPhase("starting");
    for (let round = 0; round < 4; round++) {
      const state = await getUpload(this.info.videoId);
      if (state.status === "completed") { this.setPhase("done"); return { id: this.info.videoId, status: "transcribing" }; }
      this.done = new Set(state.done ?? []);
      const queue = Array.from({ length: this.info.partCount }, (_, i) => i + 1).filter((n) => !this.done.has(n));
      this.setPhase(queue.length ? "uploading" : "finishing");

      let firstError: unknown = null;
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () =>
        this.worker(queue).catch((err) => { if (!firstError) firstError = err; this.stopped = true; this.xhrs.forEach((x) => x.abort()); this.wake?.(); })));
      if (firstError) { this.setPhase("stopped"); throw firstError; }
      if (this.stopped) throw new UploadStopped();

      this.setPhase("finishing");
      try {
        const res = await completeUpload(this.info.videoId);
        this.setPhase("done");
        return res;
      } catch (err) {
        // The server found a part missing or cut short: go round again for it.
        if (err instanceof ApiError && err.code === "incomplete") continue;
        this.setPhase("stopped");
        throw err;
      }
    }
    this.setPhase("stopped");
    throw new Error("Some parts keep failing to arrive. Press Resume to try again.");
  }
}
