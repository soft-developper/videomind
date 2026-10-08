// src/lib/anchors.ts
// vm_anchors: storing a video on Shelby, tracked.
//
// The owner's wallet writes the file to Shelby in the browser and tells
// the API it did. The API does not take that on trust: it looks the
// object up in the Shelby object index and reads the blob from the Shelby
// contract, then records what the chain says (blob uid, commitment, size,
// paid until).
//
// States of one store (one row in anchors):
//   checking    the wallet reported it; not seen on the chain yet
//   anchored    seen on the chain, owned by the wallet, storage paid
//   lapsed      the paid storage period has ended
//   missing     was on the chain, is not any more (shelbynet is reset
//               about once a week, which removes everything)
//   unverified  never seen on the chain, or seen under another owner
//
// Shelby has no renew call: storage is prepaid for a number of payment
// epochs when the blob is registered. Storing again registers a new blob
// under a new name (raw-2.mp4, raw-3.mp4 and so on). The commitment of a
// new store is compared with the first one, which shows whether it is the
// same file.
//
// The chain reads match the real responses recorded from shelbynet on
// 6 Oct 2026 (see frontend/src/lib/onchain.ts, which the proof panel uses).
import crypto from "crypto";
import { getDb } from "./db.js";
import { normalizeWallet } from "./auth.js";

export const ANCHOR_CHECK = "anchor_check";
export type AnchorState = "checking" | "anchored" | "lapsed" | "missing" | "unverified";
export const NETWORK = "shelbynet";

/** The contract that shelbynet's blobs live in. */
const SHELBY_DEPLOYER = "0x85fdb9a176ab8ef1d9d9c1b60d60b3924f0800ac1de1cc2085fb0b8bb4988e6a";
const indexerUrl = () => process.env.SHELBY_INDEXER_URL || "https://api.shelbynet.aptoslabs.com/v1/graphql";
const fullnodeUrl = () => process.env.SHELBY_FULLNODE_URL || "https://api.shelbynet.shelby.xyz/v1";

export interface Anchor {
  id: string;
  videoId: string;
  wallet: string;
  network: string;
  blobName: string;
  objectName: string;
  state: AnchorState;
  blobUid: string | null;
  commitment: string | null;
  sizeBytes: number | null;
  /** milliseconds */
  paidUntil: number | null;
  /** milliseconds */
  committedAt: number | null;
  /** true when the commitment equals the first store's */
  sameAsFirst: boolean | null;
  error: string | null;
  createdAt: number;
  checkedAt: number | null;
}

const n = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
function rowToAnchor(r: Record<string, unknown>): Anchor {
  return {
    id: String(r.id), videoId: String(r.video_id), wallet: String(r.wallet), network: String(r.network),
    blobName: String(r.blob_name), objectName: String(r.object_name), state: String(r.state) as AnchorState,
    blobUid: r.blob_uid ? String(r.blob_uid) : null, commitment: r.commitment ? String(r.commitment) : null,
    sizeBytes: n(r.size_bytes), paidUntil: n(r.paid_until), committedAt: n(r.committed_at),
    sameAsFirst: r.same_as_first === null || r.same_as_first === undefined ? null : Number(r.same_as_first) === 1,
    error: r.error ? String(r.error) : null, createdAt: Number(r.created_at), checkedAt: n(r.checked_at),
  };
}

/** Objects are indexed as "@{owner without 0x}/{blob name}". */
export function objectNameOf(wallet: string, blobName: string): string {
  return `@${(normalizeWallet(wallet) ?? wallet.toLowerCase()).replace(/^0x/, "")}/${blobName}`;
}

/** Names this app writes: videomind/videos/<video id>/raw.<ext>, then raw-2.<ext>, raw-3.<ext>. */
export function blobNameFor(videoId: string, firstName: string, attempt: number): string {
  if (attempt <= 1) return firstName.replace(/\/raw-[0-9]{1,4}(\.[a-z0-9]{1,5})?$/i, "/raw$1");
  // The video may already point at a later store (raw-2.mp4): the number is replaced, not added to.
  const m = firstName.match(/^(.*\/raw)(?:-[0-9]{1,4})?(\.[a-z0-9]{1,5})?$/i);
  return m ? `${m[1]}-${attempt}${m[2] ?? ""}` : `videomind/videos/${videoId}/raw-${attempt}`;
}
export function isOurBlobName(videoId: string, name: string): boolean {
  return new RegExp(`^videomind/videos/${videoId}/raw(-[0-9]{1,4})?(\\.[a-z0-9]{1,5})?$`, "i").test(name);
}

export async function listAnchors(videoId: string): Promise<Anchor[]> {
  const r = await getDb().execute({ sql: "SELECT * FROM anchors WHERE video_id = ? ORDER BY created_at, rowid", args: [videoId] });
  return r.rows.map((x) => rowToAnchor(x as Record<string, unknown>));
}
export async function getAnchor(id: string): Promise<Anchor | null> {
  const r = await getDb().execute({ sql: "SELECT * FROM anchors WHERE id = ?", args: [id] });
  return r.rows[0] ? rowToAnchor(r.rows[0] as Record<string, unknown>) : null;
}
export async function deleteAnchorsForVideo(videoId: string): Promise<void> {
  await getDb().execute({ sql: "DELETE FROM anchors WHERE video_id = ?", args: [videoId] });
}

/** The newest store, which is the one that counts. */
export const latest = (list: Anchor[]) => (list.length ? list[list.length - 1] : null);

/** Days before the paid period ends when storing again is offered. */
export const RENEW_WINDOW_MS = 3 * 86_400_000;

/** Whether the owner may store the video again now, and why not. */
export function canStoreAgain(list: Anchor[], now = Date.now()): { ok: boolean; reason?: string } {
  const cur = latest(list);
  if (!cur) return { ok: true };
  if (cur.state === "checking") return { ok: false, reason: "The last store is still being confirmed." };
  if (cur.state === "anchored" && !(cur.paidUntil && cur.paidUntil - now < RENEW_WINDOW_MS)) {
    return { ok: false, reason: "It is stored on Shelby and paid for. It can be stored again in the last 3 days of the paid period." };
  }
  return { ok: true };
}

export async function addAnchor(a: { videoId: string; wallet: string; blobName: string }): Promise<Anchor> {
  const now = Date.now();
  const id = crypto.randomUUID();
  const wallet = normalizeWallet(a.wallet) ?? a.wallet.toLowerCase();
  await getDb().execute({
    sql: `INSERT INTO anchors (id, video_id, wallet, network, blob_name, object_name, state, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 'checking', ?, ?)`,
    args: [id, a.videoId, wallet, NETWORK, a.blobName, objectNameOf(wallet, a.blobName), now, now],
  });
  return (await getAnchor(id))!;
}

// ── reading the chain ───────────────────────────────────────────────────────

export interface ChainObject {
  owner: string;
  blobUid: string;
  storedSize: number;
  committedAtMicros: number | null;
}
export interface ChainBlob {
  commitment: string | null;
  size: number | null;
  state: string | null;
  payment: { epochs: number; creationEpoch: number } | null;
}
export interface ChainClock { epochMicros: number; currentEpoch: number; currentEpochStart: number }

function headers(): Record<string, string> {
  const key = process.env.APTOS_API_KEY;
  return { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) };
}
async function post(url: string, body: unknown): Promise<string> {
  const res = await fetch(url, { method: "POST", headers: headers(), body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
  const text = await res.text();
  if (!res.ok) { const e: any = new Error(`Shelby answered ${res.status}`); e.code = "chain_unreachable"; throw e; }
  return text;
}
const variant = (v: unknown) => (v && typeof v === "object" && typeof (v as any).__variant__ === "string" ? (v as any).__variant__ as string : null);

/** One object from the index, or null when it is not there. blob_uid is a u64, kept as text. */
export function parseObject(text: string): ChainObject | null {
  const json = JSON.parse(text.replace(/("blob_uid"\s*:\s*)(\d+)/g, '$1"$2"'));
  if (json?.errors?.length) { const e: any = new Error(json.errors[0]?.message ?? "Index error"); e.code = "chain_unreachable"; throw e; }
  const row = json?.data?.shelby_objects?.[0];
  if (!row) return null;
  return { owner: String(row.owner ?? ""), blobUid: String(row.blob_uid ?? ""), storedSize: Number(row.stored_size ?? 0), committedAtMicros: n(row.committed_at_micros) };
}
export function parseBlob(json: unknown): ChainBlob | null {
  const meta = (json as any)?.[0]?.vec?.[0];
  if (!meta || typeof meta !== "object") return null;
  const pay = meta.payment;
  const epochs = n(pay?.num_payment_epochs), creationEpoch = n(pay?.creation_payment_epoch);
  return {
    commitment: typeof meta.content?.blob_commitment === "string" ? meta.content.blob_commitment : null,
    size: n(meta.content?.blob_size),
    state: variant(meta.state),
    payment: epochs !== null && creationEpoch !== null ? { epochs, creationEpoch } : null,
  };
}
/** A blob registered in epoch C with N epochs paid is covered until epoch C + N starts. Microseconds. */
export function paidUntilMicros(p: { epochs: number; creationEpoch: number }, c: ChainClock): number {
  return c.currentEpochStart + (p.creationEpoch + p.epochs - c.currentEpoch) * c.epochMicros;
}

async function view(fn: string, args: string[]): Promise<unknown> {
  return JSON.parse(await post(`${fullnodeUrl()}/view`, { function: `${SHELBY_DEPLOYER}::${fn}`, type_arguments: [], arguments: args }));
}
const u64 = (j: unknown) => (Array.isArray(j) ? n(j[0]) : null);

export interface ChainRecord { object: ChainObject; blob: ChainBlob | null; paidUntilMs: number | null }

/** What the chain says about one object name, or null when it is not stored. */
export async function readChain(objectName: string): Promise<ChainRecord | null> {
  const object = parseObject(await post(indexerUrl(), {
    query: `query VideoMindObject($name: String!) { shelby_objects(where: { name: { _eq: $name } }, limit: 1) { name owner blob_uid stored_size committed_at_micros location_name } }`,
    variables: { name: objectName },
  }));
  if (!object) return null;
  const [metaR, durR, curR, startR] = await Promise.allSettled([
    view("blob_metadata::get_blob_metadata", [object.blobUid]),
    view("config::get_payment_epoch_duration", []),
    view("epoch::get_current_payment_epoch", []),
    view("epoch::get_last_payment_epoch_start_time", []),
  ]);
  const blob = metaR.status === "fulfilled" ? parseBlob(metaR.value) : null;
  const clock = durR.status === "fulfilled" && curR.status === "fulfilled" && startR.status === "fulfilled"
    ? { epochMicros: u64(durR.value), currentEpoch: u64(curR.value), currentEpochStart: u64(startR.value) } : null;
  const paidUntilMs = blob?.payment && clock && clock.epochMicros !== null && clock.currentEpoch !== null && clock.currentEpochStart !== null
    ? Math.floor(paidUntilMicros(blob.payment, clock as ChainClock) / 1000) : null;
  return { object, blob, paidUntilMs };
}

// ── checking a store ──────────────────────────────────────────────────────────

async function save(id: string, patch: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(patch);
  await getDb().execute({
    sql: `UPDATE anchors SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`,
    args: [...keys.map((k) => patch[k] as any), Date.now(), id],
  });
}

/**
 * Look one store up on the chain and record what was found. Returns the
 * new state. "notYet" tells the caller the object is not indexed yet, so a
 * fresh store can be looked up again a little later.
 */
export async function checkAnchor(id: string, opts: { lastTry?: boolean; expectedSize?: number | null } = {}): Promise<{ state: AnchorState; notYet: boolean }> {
  const a = await getAnchor(id);
  if (!a) return { state: "unverified", notYet: false };
  const objectName = objectNameOf(a.wallet, a.blobName);
  const now = Date.now();
  const found = await readChain(objectName);

  if (!found) {
    // A store never seen on the chain (checking, or unverified and looked up again by hand)
    if (a.state === "checking" || a.state === "unverified") {
      if (!opts.lastTry) { await save(id, { object_name: objectName, checked_at: now }); return { state: a.state, notYet: true }; }
      await save(id, { object_name: objectName, state: "unverified", checked_at: now,
        error: "Shelby has no file under this name. The wallet may not have finished storing it." });
      return { state: "unverified", notYet: false };
    }
    if (a.state === "anchored" || a.state === "lapsed") {
      await save(id, { state: "missing", checked_at: now, error: null });
      return { state: "missing", notYet: false };
    }
    await save(id, { checked_at: now });
    return { state: a.state, notYet: false };
  }

  if (normalizeWallet(found.object.owner) !== normalizeWallet(a.wallet)) {
    await save(id, { object_name: objectName, state: "unverified", checked_at: now, error: "The file on Shelby belongs to a different account." });
    return { state: "unverified", notYet: false };
  }

  const commitment = found.blob?.commitment ?? a.commitment;
  // The first store whose commitment is known sets what "the same file" means.
  const first = (await listAnchors(a.videoId)).find((x) => x.commitment && x.id !== id && x.createdAt <= a.createdAt);
  const sameAsFirst = commitment ? (first?.commitment ? first.commitment.toLowerCase() === commitment.toLowerCase() : true) : null;
  const size = found.blob?.size ?? found.object.storedSize;
  const paidUntil = found.paidUntilMs;
  const state: AnchorState = paidUntil !== null && paidUntil <= now ? "lapsed" : "anchored";
  const sizeNote = opts.expectedSize && size && size !== opts.expectedSize
    ? `The file on Shelby is ${size} bytes; the video in the library is ${opts.expectedSize} bytes.` : null;
  await save(id, {
    object_name: objectName, state, blob_uid: found.object.blobUid, commitment, size_bytes: size,
    paid_until: paidUntil, committed_at: found.object.committedAtMicros !== null ? Math.floor(found.object.committedAtMicros / 1000) : null,
    same_as_first: sameAsFirst === null ? null : sameAsFirst ? 1 : 0, error: sizeNote, checked_at: now,
  });
  return { state, notYet: false };
}

/**
 * Look again at stores that were confirmed, so a lapsed or reset store is
 * shown as such. Each is looked at no more than once in `everyMs`.
 */
export async function recheckAnchors(limit = 50, everyMs = 12 * 3600_000): Promise<number> {
  const r = await getDb().execute({
    sql: `SELECT a.id FROM anchors a
           WHERE a.state IN ('anchored', 'lapsed') AND COALESCE(a.checked_at, 0) < ?
             AND a.created_at = (SELECT MAX(b.created_at) FROM anchors b WHERE b.video_id = a.video_id)
           ORDER BY COALESCE(a.checked_at, 0) LIMIT ?`,
    args: [Date.now() - everyMs, limit],
  });
  let done = 0;
  for (const row of r.rows) {
    try { await checkAnchor(String((row as any).id)); done++; }
    catch (err: any) { console.warn(`[anchors] recheck stopped: ${err?.message ?? err}`); break; }
  }
  return done;
}

/** Stores waiting to be confirmed that have no check queued (rows from before this part). */
export async function pendingWithoutCheck(limit = 25): Promise<Anchor[]> {
  const r = await getDb().execute({
    sql: `SELECT a.* FROM anchors a
           WHERE a.state = 'checking'
             AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.idempotency_key = a.video_id || ':${ANCHOR_CHECK}:' || a.id)
           ORDER BY a.created_at LIMIT ?`,
    args: [limit],
  });
  return r.rows.map((x) => rowToAnchor(x as Record<string, unknown>));
}

/** vm_profile: every store of many videos at once, oldest first per video. */
export async function anchorsForVideos(videoIds: string[]): Promise<Map<string, Anchor[]>> {
  const out = new Map<string, Anchor[]>();
  if (!videoIds.length) return out;
  const r = await getDb().execute({
    sql: `SELECT * FROM anchors WHERE video_id IN (${videoIds.map(() => "?").join(",")}) ORDER BY created_at, rowid`,
    args: videoIds,
  });
  for (const row of r.rows) {
    const a = rowToAnchor(row as Record<string, unknown>);
    out.set(a.videoId, [...(out.get(a.videoId) ?? []), a]);
  }
  return out;
}
