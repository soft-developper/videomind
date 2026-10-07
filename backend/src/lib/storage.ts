// src/lib/storage.ts
// vm_storage: one place that knows where files are kept.
//
// Two drivers behind the same interface:
//
//   local  a folder on this machine. Fine for development. On Render the
//          disk is wiped on every deploy, so it is NOT a durable copy.
//   s3     any S3 compatible object store (Cloudflare R2, AWS S3,
//          Backblaze B2, MinIO ...). This is the durable copy.
//
// Which one runs is decided by the environment:
//
//   STORAGE_DRIVER         "s3" or "local". If unset: s3 when S3_BUCKET
//                          is set, otherwise local.
//   STORAGE_LOCAL_DIR      folder for the local driver (default uploads/storage)
//   S3_ENDPOINT            for R2: https://<ACCOUNT_ID>.r2.cloudflarestorage.com
//                          (leave unset for AWS S3)
//   S3_REGION              "auto" for R2 (the default), a real region for AWS
//   S3_BUCKET              bucket name
//   S3_ACCESS_KEY_ID       access key
//   S3_SECRET_ACCESS_KEY   secret key
//   S3_FORCE_PATH_STYLE    "true" for MinIO style servers
//
// Keys are plain relative paths such as videos/<id>/original.mp4. Nothing
// outside this file should build a disk path or a bucket address.
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import crypto from "crypto";
import { pipeline } from "stream/promises";
import type { Readable } from "stream";
import {
  S3Client,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface StoredObject { key: string; size: number; contentType?: string }

export interface Storage {
  readonly driver: "local" | "s3";
  /** True when a restart or deploy of this service cannot lose the files. */
  readonly durable: boolean;
  /** One line for the startup log. Never contains a secret. */
  describe(): string;
  /** Move a file on disk into storage. On success the source file is gone. */
  moveIn(key: string, filePath: string, opts?: { contentType?: string }): Promise<{ size: number }>;
  /** Size and type of an object, or null if it does not exist. */
  head(key: string): Promise<StoredObject | null>;
  /**
   * Run fn with the object available as a file on disk. Any temporary
   * copy is removed afterwards. Throws ObjectMissingError if the object
   * does not exist.
   */
  withLocalFile<T>(key: string, fn: (filePath: string) => Promise<T>): Promise<T>;
  /** Delete one object. Deleting an object that is not there is not an error. */
  delete(key: string): Promise<void>;
  /** Delete every object under a prefix. Returns how many were removed. */
  deletePrefix(prefix: string): Promise<number>;
  /** A time limited download address, or null if the driver has none. */
  signedUrl(key: string, expiresSeconds: number): Promise<string | null>;
  /** Write, read back and delete a tiny object. Throws if any step fails. */
  check(): Promise<void>;
}

export class ObjectMissingError extends Error {
  constructor(key: string) { super(`Stored object not found: ${key}`); this.name = "ObjectMissingError"; }
}

export class StorageConfigError extends Error {
  constructor(message: string) { super(message); this.name = "StorageConfigError"; }
}

/**
 * Keys are relative, use forward slashes and a small safe alphabet, and
 * never climb out of their folder. Anything else is a bug in the caller,
 * so it throws.
 */
export function assertKey(key: string): string {
  const ok =
    typeof key === "string" &&
    key.length > 0 && key.length <= 512 &&
    /^[A-Za-z0-9._\/-]+$/.test(key) &&
    !key.startsWith("/") && !key.endsWith("/") &&
    !key.split("/").some((part) => part === "" || part === "." || part === "..");
  if (!ok) throw new Error(`Invalid storage key: ${JSON.stringify(key)}`);
  return key;
}

function assertPrefix(prefix: string): string {
  if (!prefix.endsWith("/")) throw new Error(`A storage prefix must end with "/": ${JSON.stringify(prefix)}`);
  assertKey(prefix.slice(0, -1));
  return prefix;
}

// ── local driver ──────────────────────────────────────────────────────────

class LocalStorage implements Storage {
  readonly driver = "local" as const;
  readonly durable = false;
  constructor(private root: string) {}

  describe() { return `local disk at ${this.root} (not durable: a deploy wipes it)`; }

  private pathOf(key: string): string {
    const full = path.resolve(this.root, assertKey(key));
    if (!full.startsWith(this.root + path.sep)) throw new Error(`Invalid storage key: ${JSON.stringify(key)}`);
    return full;
  }

  async moveIn(key: string, filePath: string) {
    const dest = this.pathOf(key);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    try {
      await fsp.rename(filePath, dest);
    } catch (err: any) {
      if (err?.code !== "EXDEV") throw err;
      // Source and destination are on different disks: copy, then remove.
      await fsp.copyFile(filePath, dest);
      await fsp.unlink(filePath);
    }
    return { size: (await fsp.stat(dest)).size };
  }

  async head(key: string) {
    const stat = await fsp.stat(this.pathOf(key)).catch(() => null);
    return stat?.isFile() ? { key, size: stat.size } : null;
  }

  async withLocalFile<T>(key: string, fn: (filePath: string) => Promise<T>): Promise<T> {
    const file = this.pathOf(key);
    if (!(await this.head(key))) throw new ObjectMissingError(key);
    return fn(file);
  }

  async delete(key: string) {
    await fsp.unlink(this.pathOf(key)).catch((err: any) => { if (err?.code !== "ENOENT") throw err; });
  }

  async deletePrefix(prefix: string) {
    const dir = path.resolve(this.root, assertPrefix(prefix));
    if (!dir.startsWith(this.root + path.sep)) throw new Error(`Invalid storage prefix: ${JSON.stringify(prefix)}`);
    let count = 0;
    const walk = async (d: string) => {
      for (const e of await fsp.readdir(d, { withFileTypes: true }).catch(() => [])) {
        if (e.isDirectory()) await walk(path.join(d, e.name)); else count++;
      }
    };
    await walk(dir);
    await fsp.rm(dir, { recursive: true, force: true });
    return count;
  }

  async signedUrl() { return null; }

  async check() {
    await fsp.mkdir(this.root, { recursive: true });
    const key = `_check/${crypto.randomUUID()}.txt`;
    await fsp.mkdir(path.dirname(this.pathOf(key)), { recursive: true });
    await fsp.writeFile(this.pathOf(key), "ok");
    const back = await fsp.readFile(this.pathOf(key), "utf8");
    await this.delete(key);
    if (back !== "ok") throw new Error("local storage read back the wrong content");
  }
}

// ── S3 compatible driver ──────────────────────────────────────────────────

interface S3Config {
  endpoint?: string; region: string; bucket: string;
  accessKeyId: string; secretAccessKey: string; forcePathStyle: boolean;
}

function isNotFound(err: any): boolean {
  const status = err?.$metadata?.httpStatusCode;
  return status === 404 || err?.name === "NotFound" || err?.name === "NoSuchKey";
}

class S3Storage implements Storage {
  readonly driver = "s3" as const;
  readonly durable = true;
  private client: S3Client;

  constructor(private cfg: S3Config) {
    this.client = new S3Client({
      region: cfg.region,
      ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}),
      forcePathStyle: cfg.forcePathStyle,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      // Only send the newer integrity checksums when an operation needs
      // one. Not every S3 compatible store accepts them on every call.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }

  describe() {
    const where = this.cfg.endpoint ? new URL(this.cfg.endpoint).host : `AWS ${this.cfg.region}`;
    return `S3 compatible, bucket "${this.cfg.bucket}" at ${where}`;
  }

  async moveIn(key: string, filePath: string, opts: { contentType?: string } = {}) {
    assertKey(key);
    const size = (await fsp.stat(filePath)).size;
    // Upload sends small files in one request and large ones in parts,
    // and aborts an unfinished multipart upload if a part fails.
    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.cfg.bucket,
        Key: key,
        Body: fs.createReadStream(filePath),
        ...(opts.contentType ? { ContentType: opts.contentType } : {}),
      },
      partSize: 8 * 1024 * 1024,
      queueSize: 4,
      leavePartsOnError: false,
    });
    await upload.done();
    await fsp.unlink(filePath).catch(() => {});
    return { size };
  }

  async head(key: string) {
    assertKey(key);
    try {
      const r = await this.client.send(new HeadObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
      return { key, size: Number(r.ContentLength ?? 0), contentType: r.ContentType };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async withLocalFile<T>(key: string, fn: (filePath: string) => Promise<T>): Promise<T> {
    assertKey(key);
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "vm-src-"));
    // Keep the file name: the transcription service reads the extension.
    const file = path.join(dir, path.basename(key));
    try {
      let body: Readable;
      try {
        const r = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
        body = r.Body as Readable;
      } catch (err) {
        if (isNotFound(err)) throw new ObjectMissingError(key);
        throw err;
      }
      await pipeline(body, fs.createWriteStream(file));
      return await fn(file);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async delete(key: string) {
    assertKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
  }

  async deletePrefix(prefix: string) {
    assertPrefix(prefix);
    let count = 0;
    let token: string | undefined;
    do {
      const page = await this.client.send(new ListObjectsV2Command({
        Bucket: this.cfg.bucket, Prefix: prefix, ContinuationToken: token,
      }));
      // One delete per object. The batch delete call needs a checksum
      // header that some S3 compatible stores handle differently.
      for (const obj of page.Contents ?? []) {
        if (!obj.Key) continue;
        await this.client.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: obj.Key }));
        count++;
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return count;
  }

  async signedUrl(key: string, expiresSeconds: number) {
    assertKey(key);
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }), {
      expiresIn: Math.max(1, Math.floor(expiresSeconds)),
    });
  }

  async check() {
    const key = `_check/${crypto.randomUUID()}.txt`;
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "vm-check-"));
    try {
      const file = path.join(dir, "check.txt");
      await fsp.writeFile(file, "ok");
      await this.moveIn(key, file, { contentType: "text/plain" });
      const back = await this.withLocalFile(key, (p) => fsp.readFile(p, "utf8"));
      if (back !== "ok") throw new Error("storage read back the wrong content");
    } finally {
      await this.delete(key).catch(() => {});
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

// ── choosing the driver ───────────────────────────────────────────────────

export function createStorage(env: NodeJS.ProcessEnv = process.env): Storage {
  const want = (env.STORAGE_DRIVER ?? "").trim().toLowerCase();
  if (want && want !== "s3" && want !== "local") {
    throw new StorageConfigError(`STORAGE_DRIVER must be "s3" or "local", not "${env.STORAGE_DRIVER}".`);
  }
  const driver = want || (env.S3_BUCKET ? "s3" : "local");

  if (driver === "local") {
    return new LocalStorage(path.resolve(env.STORAGE_LOCAL_DIR || path.join("uploads", "storage")));
  }

  const missing = ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"].filter((n) => !env[n]?.trim());
  if (missing.length) {
    throw new StorageConfigError(`S3 storage is selected but these settings are missing: ${missing.join(", ")}.`);
  }
  const endpoint = env.S3_ENDPOINT?.trim() || undefined;
  if (endpoint) {
    try { new URL(endpoint); } catch { throw new StorageConfigError("S3_ENDPOINT is not a valid address. It should start with https://"); }
  }
  return new S3Storage({
    endpoint,
    region: env.S3_REGION?.trim() || "auto",
    bucket: env.S3_BUCKET!.trim(),
    accessKeyId: env.S3_ACCESS_KEY_ID!.trim(),
    secretAccessKey: env.S3_SECRET_ACCESS_KEY!.trim(),
    forcePathStyle: (env.S3_FORCE_PATH_STYLE ?? "").trim().toLowerCase() === "true",
  });
}

let _storage: Storage | null = null;
export function getStorage(): Storage {
  if (!_storage) _storage = createStorage();
  return _storage;
}

// What the health endpoint reports. Set by checkStorage at startup.
let _health: { driver: string; durable: boolean; ok: boolean; checkedAt: number | null } =
  { driver: "unknown", durable: false, ok: false, checkedAt: null };
export function storageHealth() { return { ..._health }; }

/**
 * Prove at startup that storage works: write, read back, delete. A
 * failure is logged loudly but does not stop the server, so sign in and
 * reading keep working while the storage settings are fixed.
 */
export async function checkStorage(): Promise<boolean> {
  const s = getStorage();
  try {
    await s.check();
    _health = { driver: s.driver, durable: s.durable, ok: true, checkedAt: Date.now() };
    console.log(`[storage] ready: ${s.describe()}`);
    return true;
  } catch (err: any) {
    _health = { driver: s.driver, durable: s.durable, ok: false, checkedAt: Date.now() };
    console.error(`[storage] CHECK FAILED for ${s.describe()}: ${err?.name ?? "Error"}: ${err?.message ?? err}`);
    console.error("[storage] Uploads will fail until this is fixed. Check the S3_* settings.");
    return false;
  }
}

/** Test hook. */
export function _setStorage(s: Storage | null) { _storage = s; }
