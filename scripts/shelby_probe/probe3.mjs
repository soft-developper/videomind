// VideoMind, Part 16 probe, third run: what Part 16d (public videos on
// Shelby) still needs to know.
//
//   cd scripts/shelby_probe
//   npm install                     # once
//   export SHELBY_API_KEY=...       # the same value as NEXT_PUBLIC_APTOS_API_KEY
//   node probe3.mjs                 # one 50 MB file
//   PROBE_SIZE_MB=300 node probe3.mjs
//
// On a Render shell (to measure from VideoMind's servers), the key is
// already there as APTOS_API_KEY, so: cd scripts/shelby_probe && npm install
// && node probe3.mjs
//
// It reuses the TEST accounts in probe-accounts.json (made by probe.mjs, or
// made now if missing) and writes probe3-report.json, with no keys in it.
//
// What it checks:
//   0. network: can this machine reach the Shelby RPC and the fullnode
//   1. the payment epoch: every view function of Shelby's contract with
//      "epoch" in its name that takes no arguments is called, and the epoch
//      stamped on a new upload is compared with the uploads of earlier
//      probe runs (probe-report.json) and the time between them
//   2. one upload of PROBE_SIZE_MB (default 50) by the streaming path
//   3. reading it the way a player or FFmpeg does: the whole file in pieces
//      of PROBE_RANGE_MB (default 2), each piece retried up to 3 times and
//      checked byte for byte; then 10 random 1 MB pieces; then the whole
//      file in one request, to see if the server still cuts long reads
//   4. deleting it
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { Account, Ed25519PrivateKey, Network, AccountAddress } from "@aptos-labs/ts-sdk";
import {
  ShelbyNodeClient, ShelbyBlobClient, SHELBYUSD_FA_METADATA_ADDRESS,
  generateCommitments, createDefaultErasureCodingProvider, requiredAckCount, isBlobNotFoundError,
} from "@shelby-protocol/sdk/node";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API_KEY = process.env.SHELBY_API_KEY || process.env.NEXT_PUBLIC_APTOS_API_KEY || process.env.APTOS_API_KEY;
const SIZE_MB = Math.max(1, Number(process.env.PROBE_SIZE_MB) || 50);
const RANGE_MB = Math.max(0.25, Number(process.env.PROBE_RANGE_MB) || 2);
const CONCURRENCY = Math.max(1, Number(process.env.PROBE_CONCURRENCY ?? 1) || 1);
const RPC_URL = "https://shelby.shelbynet.shelby.xyz/shelby";
const META = SHELBYUSD_FA_METADATA_ADDRESS;

if (!API_KEY) {
  console.error("Set SHELBY_API_KEY first (the same value as NEXT_PUBLIC_APTOS_API_KEY on Vercel). Do not paste it anywhere else.");
  process.exit(1);
}

const client = new ShelbyNodeClient({ network: Network.SHELBYNET, apiKey: API_KEY, locationHint: "shelbynet-1" });
const aptos = client.aptos;
const report = { probeVersion: 3, startedAt: new Date().toISOString(), host: process.env.RENDER ? "render" : "this machine", sizeMB: SIZE_MB, rangeMB: RANGE_MB, steps: {} };
const say = (s) => console.log(s);
const json = (v) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));
const mbps = (bytes, ms) => (ms > 0 ? +((bytes / 1048576) / (ms / 1000)).toFixed(2) : null);
function errText(e) {
  const parts = [];
  for (let x = e, d = 0; x && d < 6; x = x.cause, d++) parts.push(`${x.message ?? String(x)}${x.code ? ` [${x.code}]` : ""}`);
  return parts.join(" <- ");
}
async function retry(times, fn) {
  let last;
  for (let i = 0; i < times; i++) {
    try { return { value: await fn(), attempts: i + 1 }; }
    catch (e) { last = e; await new Promise((r) => setTimeout(r, 1500 * (i + 1))); }
  }
  throw last;
}
async function step(name, fn) {
  say(`\n== ${name}`);
  const t0 = Date.now();
  try {
    const out = await fn();
    report.steps[name] = { ok: true, ms: Date.now() - t0, ...json(out ?? {}) };
    say(`   ok (${Date.now() - t0} ms)`);
    return out;
  } catch (e) {
    report.steps[name] = { ok: false, ms: Date.now() - t0, error: errText(e).slice(0, 2000) };
    say(`   FAILED: ${errText(e).slice(0, 600)}`);
    return undefined;
  }
}

// ---- the test account ---------------------------------------------------------
function loadPayer() {
  const file = path.join(HERE, "probe-accounts.json");
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(file, "utf8")); } catch { /* first run */ }
  const make = (k) => (saved[k] ? Account.fromPrivateKey({ privateKey: new Ed25519PrivateKey(saved[k]) }) : Account.generate());
  const payer = make("payer"), treasury = make("treasury");
  fs.writeFileSync(file, JSON.stringify({ note: "shelbynet TEST accounts made by the probe. No value.", payer: payer.privateKey.toString(), treasury: treasury.privateKey.toString() }, null, 2), { mode: 0o600 });
  return payer;
}
const view = (fn, ty, args) => aptos.view({ payload: { function: fn, typeArguments: ty, functionArguments: args } }).then((r) => r[0]).catch(() => 0);
async function balances(addr) {
  const [apt, susd] = await Promise.all([view("0x1::coin::balance", ["0x1::aptos_coin::AptosCoin"], [addr]), view("0x1::primary_fungible_store::balance", ["0x1::fungible_asset::Metadata"], [addr, META])]);
  return { apt: Number(apt), shelbyUsd: Number(susd) };
}

async function makeFile(mb) {
  const dir = path.join(HERE, "probe-data");
  await fsp.mkdir(dir, { recursive: true });
  const file = path.join(dir, `probe3-${mb}mb.bin`);
  const hash = crypto.createHash("sha256");
  const out = fs.createWriteStream(file);
  const chunk = 8 * 1048576;
  for (let left = mb * 1048576; left > 0; left -= chunk) {
    const b = crypto.randomBytes(Math.min(chunk, left));
    hash.update(b);
    if (!out.write(b)) await new Promise((r) => out.once("drain", r));
  }
  await new Promise((r) => out.end(r));
  return { file, size: mb * 1048576, sha256: hash.digest("hex") };
}
const webStream = (file) => Readable.toWeb(fs.createReadStream(file, { highWaterMark: 1048576 }));
async function readRange(blobName, account, start, end) {
  const part = await client.download({ account, blobName, range: { start, end } });
  const bufs = []; for await (const b of part.readable) bufs.push(Buffer.from(b));
  return Buffer.concat(bufs);
}
async function fileBytes(file, start, length) {
  const buf = Buffer.alloc(length);
  const fh = await fsp.open(file, "r"); await fh.read(buf, 0, length, start); await fh.close();
  return buf;
}

// ---- run --------------------------------------------------------------------------
const payer = loadPayer();
say(`Test account (shelbynet, no value): ${payer.accountAddress.toString()}`);
say(`Running on: ${report.host}`);

await step("0 network", async () => {
  const ping = async (label, url) => {
    const t0 = Date.now();
    try { const r = await fetch(url, { headers: { Authorization: `Bearer ${API_KEY}` }, signal: AbortSignal.timeout(20000) }); await r.arrayBuffer(); return { label, ok: true, status: r.status, ms: Date.now() - t0 }; }
    catch (e) { return { label, ok: false, ms: Date.now() - t0, error: errText(e) }; }
  };
  const out = [await ping("shelby rpc", RPC_URL), await ping("shelby rpc", RPC_URL), await ping("aptos fullnode", "https://api.shelbynet.shelby.xyz/v1")];
  for (const o of out) say(`   ${o.label}: ${o.ok ? `answered ${o.status} in ${o.ms} ms` : `NO ANSWER after ${o.ms} ms: ${o.error}`}`);
  const b = await balances(payer.accountAddress);
  if (b.shelbyUsd < 1_000_000) await client.fundAccountWithShelbyUSD({ address: payer.accountAddress, amount: 100_000_000 }).catch((e) => say(`   faucet: ${errText(e)}`));
  if (b.apt < 10_000_000) await client.fundAccountWithAPT({ address: payer.accountAddress, amount: 100_000_000 }).catch((e) => say(`   faucet: ${errText(e)}`));
  return { pings: out, balances: await balances(payer.accountAddress) };
});

// 1. The epoch, from Shelby's own contract.
const epochViews = await step("1 payment epoch: Shelby's contract", async () => {
  const deployer = client.coordination.deployer.toString();
  const modules = await aptos.getAccountModules({ accountAddress: deployer });
  const found = [];
  for (const m of modules) {
    const abi = m.abi; if (!abi) continue;
    for (const f of abi.exposed_functions ?? []) {
      if (!f.is_view || !/epoch/i.test(f.name)) continue;
      const fn = `${abi.address}::${abi.name}::${f.name}`;
      const entry = { fn, params: f.params, returns: f.return, value: null, error: null };
      if (f.params.length === 0 && f.generic_type_params.length === 0) {
        try { entry.value = await aptos.view({ payload: { function: fn, typeArguments: [], functionArguments: [] } }); }
        catch (e) { entry.error = errText(e).slice(0, 200); }
      }
      found.push(entry);
    }
  }
  for (const f of found) say(`   ${f.fn}(${f.params.join(", ")}) -> ${f.value != null ? JSON.stringify(json(f.value)) : f.error ? `error: ${f.error}` : "needs arguments, not called"}`);
  if (!found.length) say("   no view function with \"epoch\" in its name");
  return { deployer, views: found };
});

// 2. One upload, and the epoch stamped on it.
let up;
await step(`2 upload ${SIZE_MB} MB`, async () => {
  const f = await makeFile(SIZE_MB);
  const blobName = `probe/${Date.now()}-${SIZE_MB}mb.bin`;
  const t = {}; const pieces = [];
  let t0 = Date.now();
  const provider = await createDefaultErasureCodingProvider();
  const commitments = await generateCommitments(provider, webStream(f.file));
  t.commitmentsMs = Date.now() - t0; t0 = Date.now();
  const { transaction: reg } = await client.coordination.registerBlob({ account: payer, blobName, blobMerkleRoot: commitments.blob_merkle_root, size: f.size, config: provider.config });
  const regTx = await aptos.waitForTransaction({ transactionHash: reg.hash });
  const uid = ShelbyBlobClient.registeredBlobUid(regTx.events, client.coordination.deployer);
  t.registerMs = Date.now() - t0; t0 = Date.now();
  const { spAcks } = await client.rpc.putBlobChunksets({
    account: payer, uid, blobData: webStream(f.file), commitments, totalBytes: f.size, chunksetConcurrency: CONCURRENCY,
    onProgress: (p) => { pieces.push({ idx: p.chunksetIdx, atMs: Date.now() - t0 }); process.stdout.write(`   sent ${Math.round((p.uploadedBytes / p.totalBytes) * 100)}% (${((Date.now() - t0) / 1000).toFixed(0)} s)\r`); },
  });
  t.sendMs = Date.now() - t0;
  const need = requiredAckCount(provider.config.erasure_n);
  if (spAcks.length < need) throw new Error(`only ${spAcks.length} storage provider acks, need ${need}`);
  t0 = Date.now();
  const { transaction: commit } = await client.coordination.commitObject({ account: payer, uid, blobName, overwrite: true, storageProviderAcks: spAcks });
  await aptos.waitForTransaction({ transactionHash: commit.hash });
  t.commitMs = Date.now() - t0;
  const meta = await client.coordination.getBlobMetadata(uid).catch(() => undefined);
  up = { ...f, blobName, uid, at: Date.now(), payment: meta?.payment ?? null };
  say(`   ${SIZE_MB} MB sent at ${mbps(f.size, t.sendMs)} MB/s; epoch stamped on it: ${meta?.payment?.creationPaymentEpoch ?? "?"}, paid for ${meta?.payment?.numPaymentEpochs ?? "?"} epochs`);
  return { uid, timings: t, sendMBps: mbps(f.size, t.sendMs), chunksets: pieces, payment: meta?.payment ?? null };
});

// 1b. The epoch, from uploads at known times.
await step("1b payment epoch: earlier uploads", async () => {
  const points = [];
  if (up?.payment) points.push({ at: up.at, epoch: up.payment.creationPaymentEpoch, from: "this run" });
  for (const name of ["probe-report.json", "probe3-report.json"]) {
    let r; try { r = JSON.parse(fs.readFileSync(path.join(HERE, name), "utf8")); } catch { continue; }
    // Steps ran one after another, so a step ended at the start time plus the steps before it.
    let at = Date.parse(r.startedAt);
    for (const [k, s] of Object.entries(r.steps ?? {})) {
      at += s?.ms ?? 0;
      if (s?.payment?.creationPaymentEpoch == null) continue;
      points.push({ at, epoch: Number(s.payment.creationPaymentEpoch), from: `${name}: ${k}` });
    }
  }
  points.sort((a, b) => a.at - b.at);
  for (const p of points) say(`   ${new Date(p.at).toISOString()}  epoch ${p.epoch}  (${p.from})`);
  let estimate = null;
  const first = points[0], last = points[points.length - 1];
  if (points.length >= 2 && last.epoch > first.epoch) {
    const hours = (last.at - first.at) / 3600_000 / (last.epoch - first.epoch);
    estimate = { hoursPerEpochAtMost: +hours.toFixed(2), note: "Epochs passed between the first and last upload; one epoch is at most this long." };
    say(`   ${last.epoch - first.epoch} epochs in ${((last.at - first.at) / 3600_000).toFixed(1)} hours: one epoch is about ${hours.toFixed(1)} hours or less`);
  } else if (points.length >= 2) {
    say(`   the epoch did not change in ${((last.at - first.at) / 3600_000).toFixed(1)} hours: one epoch is longer than that`);
    estimate = { hoursPerEpochAtLeast: +((last.at - first.at) / 3600_000).toFixed(2) };
  } else say("   no earlier upload to compare with");
  return { points, estimate };
});

// 3. Reading it the way a player or FFmpeg does.
if (up) {
  await step(`3a read the whole file in ${RANGE_MB} MB pieces`, async () => {
    const piece = Math.floor(RANGE_MB * 1048576);
    const hash = crypto.createHash("sha256");
    let retries = 0, slowest = 0, firstMs = null; const t0 = Date.now();
    for (let start = 0; start < up.size; start += piece) {
      const end = Math.min(up.size, start + piece) - 1;
      const r0 = Date.now();
      const { value, attempts } = await retry(3, () => readRange(up.blobName, payer.accountAddress, start, end));
      const ms = Date.now() - r0; slowest = Math.max(slowest, ms); if (firstMs === null) firstMs = ms;
      retries += attempts - 1;
      if (value.length !== end - start + 1) throw new Error(`piece at ${start} came back with ${value.length} bytes, expected ${end - start + 1}`);
      hash.update(value);
      process.stdout.write(`   read ${Math.round(((end + 1) / up.size) * 100)}%\r`);
    }
    const ms = Date.now() - t0;
    const matches = hash.digest("hex") === up.sha256;
    say(`   ${SIZE_MB} MB in ${(ms / 1000).toFixed(1)} s (${mbps(up.size, ms)} MB/s), first piece ${firstMs} ms, slowest ${slowest} ms, ${retries} retries, checksum ${matches ? "matches" : "DIFFERS"}`);
    if (!matches) throw new Error("the pieces put together differ from the file");
    return { ms, MBps: mbps(up.size, ms), firstPieceMs: firstMs, slowestPieceMs: slowest, retries, checksumMatches: matches };
  });

  await step("3b ten random 1 MB pieces (seeking)", async () => {
    const out = [];
    for (let i = 0; i < 10; i++) {
      const start = Math.floor(Math.random() * Math.max(1, up.size - 1048576));
      const end = Math.min(up.size, start + 1048576) - 1;
      const r0 = Date.now();
      const { value, attempts } = await retry(3, () => readRange(up.blobName, payer.accountAddress, start, end));
      const ok = value.equals(await fileBytes(up.file, start, end - start + 1));
      out.push({ start, ms: Date.now() - r0, attempts, ok });
    }
    const bad = out.filter((x) => !x.ok).length;
    const avg = Math.round(out.reduce((a, x) => a + x.ms, 0) / out.length);
    say(`   average ${avg} ms a piece, slowest ${Math.max(...out.map((x) => x.ms))} ms, ${bad ? `${bad} WRONG` : "all correct"}`);
    if (bad) throw new Error(`${bad} pieces came back wrong`);
    return { pieces: out, averageMs: avg };
  });

  await step("3c the whole file in one request", async () => {
    const t0 = Date.now(); let got = 0; let first = null;
    const hash = crypto.createHash("sha256");
    const blob = await client.download({ account: payer.accountAddress, blobName: up.blobName });
    for await (const part of blob.readable) { if (first === null) first = Date.now() - t0; hash.update(part); got += part.length; }
    const ms = Date.now() - t0;
    const matches = got === up.size && hash.digest("hex") === up.sha256;
    say(`   ${(got / 1048576).toFixed(1)} MB in ${(ms / 1000).toFixed(1)} s (${mbps(got, ms)} MB/s), checksum ${matches ? "matches" : "DIFFERS"}`);
    return { ms, bytes: got, MBps: mbps(got, ms), firstByteMs: first, checksumMatches: matches };
  });

  await step("4 delete", async () => {
    const { transaction } = await client.coordination.deleteObject({ account: payer, blobName: up.blobName });
    await aptos.waitForTransaction({ transactionHash: transaction.hash });
    let gone;
    try { const b = await client.download({ account: payer.accountAddress, blobName: up.blobName }); for await (const _ of b.readable) { /* drain */ } gone = "STILL READABLE"; }
    catch (e) { const t = errText(e); gone = isBlobNotFoundError(t) || /404/.test(t) ? "gone (not found)" : `unknown: ${t.slice(0, 200)}`; }
    say(`   after delete: ${gone}`);
    return { afterDelete: gone };
  });
}

report.finishedAt = new Date().toISOString();
await fsp.writeFile(path.join(HERE, "probe3-report.json"), JSON.stringify(json(report), null, 2));
await fsp.rm(path.join(HERE, "probe-data"), { recursive: true, force: true });
const failed = Object.entries(report.steps).filter(([, v]) => !v.ok).map(([k]) => k);
say(`\nDone. ${Object.keys(report.steps).length - failed.length} steps ok, ${failed.length} failed${failed.length ? ": " + failed.join(", ") : ""}.`);
say(`Report: ${path.join(HERE, "probe3-report.json")} (no private keys in it). Paste it back to Claude.`);
process.exit(0);
