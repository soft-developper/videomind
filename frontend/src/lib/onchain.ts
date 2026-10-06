// src/lib/onchain.ts
// vm_shelby09c: on-chain proof data for one video, rebuilt for the
// Shelbynet contract that shipped with @shelby-protocol/sdk 0.8+.
//
// The old `blobs` indexer table (with expires_at) no longer exists. A
// video's record now comes from three live reads:
//
//   1. Object index (GraphQL, table shelby_objects): name -> blob uid,
//      owner, stored size, commit time, location.
//   2. Contract view blob_metadata::get_blob_metadata(uid): commitment,
//      slice, state and the payment (epochs paid, creation epoch).
//   3. Contract views for the payment epoch clock: epoch length, current
//      epoch and when the current epoch started.
//
// Storage is prepaid for a fixed number of payment epochs at
// registration. There is no expiry argument and no renew call, so the
// "paid until" time is computed from the epochs, not read from a field.
//
// This file has no React and no "@/..." imports on purpose, so the
// parsing can be tested in plain Node against real chain responses.
import { SHELBY_DEPLOYER } from "./explorer";

export const SHELBY_OBJECT_INDEXER = "https://api.shelbynet.aptoslabs.com/v1/graphql";
export const SHELBY_FULLNODE = "https://api.shelbynet.shelby.xyz/v1";

export interface OnChainPayment {
  currency: string | null;
  /** payment epochs paid for at registration */
  epochs: number;
  /** payment epoch the blob was registered in */
  creationEpoch: number;
  /** length of one payment epoch, microseconds (null if the clock read failed) */
  epochMicros: number | null;
  /** end of the last paid epoch, microseconds (null if the clock read failed) */
  paidUntil: number | null;
}

export interface OnChainBlob {
  object_name: string;
  /** u64 on chain. Kept as a string: it can exceed Number.MAX_SAFE_INTEGER. */
  uid: string;
  owner: string;
  location_name: string | null;
  slice_address: string | null;
  size: number;
  num_chunksets: number | null;
  blob_commitment: string | null;
  encoding: string | null;
  /** contract state variant, e.g. "CommittedObject" */
  state: string | null;
  is_committed: boolean;
  /** registration time, microseconds */
  created_at: number | null;
  /** commit time, microseconds */
  committed_at: number | null;
  payment: OnChainPayment | null;
}

export interface IndexedObject {
  name: string;
  owner: string;
  blob_uid: string;
  stored_size: number;
  committed_at_micros: number | null;
  location_name: string | null;
}

export interface BlobMeta {
  owner: string | null;
  blob_commitment: string | null;
  blob_size: number | null;
  chunkset_count: number | null;
  encoding: string | null;
  slice_address: string | null;
  state: string | null;
  creation_micros: number | null;
  payment: { currency: string | null; epochs: number; creationEpoch: number } | null;
}

export interface EpochClock {
  epochMicros: number;
  currentEpoch: number;
  currentEpochStart: number;
}

const OBJECT_QUERY = `
  query VideoMindObject($name: String!) {
    shelby_objects(where: { name: { _eq: $name } }, limit: 1) {
      name
      owner
      blob_uid
      stored_size
      committed_at_micros
      location_name
    }
  }
`;

/**
 * Objects are indexed as "@{ownerWithout0x}/{blobName}".
 */
export function toObjectName(owner: string, blobName: string): string {
  return `@${owner.replace(/^0x/, "")}/${blobName}`;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function variant(v: unknown): string | null {
  if (v && typeof v === "object" && "__variant__" in (v as object)) {
    const name = (v as Record<string, unknown>)["__variant__"];
    return typeof name === "string" ? name : null;
  }
  return null;
}

/**
 * Parse the object-index response from its raw TEXT. blob_uid is a u64
 * that the indexer returns as a bare JSON number; JSON.parse would round
 * it above 2^53, so it is quoted before parsing.
 */
export function parseIndexerObject(text: string): IndexedObject | null {
  const safe = text.replace(/("blob_uid"\s*:\s*)(\d+)/g, '$1"$2"');
  const json = JSON.parse(safe);
  if (json?.errors?.length) {
    throw new Error(json.errors[0]?.message ?? "Indexer error");
  }
  const row = json?.data?.shelby_objects?.[0];
  if (!row) return null;
  return {
    name: String(row.name ?? ""),
    owner: String(row.owner ?? ""),
    blob_uid: String(row.blob_uid ?? ""),
    stored_size: num(row.stored_size) ?? 0,
    committed_at_micros: num(row.committed_at_micros),
    location_name: row.location_name != null ? String(row.location_name) : null,
  };
}

/**
 * Parse the result of the get_blob_metadata view. The view returns
 * Option<BlobMetadata>, which the fullnode encodes as [{ vec: [meta] }]
 * (empty vec = no such blob).
 */
export function parseBlobMetadata(json: unknown): BlobMeta | null {
  const meta = (json as any)?.[0]?.vec?.[0];
  if (!meta || typeof meta !== "object") return null;
  const content = meta.content ?? {};
  const pay = meta.payment;
  const epochs = num(pay?.num_payment_epochs);
  const creationEpoch = num(pay?.creation_payment_epoch);
  return {
    owner: typeof meta.owner === "string" ? meta.owner : null,
    blob_commitment: typeof content.blob_commitment === "string" ? content.blob_commitment : null,
    blob_size: num(content.blob_size),
    chunkset_count: num(content.chunkset_count),
    encoding: variant(content.encoding),
    slice_address: typeof meta.slice?.inner === "string" ? meta.slice.inner : null,
    state: variant(meta.state),
    creation_micros: num(meta.creation_micros),
    payment:
      epochs !== null && creationEpoch !== null
        ? { currency: variant(pay), epochs, creationEpoch }
        : null,
  };
}

/** A view that returns one u64 comes back as ["123"]. */
export function parseU64View(json: unknown): number | null {
  return Array.isArray(json) ? num(json[0]) : null;
}

/**
 * End of the last paid epoch. A blob registered in epoch C with N epochs
 * paid is covered through epoch C + N - 1, i.e. until epoch C + N starts.
 */
export function paidUntilMicros(
  payment: { epochs: number; creationEpoch: number },
  clock: EpochClock
): number {
  const epochsAhead = payment.creationEpoch + payment.epochs - clock.currentEpoch;
  return clock.currentEpochStart + epochsAhead * clock.epochMicros;
}

/** Merge the three reads into the record the proof panel renders. */
export function buildOnChainBlob(
  obj: IndexedObject,
  meta: BlobMeta | null,
  clock: EpochClock | null
): OnChainBlob {
  const payment: OnChainPayment | null = meta?.payment
    ? {
        currency: meta.payment.currency,
        epochs: meta.payment.epochs,
        creationEpoch: meta.payment.creationEpoch,
        epochMicros: clock ? clock.epochMicros : null,
        paidUntil: clock ? paidUntilMicros(meta.payment, clock) : null,
      }
    : null;
  return {
    object_name: obj.name,
    uid: obj.blob_uid,
    owner: obj.owner || meta?.owner || "",
    location_name: obj.location_name,
    slice_address: meta?.slice_address ?? null,
    size: meta?.blob_size ?? obj.stored_size,
    num_chunksets: meta?.chunkset_count ?? null,
    blob_commitment: meta?.blob_commitment ?? null,
    encoding: meta?.encoding ?? null,
    state: meta?.state ?? null,
    // The object index only lists committed objects, so a row there is
    // already proof of commit; the contract state confirms it when read.
    is_committed: meta?.state ? meta.state.startsWith("Committed") : true,
    created_at: meta?.creation_micros ?? null,
    committed_at: obj.committed_at_micros,
    payment,
  };
}

type FetchLike = (url: string, init: any) => Promise<{ text(): Promise<string>; ok: boolean; status: number }>;

function headers(apiKey?: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
}

async function view(
  fetchImpl: FetchLike,
  fn: string,
  args: string[],
  apiKey?: string
): Promise<unknown> {
  const res = await fetchImpl(`${SHELBY_FULLNODE}/view`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({
      function: `${SHELBY_DEPLOYER}::${fn}`,
      type_arguments: [],
      arguments: args,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`view ${fn} failed (${res.status})`);
  return JSON.parse(text);
}

/**
 * Read one video's live on-chain record. Returns null when the object is
 * not in the index (never committed, deleted, or no longer stored).
 * The contract reads are best-effort: if one fails, the panel still
 * shows what the index returned.
 */
export async function fetchOnChainBlob(
  objectName: string,
  apiKey?: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike
): Promise<OnChainBlob | null> {
  const res = await fetchImpl(SHELBY_OBJECT_INDEXER, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({ query: OBJECT_QUERY, variables: { name: objectName } }),
  });
  const obj = parseIndexerObject(await res.text());
  if (!obj) return null;

  const [metaR, durR, curR, startR] = await Promise.allSettled([
    view(fetchImpl, "blob_metadata::get_blob_metadata", [obj.blob_uid], apiKey),
    view(fetchImpl, "config::get_payment_epoch_duration", [], apiKey),
    view(fetchImpl, "epoch::get_current_payment_epoch", [], apiKey),
    view(fetchImpl, "epoch::get_last_payment_epoch_start_time", [], apiKey),
  ]);

  const meta = metaR.status === "fulfilled" ? parseBlobMetadata(metaR.value) : null;

  const epochMicros = durR.status === "fulfilled" ? parseU64View(durR.value) : null;
  const currentEpoch = curR.status === "fulfilled" ? parseU64View(curR.value) : null;
  const currentEpochStart = startR.status === "fulfilled" ? parseU64View(startR.value) : null;
  const clock: EpochClock | null =
    epochMicros !== null && currentEpoch !== null && currentEpochStart !== null
      ? { epochMicros, currentEpoch, currentEpochStart }
      : null;

  return buildOnChainBlob(obj, meta, clock);
}
