// VideoMind, Part 16 probe, seventh run: do 2 MB blocks make a private
// (encrypted) video start and seek fast enough from Shelby?
//
//   cd scripts/shelby_probe
//   export SHELBY_API_KEY=...       # the same value as NEXT_PUBLIC_APTOS_API_KEY
//   node probe7.mjs
//
// Probe 6: with the default layout (10 MB blocks, 16 pieces of which 10 hold
// data), starting or seeking took about 6 s even with 10 reads in flight. The
// SDK has a second layout, ClayCode_4Total_2Data_3Helper (2 MB blocks, 4
// pieces of which 2 hold data), chosen with SHELBY_ENCODING=1. A sealed frame
// then is 2 MB, so a player needs only 2 MB to begin. This stores one sealed
// 21 MB TEST file in that layout (marked AES_GCM_V1) and times, three rounds each:
//   start   frame 0, as 2 x 1 MB, 4 x 512 KB and 8 x 256 KB pieces at once
//   seek    frame 5 (the middle), as 4 x 512 KB and 8 x 256 KB pieces at once
//   stream  the whole file, 10 x 1 MB pieces at once (can it keep up with playback?)
// Every frame read is opened with the secret and checked against the original.
// Then it deletes the file. Writes probe7-report.json, with no keys or secrets.
process.env.SHELBY_ENCODING = "1"; // read by the SDK each time it picks a layout
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { Account, Ed25519PrivateKey, Network } from "@aptos-labs/ts-sdk";
import {
  ShelbyNodeClient, SHELBYUSD_FA_METADATA_ADDRESS, generateCommitments, defaultErasureCodingConfig,
  geometryForEncoding, deriveKek, resolveBlobBinding, createChunksetSealer, createChunksetOpener,
  storedSizeForPlaintext,
} from "@shelby-protocol/sdk/node";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API_KEY = process.env.SHELBY_API_KEY || process.env.NEXT_PUBLIC_APTOS_API_KEY || process.env.APTOS_API_KEY;
const OFFLINE = process.argv.includes("--offline");
if (!API_KEY && !OFFLINE) { console.error("Set SHELBY_API_KEY first. Do not paste it anywhere else."); process.exit(1); }
const MB = 1048576;
const SIZE = 21 * MB;
const BUCKET = "videomind-private";
const HOSTS = { gateway: "https://api.shelbynet.shelby.xyz/shelby", rpc: "https://shelby.shelbynet.shelby.xyz/shelby" };
const ROUNDS = 3;

const report = { probeVersion: 7, startedAt: new Date().toISOString(), host: process.env.RENDER ? "render" : "this machine", hosts: HOSTS, steps: {} };
const say = (s) => console.log(s);
const json = (v) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x instanceof Uint8Array ? `<${x.length} bytes>` : x)));
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
function errText(e) { const p = []; for (let x = e, d = 0; x && d < 6; x = x.cause, d++) p.push(`${x.message ?? String(x)}${x.code ? ` [${x.code}]` : ""}`); return p.join(" <- "); }
async function step(name, fn) {
  say(`\n== ${name}`); const t0 = Date.now();
  try { const out = await fn(); report.steps[name] = { ok: true, ms: Date.now() - t0, ...json(out ?? {}) }; say(`   ok (${Date.now() - t0} ms)`); return out; }
  catch (e) { report.steps[name] = { ok: false, ms: Date.now() - t0, error: errText(e).slice(0, 2000) }; say(`   FAILED: ${errText(e).slice(0, 600)}`); return undefined; }
}
function accounts() {
  const file = path.join(HERE, "probe-accounts.json");
  let saved = {}; try { saved = JSON.parse(fs.readFileSync(file, "utf8")); } catch { /* first run */ }
  const make = (k) => (saved[k] ? Account.fromPrivateKey({ privateKey: new Ed25519PrivateKey(saved[k]) }) : Account.generate());
  const p = make("payer"), t = make("treasury");
  const secret = saved.sseSecret ?? crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(file, JSON.stringify({ note: "shelbynet TEST accounts and a TEST secret made by the probe. No value.", payer: p.privateKey.toString(), treasury: t.privateKey.toString(), sseSecret: secret }, null, 2), { mode: 0o600 });
  return { p, secret: Uint8Array.from(Buffer.from(secret, "hex")) };
}

const config = defaultErasureCodingConfig();
const geometry = geometryForEncoding(config);
const OVERHEAD = geometry.chunksetBytes - geometry.frameBytes;
const { p, secret } = accounts();
const owner = p.accountAddress.toString();
const binding = (name) => resolveBlobBinding({ account: owner, bucket: BUCKET, key: name });
const kek = await (async () => { const b = await binding("x"); return deriveKek({ identityKey: secret, account: b.account, bucketHash: b.bucketHash }); })();

async function seal(plain, name) {
  const s = await createChunksetSealer({ binding: await binding(name), kek, plaintextSize: plain.length, geometry });
  const out = new Uint8Array(s.storedSize);
  for (let i = 0; i < s.blobFrames; i++) { const at = s.plaintextOffset(i); out.set(await s.seal(i, plain.subarray(at, at + s.frameLength(i))), s.chunksetOffset(i)); }
  return out;
}

/** Reads stored [a, b) as pieces with `inFlight` requests at once. Each piece retries up to 3 times. */
async function readParallel(fetchPiece, a, b, inFlight, piece = MB) {
  const pieces = []; for (let x = a; x < b; x += piece) pieces.push([x, Math.min(b, x + piece)]);
  const out = new Array(pieces.length); let next = 0; const stats = { retries: 0, firstPieceMs: null, cuts: [] }; const t0 = Date.now();
  async function worker() {
    for (;;) {
      const i = next++; if (i >= pieces.length) return;
      for (let attempt = 1; ; attempt++) {
        try { out[i] = await fetchPiece(...pieces[i]); if (stats.firstPieceMs === null) stats.firstPieceMs = Date.now() - t0; break; }
        catch (e) { if (stats.cuts.length < 10) stats.cuts.push(errText(e).slice(0, 140)); if (attempt >= 4) throw e; stats.retries++; await new Promise((r) => setTimeout(r, 1000 * attempt)); }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(inFlight, pieces.length) }, worker));
  return { bytes: Buffer.concat(out), ms: Date.now() - t0, ...stats };
}
function pieceFetcher(base, name, withKey) {
  const url = `${base}/v1/blobs/${owner}/${name.split("/").map(encodeURIComponent).join("/")}`;
  return async (a, b) => {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 60_000);
    try {
      const headers = { Range: `bytes=${a}-${b - 1}` }; if (withKey) headers.Authorization = `Bearer ${API_KEY}`;
      const r = await fetch(url, { headers, signal: ctl.signal });
      if (r.status !== 206 && r.status !== 200) throw new Error(`answered ${r.status}: ${(await r.text()).slice(0, 160)}`);
      const buf = Buffer.from(await r.arrayBuffer()); const out = r.status === 200 ? buf.subarray(a, b) : buf;
      if (out.length !== b - a) throw new Error(`got ${out.length} bytes, wanted ${b - a}`);
      return out;
    } finally { clearTimeout(timer); }
  };
}
/** Reads frame f with the given settings, opens it, checks it. */
async function timeFrame(fetchPiece, name, f, inFlight, piece = MB) {
  const o = createChunksetOpener({ binding: await binding(name), kek, plaintextSize: SIZE, geometry });
  const a = f * geometry.chunksetBytes, b = a + o.frameLength(f) + OVERHEAD;
  const r = await readParallel(fetchPiece, a, b, inFlight, piece);
  const t1 = Date.now(); const opened = await o.open(f, new Uint8Array(r.bytes)); const openMs = Date.now() - t1;
  const at = f * geometry.frameBytes; const matches = sha(opened) === sha(plain.subarray(at, at + opened.length));
  if (!matches) throw new Error(`frame ${f} opened but differs from the original`);
  return { readMs: r.ms, openMs, totalMs: r.ms + openMs, mbPerS: +((b - a) / MB / (r.ms / 1000)).toFixed(2), firstPieceMs: r.firstPieceMs, retries: r.retries, cuts: r.cuts };
}
async function rounds(label, fn) {
  const runs = [];
  for (let i = 0; i < ROUNDS; i++) { try { runs.push(await fn()); } catch (e) { runs.push({ error: errText(e).slice(0, 300) }); } }
  const good = runs.filter((r) => !r.error).map((r) => r.totalMs).sort((x, y) => x - y);
  const summary = good.length ? `${(good[Math.floor(good.length / 2)] / 1000).toFixed(1)} s median (${good.map((m) => (m / 1000).toFixed(1)).join(", ")} s)` : "every round failed";
  const failed = runs.filter((r) => r.error).length;
  say(`   ${label.padEnd(34)} ${summary}${failed ? `, ${failed} of ${ROUNDS} failed: ${runs.find((r) => r.error).error.slice(0, 120)}` : ""}`);
  return { medianMs: good.length ? good[Math.floor(good.length / 2)] : null, failed, runs };
}

const plain = crypto.randomBytes(SIZE);

await step("0 parallel reader on this machine (no network)", async () => {
  const name = "probe/local"; const stored = await seal(plain, name);
  const fake = async (a, b) => { if (Math.random() < 0.15) throw new Error("simulated cut"); await new Promise((r) => setTimeout(r, 5)); return Buffer.from(stored.subarray(a, b)); };
  const f0 = await timeFrame(fake, name, 0, 2), f1 = await timeFrame(fake, name, 5, 8, 256 * 1024), f2 = await timeFrame(fake, name, geometry.frameBytes ? Math.ceil(SIZE / geometry.frameBytes) - 1 : 0, 4, 512 * 1024);
  say(`   layout has ${geometry.chunksetBytes / MB} MB blocks; frames 0, 5 and the last open and match through the parallel reader (${f0.retries + f1.retries + f2.retries} simulated cuts retried)`);
  return { ok: true };
});
if (OFFLINE) { say("\n--offline: stopping before the network."); process.exit(0); }

const client = new ShelbyNodeClient({ network: Network.SHELBYNET, apiKey: API_KEY, locationHint: "shelbynet-1" });
const aptos = client.aptos;
say(`\nTest account (shelbynet, no value): ${owner}`);

await step("1 fund the test account", async () => {
  const bal = await aptos.view({ payload: { function: "0x1::primary_fungible_store::balance", typeArguments: ["0x1::fungible_asset::Metadata"], functionArguments: [p.accountAddress, SHELBYUSD_FA_METADATA_ADDRESS] } }).then((r) => Number(r[0])).catch(() => 0);
  if (bal < 1_000_000) await client.fundAccountWithShelbyUSD({ address: p.accountAddress, amount: 100_000_000 }).catch(() => {});
  return { shelbyUsdUnitsBefore: bal };
});

let name;
await step("2 store one sealed 21 MB file in 2 MB blocks, marked AES_GCM_V1", async () => {
  const n = `probe/${Date.now()}-private-2mb.bin`; const data = await seal(plain, n);
  const provider = await client.getProvider();
  const commitments = await generateCommitments(provider, data);
  const { transaction: reg } = await client.coordination.registerBlob({ account: p, blobName: n, blobMerkleRoot: commitments.blob_merkle_root, size: data.length, config: provider.config, encryption: "AES_GCM_V1" });
  const regTx = await client.waitForRegistration(reg.hash);
  const uid = client.uidFromRegisterTx(regTx, p.accountAddress, n);
  const { spAcks } = await client.rpc.putBlobChunksets({ account: p, uid, blobData: data, commitments, totalBytes: data.length });
  const { transaction: commit } = await client.coordination.commitObject({ account: p, uid, blobName: n, overwrite: true, storageProviderAcks: spAcks, options: client.orderlessCommitOptions() });
  const done = await aptos.waitForTransaction({ transactionHash: commit.hash });
  if (!done.success) throw new Error(`commit failed: ${done.vm_status}`);
  const meta = await client.coordination.getBlobMetadata(uid);
  name = n; say(`   stored ${n} (${storedSizeForPlaintext(SIZE, geometry)} bytes), chain says encoding ${meta?.content?.encoding}, encryption ${meta?.content?.encryption}`);
  return { name, chainEncoding: meta?.content?.encoding ?? null, chainEncryption: meta?.content?.encryption ?? null, acks: spAcks.length };
});

if (name) {
  const gw = pieceFetcher(HOSTS.gateway, name, false);
  const KB = 1024;
  const shapes = [[2, MB], [4, 512 * KB], [8, 256 * KB]];
  await step("3 start: frame 0 from the public address", async () => {
    const out = {};
    for (const [n, piece] of shapes) out[`${n}x${piece / KB}KB`] = await rounds(`${n} x ${piece / KB} KB at once`, () => timeFrame(gw, name, 0, n, piece));
    return out;
  });
  await step("4 seek: frame 5 (the middle) from the public address", async () => {
    const out = {};
    for (const [n, piece] of shapes.slice(1)) out[`${n}x${piece / KB}KB`] = await rounds(`${n} x ${piece / KB} KB at once`, () => timeFrame(gw, name, 5, n, piece));
    return out;
  });
  await step("5 stream: the whole file, 10 x 1 MB at once", async () => {
    const total = storedSizeForPlaintext(SIZE, geometry);
    const one = async () => {
      const r = await readParallel(gw, 0, total, 10, MB);
      const o = createChunksetOpener({ binding: await binding(name), kek, plaintextSize: SIZE, geometry });
      const parts = []; for (let f = 0; f < o.blobFrames; f++) { const at = f * geometry.chunksetBytes; parts.push(await o.open(f, new Uint8Array(r.bytes.subarray(at, at + o.frameLength(f) + OVERHEAD)))); }
      if (sha(Buffer.concat(parts)) !== sha(plain)) throw new Error("the whole file opened but differs from the original");
      return { totalMs: r.ms, mbPerS: +(total / MB / (r.ms / 1000)).toFixed(2), retries: r.retries, cuts: r.cuts };
    };
    const res = await rounds("whole file", one);
    const speeds = res.runs.filter((x) => !x.error).map((x) => x.mbPerS);
    if (speeds.length) say(`   sustained ${speeds.join(", ")} MB/s (a 1080p video needs about 0.6 MB/s, 720p about 0.3)`);
    return { whole: res };
  });
  await step("6 delete the test file", async () => {
    const { transaction } = await client.coordination.deleteObject({ account: p, blobName: name });
    await aptos.waitForTransaction({ transactionHash: transaction.hash });
    return { deleted: true };
  });
}

report.finishedAt = new Date().toISOString();
await fsp.writeFile(path.join(HERE, "probe7-report.json"), JSON.stringify(json(report), null, 2));
const failed = Object.entries(report.steps).filter(([, v]) => !v.ok).map(([k]) => k);
say(`\nDone. ${Object.keys(report.steps).length - failed.length} steps ok, ${failed.length} failed${failed.length ? ": " + failed.join(", ") : ""}.`);
say(`Report: ${path.join(HERE, "probe7-report.json")} (no keys or secrets in it). Paste it back to Claude.`);
process.exit(0);
