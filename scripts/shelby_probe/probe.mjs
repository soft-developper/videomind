// VideoMind, Part 16 probe: what shelbynet can do for VideoMind today.
//
// Run on your own machine (the Claude sandbox cannot reach shelbynet):
//
//   cd scripts/shelby_probe
//   npm install
//   export SHELBY_API_KEY=...        # your Aptos/Geomi key, the same value as
//                                    # NEXT_PUBLIC_APTOS_API_KEY on Vercel
//   node probe.mjs                   # sizes 1, 10 and 50 MB, one chunkset at a time
//   PROBE_SIZES_MB=1,50,300 PROBE_CONCURRENCY=4 node probe.mjs
//
// It uses two throwaway TEST accounts that it creates and funds from the
// shelbynet faucet. It never touches your wallet or VideoMind's data. Their
// keys are kept in probe-accounts.json next to this file (ignored by git) so
// a second run reuses them.
//
// What it checks, and writes to probe-report.json:
//   0. network: can this machine reach the Shelby RPC and the Aptos fullnode, and how fast
//   1. ShelbyUSD: decimals, faucet funding, balances
//   2. a ShelbyUSD transfer, then the check a top up would get: read the
//      transaction by hash and confirm the Deposit into the receiver's store
//   3. uploads of growing size through the SDK's streaming path (no whole
//      file in memory): time, memory, APT gas, ShelbyUSD storage cost, paid period
//   4. reads: whole file (time to first byte, speed, checksum) and ranges
//   5. deletion: cost, then whether the name and the bytes are still readable
//
// Built from @shelby-protocol/sdk 0.9.2 (the version VideoMind uses) and
// @aptos-labs/ts-sdk 5.2.1. Nothing here needs gas sponsorship.
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
const API_KEY = process.env.SHELBY_API_KEY || process.env.NEXT_PUBLIC_APTOS_API_KEY;
const SIZES_MB = (process.env.PROBE_SIZES_MB ?? "1,10,50").split(",").map((s) => Number(s.trim())).filter((n) => n > 0);
const LOCATION = "shelbynet-1";
const CONCURRENCY = Math.max(1, Number(process.env.PROBE_CONCURRENCY ?? 1) || 1);
const RPC_URL = "https://shelby.shelbynet.shelby.xyz/shelby";
const APT = "0x1::aptos_coin::AptosCoin";
const META = SHELBYUSD_FA_METADATA_ADDRESS;
const FA_DEPOSIT = "0x1::fungible_asset::Deposit";

if (!API_KEY) {
  console.error("Set SHELBY_API_KEY first (the same value as NEXT_PUBLIC_APTOS_API_KEY on Vercel). Do not paste it anywhere else.");
  process.exit(1);
}

const client = new ShelbyNodeClient({ network: Network.SHELBYNET, apiKey: API_KEY, locationHint: LOCATION });
const aptos = client.aptos;
const report = { probeVersion: 2, startedAt: new Date().toISOString(), network: "shelbynet", sdk: "0.9.2", concurrency: CONCURRENCY, steps: {} };
const say = (s) => console.log(s);
const json = (v) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));
const norm = (a) => AccountAddress.from(a).toStringLong();
/** The message and every cause under it: "fetch failed" alone hides the real reason (ECONNRESET, a timeout, DNS). */
function errText(e) {
  const parts = [];
  for (let x = e, d = 0; x && d < 6; x = x.cause, d++) {
    const code = x.code ? ` [${x.code}]` : "";
    parts.push(`${x.message ?? String(x)}${code}`);
  }
  return parts.join(" <- ");
}
async function retry(times, fn) {
  let last;
  for (let i = 0; i < times; i++) {
    try { return { value: await fn(), attempts: i + 1, errors: [] }; }
    catch (e) { last = e; await new Promise((r) => setTimeout(r, 2000 * (i + 1))); }
  }
  throw last;
}
const mbps = (bytes, ms) => (ms > 0 ? +((bytes / 1048576) / (ms / 1000)).toFixed(2) : null);

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

// ---- accounts ---------------------------------------------------------------
function loadAccounts() {
  const file = path.join(HERE, "probe-accounts.json");
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(file, "utf8")); } catch { /* first run */ }
  const make = (k) => (saved[k] ? Account.fromPrivateKey({ privateKey: new Ed25519PrivateKey(saved[k]) }) : Account.generate());
  const payer = make("payer"), treasury = make("treasury");
  fs.writeFileSync(file, JSON.stringify({ note: "shelbynet TEST accounts made by probe.mjs. No value.", payer: payer.privateKey.toString(), treasury: treasury.privateKey.toString() }, null, 2), { mode: 0o600 });
  return { payer, treasury };
}

async function balances(addr) {
  // Read from the fullnode by view, so the number is the ledger's, never an indexer that lags.
  const view = (fn, ty, args) => aptos.view({ payload: { function: fn, typeArguments: ty, functionArguments: args } }).then((r) => r[0]).catch(() => 0);
  const [apt, susd] = await Promise.all([
    view("0x1::coin::balance", [APT], [addr]),
    view("0x1::primary_fungible_store::balance", ["0x1::fungible_asset::Metadata"], [addr, META]),
  ]);
  return { apt: Number(apt), shelbyUsd: Number(susd) };
}
const gasOf = (tx) => (tx && tx.gas_used ? Number(tx.gas_used) * Number(tx.gas_unit_price) : 0);

// ---- the check a top up would get -------------------------------------------
/**
 * Confirms a committed transaction moved exactly `amount` of the fungible asset
 * `meta` from `sender` into the primary store of `receiver`. This is the check
 * Part 16b would run on a top up, written from the Aptos exchange guide:
 * Deposit events carry the store and amount; the store must hold `meta` and
 * belong to `receiver`.
 */
async function verifyDeposit(tx, { sender, receiver, meta, amount }) {
  const why = [];
  if (tx.type !== "user_transaction") why.push(`not a user transaction (${tx.type})`);
  if (!tx.success) why.push(`did not succeed (${tx.vm_status})`);
  if (tx.sender && norm(tx.sender) !== norm(sender)) why.push("sender is not the signed in wallet");
  const store = (await aptos.view({
    payload: {
      function: "0x1::primary_fungible_store::primary_store_address",
      typeArguments: ["0x1::fungible_asset::Metadata"],
      functionArguments: [receiver, meta],
    },
  }))[0];
  let received = 0n;
  for (const ev of tx.events ?? []) {
    if (ev.type !== FA_DEPOSIT) continue;
    if (norm(ev.data.store) !== norm(store)) continue;
    // The store at that address must hold this asset (FungibleStore.metadata).
    const change = (tx.changes ?? []).find((c) => c.type === "write_resource" && norm(c.address) === norm(store) && c.data?.type === "0x1::fungible_asset::FungibleStore");
    const held = change?.data?.data?.metadata?.inner;
    if (held && norm(held) !== norm(meta)) { why.push("deposit is of a different asset"); continue; }
    received += BigInt(ev.data.amount);
  }
  if (received !== BigInt(amount)) why.push(`receiver got ${received}, expected ${amount}`);
  return { valid: why.length === 0, why, receiverStore: store, received: received.toString() };
}

// ---- files ------------------------------------------------------------------
async function makeFile(mb) {
  const dir = path.join(HERE, "probe-data");
  await fsp.mkdir(dir, { recursive: true });
  const file = path.join(dir, `probe-${mb}mb.bin`);
  const hash = crypto.createHash("sha256");
  const out = fs.createWriteStream(file);
  const chunk = 8 * 1048576;
  for (let left = mb * 1048576; left > 0; left -= chunk) {
    const b = crypto.randomBytes(Math.min(chunk, left));   // random bytes, like video, do not compress
    hash.update(b);
    if (!out.write(b)) await new Promise((r) => out.once("drain", r));
  }
  await new Promise((r) => out.end(r));
  return { file, size: mb * 1048576, sha256: hash.digest("hex") };
}
const webStream = (file, opts = {}) => Readable.toWeb(fs.createReadStream(file, { highWaterMark: 1048576, ...opts }));

let peakRss = 0;
const rssTimer = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 200);
rssTimer.unref();

// ---- run ----------------------------------------------------------------------
const { payer, treasury } = loadAccounts();
report.accounts = { payer: payer.accountAddress.toString(), treasury: treasury.accountAddress.toString() };
say(`Test accounts (shelbynet, no value):\n   payer    ${report.accounts.payer}\n   treasury ${report.accounts.treasury}`);

await step("0 network from this machine", async () => {
  const ping = async (label, url, init) => {
    const t0 = Date.now();
    try {
      const r = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
      await r.arrayBuffer();
      return { label, ok: true, status: r.status, ms: Date.now() - t0 };
    } catch (e) { return { label, ok: false, ms: Date.now() - t0, error: errText(e) }; }
  };
  const out = [];
  for (let i = 0; i < 3; i++) out.push(await ping("shelby rpc", RPC_URL, { headers: { Authorization: `Bearer ${API_KEY}` } }));
  out.push(await ping("aptos fullnode", "https://api.shelbynet.shelby.xyz/v1", { headers: { Authorization: `Bearer ${API_KEY}` } }));
  for (const o of out) say(`   ${o.label}: ${o.ok ? `answered ${o.status} in ${o.ms} ms` : `NO ANSWER after ${o.ms} ms: ${o.error}`}`);
  return { pings: out };
});

const token = await step("1 ShelbyUSD and funding", async () => {
  const decimals = Number((await aptos.view({
    payload: { function: "0x1::fungible_asset::decimals", typeArguments: ["0x1::fungible_asset::Metadata"], functionArguments: [META] },
  }))[0]);
  const symbol = (await aptos.view({
    payload: { function: "0x1::fungible_asset::symbol", typeArguments: ["0x1::fungible_asset::Metadata"], functionArguments: [META] },
  }))[0];
  const before = await balances(payer.accountAddress);
  const funded = {};
  if (before.apt < 50_000_000) funded.apt = await client.fundAccountWithAPT({ address: payer.accountAddress, amount: 100_000_000 });
  if (before.shelbyUsd < 10 ** decimals) funded.shelbyUsd = await client.fundAccountWithShelbyUSD({ address: payer.accountAddress, amount: 100_000_000 });
  if ((await balances(treasury.accountAddress)).apt < 10_000_000) funded.treasuryApt = await client.fundAccountWithAPT({ address: treasury.accountAddress, amount: 20_000_000 });
  const after = await balances(payer.accountAddress);
  say(`   ShelbyUSD: symbol ${symbol}, ${decimals} decimals, metadata ${META}`);
  say(`   payer has ${after.apt / 1e8} APT and ${after.shelbyUsd / 10 ** decimals} ShelbyUSD`);
  return { metadata: META, symbol, decimals, before, after, faucetGave: { apt: after.apt - before.apt, shelbyUsd: after.shelbyUsd - before.shelbyUsd }, faucetTransactions: funded };
});
const decimals = token?.decimals ?? 6;

await step("2 ShelbyUSD transfer and the top up check", async () => {
  // 0.01 ShelbyUSD: the faucet gives 0.1 per call, so 1 ShelbyUSD was more than the payer had.
  const amount = 10 ** Math.max(0, decimals - 2);
  const have = (await balances(payer.accountAddress)).shelbyUsd;
  if (have < amount) throw new Error(`payer has ${have / 10 ** decimals} ShelbyUSD, needs ${amount / 10 ** decimals}`);
  const transaction = await aptos.transferFungibleAsset({ sender: payer, fungibleAssetMetadataAddress: META, recipient: treasury.accountAddress, amount });
  const pending = await aptos.signAndSubmitTransaction({ signer: payer, transaction });
  await aptos.waitForTransaction({ transactionHash: pending.hash });
  const tx = await aptos.getTransactionByHash({ transactionHash: pending.hash });
  const good = await verifyDeposit(tx, { sender: payer.accountAddress, receiver: treasury.accountAddress, meta: META, amount });
  // The same check must refuse a wrong receiver, a wrong amount and a wrong sender.
  const wrongReceiver = await verifyDeposit(tx, { sender: payer.accountAddress, receiver: payer.accountAddress, meta: META, amount });
  const wrongAmount = await verifyDeposit(tx, { sender: payer.accountAddress, receiver: treasury.accountAddress, meta: META, amount: amount * 2 });
  const wrongSender = await verifyDeposit(tx, { sender: treasury.accountAddress, receiver: treasury.accountAddress, meta: META, amount });
  say(`   sent ${amount / 10 ** decimals} ShelbyUSD, gas ${gasOf(tx) / 1e8} APT`);
  say(`   transfer ${pending.hash}: check ${good.valid ? "PASSES" : "FAILS " + good.why.join("; ")}`);
  say(`   refuses wrong receiver: ${!wrongReceiver.valid}, wrong amount: ${!wrongAmount.valid}, wrong sender: ${!wrongSender.valid}`);
  return { hash: pending.hash, gasOctas: gasOf(tx), check: good, refuses: { wrongReceiver: !wrongReceiver.valid, wrongAmount: !wrongAmount.valid, wrongSender: !wrongSender.valid } };
});

const uploaded = [];
for (const mb of SIZES_MB) {
  await step(`3 upload ${mb} MB (streaming)`, async () => {
    const f = await makeFile(mb);
    const blobName = `probe/${Date.now()}-${mb}mb.bin`;
    peakRss = process.memoryUsage().rss;
    const before = await balances(payer.accountAddress);
    const t = {};
    const chunksetTimes = [];
    let t0 = Date.now();
    const provider = await createDefaultErasureCodingProvider();
    const commitments = await generateCommitments(provider, webStream(f.file));
    t.commitmentsMs = Date.now() - t0;

    t0 = Date.now();
    const { transaction: reg } = await client.coordination.registerBlob({
      account: payer, blobName, blobMerkleRoot: commitments.blob_merkle_root, size: f.size, config: provider.config,
    });
    const regTx = await aptos.waitForTransaction({ transactionHash: reg.hash });
    const uid = ShelbyBlobClient.registeredBlobUid(regTx.events, client.coordination.deployer);
    t.registerMs = Date.now() - t0;

    t0 = Date.now();
    const { spAcks } = await client.rpc.putBlobChunksets({
      account: payer, uid, blobData: webStream(f.file), commitments, totalBytes: f.size, chunksetConcurrency: CONCURRENCY,
      onProgress: (p) => {
        chunksetTimes.push({ idx: p.chunksetIdx, atMs: Date.now() - t0, uploadedBytes: p.uploadedBytes });
        process.stdout.write(`   sent ${Math.round((p.uploadedBytes / p.totalBytes) * 100)}% (${((Date.now() - t0) / 1000).toFixed(0)} s)\r`);
      },
    });
    t.sendMs = Date.now() - t0;
    const need = requiredAckCount(provider.config.erasure_n);
    if (spAcks.length < need) throw new Error(`only ${spAcks.length} storage provider acks, need ${need}`);

    t0 = Date.now();
    const { transaction: commit } = await client.coordination.commitObject({ account: payer, uid, blobName, overwrite: true, storageProviderAcks: spAcks });
    const commitTx = await aptos.waitForTransaction({ transactionHash: commit.hash });
    t.commitMs = Date.now() - t0;

    const after = await balances(payer.accountAddress);
    const meta = await client.coordination.getBlobMetadata(uid).catch(() => undefined);
    const total = t.commitmentsMs + t.registerMs + t.sendMs + t.commitMs;
    uploaded.push({ mb, blobName, uid, ...f });
    say(`   ${mb} MB in ${(total / 1000).toFixed(1)} s (sending ${mbps(f.size, t.sendMs)} MB/s), peak memory ${Math.round(peakRss / 1048576)} MB`);
    say(`   gas: register ${gasOf(regTx) / 1e8} APT, commit ${gasOf(commitTx) / 1e8} APT`);
    say(`   cost: ${(before.apt - after.apt) / 1e8} APT, ${(before.shelbyUsd - after.shelbyUsd) / 10 ** decimals} ShelbyUSD`);
    return {
      sizeBytes: f.size, uid, blobName, timings: t, totalMs: total, sendMBps: mbps(f.size, t.sendMs),
      peakRssMB: Math.round(peakRss / 1048576),
      aptSpentOctas: before.apt - after.apt, shelbyUsdSpent: before.shelbyUsd - after.shelbyUsd,
      gasOctas: { register: gasOf(regTx), commit: gasOf(commitTx) },
      acks: spAcks.length, acksNeeded: need, chunksetTimes, payment: meta?.payment ?? null, state: meta?.state ?? null,
    };
  });
}

for (const u of uploaded) {
  await step(`4 read ${u.mb} MB`, async () => {
    const before = await balances(payer.accountAddress);
    let t0 = Date.now(), first = null, got = 0;
    // A read is retried 3 times; the report says how many tries it took.
    const whole = await retry(3, async () => {
      t0 = Date.now(); first = null; got = 0;
      const h = crypto.createHash("sha256");
      const blob = await client.download({ account: payer.accountAddress, blobName: u.blobName });
      for await (const part of blob.readable) {
        if (first === null) first = Date.now() - t0;
        h.update(part); got += part.length;
      }
      return h;
    });
    const wholeMs = Date.now() - t0;
    const matches = whole.value.digest("hex") === u.sha256;
    // Ranges: the start, 1 MB in the middle, and the end, as a player or FFmpeg asks.
    const ranges = [];
    const mid = Math.max(0, Math.floor(u.size / 2) - 524288);
    for (const [start, end] of [[0, Math.min(u.size, 65536) - 1], [mid, Math.min(u.size, mid + 1048576) - 1], [Math.max(0, u.size - 65536), u.size - 1]]) {
      const r0 = Date.now();
      const { value: bytes } = await retry(3, async () => {
        const part = await client.download({ account: payer.accountAddress, blobName: u.blobName, range: { start, end } });
        const bufs = []; for await (const b of part.readable) bufs.push(Buffer.from(b));
        return Buffer.concat(bufs);
      });
      const expect = Buffer.alloc(end - start + 1);
      const fh = await fsp.open(u.file, "r"); await fh.read(expect, 0, expect.length, start); await fh.close();
      ranges.push({ start, end, ms: Date.now() - r0, bytes: bytes.length, matches: bytes.equals(expect) });
    }
    const after = await balances(payer.accountAddress);
    say(`   whole: first byte ${first} ms, ${mbps(got, wholeMs)} MB/s, checksum ${matches ? "matches" : "DIFFERS"}`);
    say(`   ranges: ${ranges.map((r) => `${r.ms} ms ${r.matches ? "ok" : "WRONG"}`).join(", ")}`);
    say(`   read cost charged to the reader: ${(before.apt - after.apt) / 1e8} APT, ${(before.shelbyUsd - after.shelbyUsd) / 10 ** decimals} ShelbyUSD (reads sent without a micropayment)`);
    return { wholeAttempts: whole.attempts, firstByteMs: first, wholeMs, wholeMBps: mbps(got, wholeMs), bytes: got, checksumMatches: matches, ranges,
      readerCost: { aptOctas: before.apt - after.apt, shelbyUsd: before.shelbyUsd - after.shelbyUsd }, micropaymentSent: false };
  });
}

if (uploaded.length) {
  const u = uploaded[0];
  await step(`5 delete ${u.mb} MB`, async () => {
    const before = await balances(payer.accountAddress);
    const { transaction } = await client.coordination.deleteObject({ account: payer, blobName: u.blobName });
    const tx = await aptos.waitForTransaction({ transactionHash: transaction.hash });
    const after = await balances(payer.accountAddress);
    const tryRead = async (fn) => {
      try { const b = await fn(); let n = 0; for await (const p of b.readable) n += p.length; return { readable: true, bytes: n }; }
      catch (e) { return { readable: false, notFound: isBlobNotFoundError(errText(e)), error: errText(e).slice(0, 300) }; }
    };
    const byName = await tryRead(() => client.download({ account: payer.accountAddress, blobName: u.blobName }));
    const byUid = await tryRead(() => client.rpc.getBlobByUid({ account: payer.accountAddress, uid: u.uid }));
    const metaAfter = await client.coordination.getBlobMetadata(u.uid).catch((e) => ({ error: String(e?.message ?? e) }));
    say(`   delete cost ${(before.apt - after.apt) / 1e8} APT; refund of ShelbyUSD: ${(after.shelbyUsd - before.shelbyUsd) / 10 ** decimals}`);
    // Gone only when the node says not found. A network error proves nothing.
    const state = (r) => (r.readable ? "STILL READABLE" : r.notFound ? "gone (not found)" : `UNKNOWN, the read itself failed: ${r.error}`);
    say(`   after delete, by name: ${state(byName)}`);
    say(`   after delete, by uid: ${state(byUid)}`);
    return { gasOctas: gasOf(tx), aptSpentOctas: before.apt - after.apt, shelbyUsdRefund: after.shelbyUsd - before.shelbyUsd, byName, byUid, metadataAfter: metaAfter ?? null };
  });
}

report.finishedAt = new Date().toISOString();
report.encryption = "Not tested in this probe. The SDK has encryption helpers (core/encryption); an end to end test is a second probe.";
await fsp.writeFile(path.join(HERE, "probe-report.json"), JSON.stringify(json(report), null, 2));
await fsp.rm(path.join(HERE, "probe-data"), { recursive: true, force: true });
clearInterval(rssTimer);
const failed = Object.entries(report.steps).filter(([, v]) => !v.ok).map(([k]) => k);
say(`\nDone. ${Object.keys(report.steps).length - failed.length} steps ok, ${failed.length} failed${failed.length ? ": " + failed.join(", ") : ""}.`);
say(`Report: ${path.join(HERE, "probe-report.json")} (no private keys in it). Paste it back to Claude.`);
process.exit(0);
