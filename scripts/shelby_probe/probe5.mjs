// VideoMind, Part 16 probe, fifth run: can a PRIVATE video live on Shelby?
//
//   cd scripts/shelby_probe
//   export SHELBY_API_KEY=...       # the same value as NEXT_PUBLIC_APTOS_API_KEY
//   node probe5.mjs
//
// Probe 4 showed that anyone with the address can read a Shelby blob. So a
// private video can only live there if the bytes are encrypted first. The
// Shelby SDK (0.9.2) ships an encryption format ("AES_GCM_V1"): a per file key
// sealed under a bucket key, and the file split into frames that line up with
// Shelby's 10 MB chunksets, each frame sealed with AES-GCM. The bucket key is
// derived from an "identity key". Shelby's own key service for that is not
// documented, so this probe uses a secret only VideoMind would hold (here a
// random TEST secret saved next to the test accounts).
//
// It stores one 21 MB TEST file twice:
//   A  marked AES_GCM_V1 on chain (the manual register, put, commit steps)
//   B  with the plain client.upload, marked Unencrypted (bytes still sealed)
// and for each it checks, without any key, on the public address:
//   1  the bytes a stranger gets are not the video (first bytes, whole file)
//   2  with VideoMind's secret the whole file opens and matches exactly
//   3  a seek (1 MB from the middle) opens from a ranged read only
//   4  a wrong secret cannot open it
// plus how fast sealing and opening run on this machine. Then it deletes
// both files. Writes probe5-report.json, with no keys or secrets in it.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { Account, Ed25519PrivateKey, Network } from "@aptos-labs/ts-sdk";
import {
  ShelbyNodeClient, SHELBYUSD_FA_METADATA_ADDRESS, generateCommitments, defaultErasureCodingConfig,
  geometryForEncoding, deriveKek, resolveBlobBinding, createChunksetSealer, createChunksetOpener,
  planChunksetRange, storedSizeForPlaintext,
} from "@shelby-protocol/sdk/node";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API_KEY = process.env.SHELBY_API_KEY || process.env.NEXT_PUBLIC_APTOS_API_KEY || process.env.APTOS_API_KEY;
const OFFLINE = process.argv.includes("--offline"); // crypto only, no network
if (!API_KEY && !OFFLINE) { console.error("Set SHELBY_API_KEY first. Do not paste it anywhere else."); process.exit(1); }
const MB = 1048576;
const SIZE = 21 * MB; // three frames, the last one short
const BUCKET = "videomind-private";
const GATEWAY = "https://api.shelbynet.shelby.xyz/shelby";

const report = { probeVersion: 5, startedAt: new Date().toISOString(), host: process.env.RENDER ? "render" : "this machine", gateway: GATEWAY, steps: {} };
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
const { p, secret } = accounts();
const owner = p.accountAddress.toString();
const kekFor = async (identityKey) => { const b = await resolveBlobBinding({ account: owner, bucket: BUCKET, key: "x" }); return deriveKek({ identityKey, account: b.account, bucketHash: b.bucketHash }); };
const binding = (name) => resolveBlobBinding({ account: owner, bucket: BUCKET, key: name });

/** Seals a whole file into the stored container. */
async function seal(plain, name, kek) {
  const s = await createChunksetSealer({ binding: await binding(name), kek, plaintextSize: plain.length, geometry });
  const out = new Uint8Array(s.storedSize);
  for (let i = 0; i < s.blobFrames; i++) {
    const at = s.plaintextOffset(i);
    out.set(await s.seal(i, plain.subarray(at, at + s.frameLength(i))), s.chunksetOffset(i));
  }
  return out;
}
/** Opens plaintext bytes [start, end) given a reader of stored ranges. */
async function openRange(readStored, plainSize, name, kek, start, end) {
  const plan = planChunksetRange({ plaintextSize: plainSize, start, endExclusive: end, geometry });
  const o = createChunksetOpener({ binding: await binding(name), kek, plaintextSize: plainSize, geometry });
  const stored = await readStored(plan.storedStart, plan.storedEndExclusive);
  const parts = [];
  for (let f = plan.firstFrame; f <= plan.lastFrame; f++) {
    const off = f * geometry.chunksetBytes - plan.storedStart;
    const len = o.frameLength(f) + (geometry.chunksetBytes - geometry.frameBytes);
    parts.push(await o.open(f, stored.subarray(off, off + len)));
  }
  const all = Buffer.concat(parts);
  return all.subarray(plan.trimStart, all.length - plan.trimEnd);
}

const plain = crypto.randomBytes(SIZE);
const kek = await kekFor(secret);
report.format = { frameBytes: geometry.frameBytes, chunksetBytes: geometry.chunksetBytes, plaintextBytes: SIZE, storedBytes: storedSizeForPlaintext(SIZE, geometry) };

await step("0 seal and open on this machine (no network)", async () => {
  const t0 = Date.now(); const stored = await seal(plain, "probe/local", kek); const sealMs = Date.now() - t0;
  const t1 = Date.now(); const back = await openRange(async (a, b) => stored.subarray(a, b), SIZE, "probe/local", kek, 0, SIZE); const openMs = Date.now() - t1;
  const seek = await openRange(async (a, b) => stored.subarray(a, b), SIZE, "probe/local", kek, 10.5 * MB, 11.5 * MB);
  let wrongKeyOpened = true; try { await openRange(async (a, b) => stored.subarray(a, b), SIZE, "probe/local", await kekFor(crypto.randomBytes(32)), 0, 1024); } catch { wrongKeyOpened = false; }
  let otherNameOpened = true; try { await openRange(async (a, b) => stored.subarray(a, b), SIZE, "probe/other", kek, 0, 1024); } catch { otherNameOpened = false; }
  const ok = { roundTrip: sha(back) === sha(plain), seek: sha(seek) === sha(plain.subarray(10.5 * MB, 11.5 * MB)), wrongKeyOpened, otherNameOpened, plaintextVisible: Buffer.from(stored).includes(plain.subarray(5 * MB, 5 * MB + 64)) };
  say(`   sealed 21 MB in ${sealMs} ms (${(21 / (sealMs / 1000)).toFixed(0)} MB/s), opened in ${openMs} ms (${(21 / (openMs / 1000)).toFixed(0)} MB/s)`);
  say(`   round trip ${ok.roundTrip}, seek ${ok.seek}, wrong secret opens: ${wrongKeyOpened}, renamed file opens: ${otherNameOpened}, plaintext visible in stored bytes: ${ok.plaintextVisible}`);
  if (!ok.roundTrip || !ok.seek || wrongKeyOpened || otherNameOpened || ok.plaintextVisible) throw new Error(`local check failed: ${JSON.stringify(ok)}`);
  return { sealMs, openMs, ok };
});
if (OFFLINE) { say("\n--offline: stopping before the network."); process.exit(0); }

const client = new ShelbyNodeClient({ network: Network.SHELBYNET, apiKey: API_KEY, locationHint: "shelbynet-1" });
const aptos = client.aptos;
say(`\nTest account (shelbynet, no value): ${owner}`);
const urlOf = (name) => `${GATEWAY}/v1/blobs/${owner}/${name.split("/").map(encodeURIComponent).join("/")}`;
/** A stranger's read: plain GET, no key. */
async function gatewayRange(name, a, b) {
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 120_000);
  try {
    const r = await fetch(urlOf(name), { headers: { Range: `bytes=${a}-${b - 1}` }, signal: ctl.signal });
    if (r.status !== 206 && r.status !== 200) throw new Error(`gateway answered ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const buf = Buffer.from(await r.arrayBuffer());
    return r.status === 200 ? buf.subarray(a, b) : buf;
  } finally { clearTimeout(timer); }
}
/** Reads stored bytes in 10 MB ranges (one chunkset at a time). */
async function gatewayRead(name, a, b) {
  const parts = []; for (let x = a; x < b; x += geometry.chunksetBytes) parts.push(await gatewayRange(name, x, Math.min(b, x + geometry.chunksetBytes)));
  return Buffer.concat(parts);
}

await step("1 fund the test account", async () => {
  const bal = await aptos.view({ payload: { function: "0x1::primary_fungible_store::balance", typeArguments: ["0x1::fungible_asset::Metadata"], functionArguments: [p.accountAddress, SHELBYUSD_FA_METADATA_ADDRESS] } }).then((r) => Number(r[0])).catch(() => 0);
  if (bal < 1_000_000) await client.fundAccountWithShelbyUSD({ address: p.accountAddress, amount: 100_000_000 }).catch(() => {});
  return { shelbyUsdUnitsBefore: bal };
});

const stamp = Date.now();
const files = { A: `probe/${stamp}-private-flagged.bin`, B: `probe/${stamp}-private-plain.bin` };
const stored = {};

await step("2A store, marked AES_GCM_V1 on chain", async () => {
  const name = files.A; const data = await seal(plain, name, kek);
  const provider = await client.getProvider();
  const commitments = await generateCommitments(provider, data);
  const { transaction: reg } = await client.coordination.registerBlob({ account: p, blobName: name, blobMerkleRoot: commitments.blob_merkle_root, size: data.length, config: provider.config, encryption: "AES_GCM_V1" });
  const regTx = await client.waitForRegistration(reg.hash);
  const uid = client.uidFromRegisterTx(regTx, p.accountAddress, name);
  const { spAcks } = await client.rpc.putBlobChunksets({ account: p, uid, blobData: data, commitments, totalBytes: data.length });
  const { transaction: commit } = await client.coordination.commitObject({ account: p, uid, blobName: name, overwrite: true, storageProviderAcks: spAcks, options: client.orderlessCommitOptions() });
  const done = await aptos.waitForTransaction({ transactionHash: commit.hash });
  if (!done.success) throw new Error(`commit failed: ${done.vm_status}`);
  const meta = await client.coordination.getBlobMetadata(uid);
  stored.A = name;
  say(`   stored ${name}, chain says encryption: ${meta?.content?.encryption}, size ${meta?.content?.blobSize}`);
  return { name, acks: spAcks.length, chainEncryption: meta?.content?.encryption ?? null, chainSize: meta?.content?.blobSize ?? null };
});

await step("2B store with the plain upload (marked Unencrypted, bytes sealed)", async () => {
  const name = files.B; const data = await seal(plain, name, kek);
  await client.upload({ signer: p, blobData: data, blobName: name });
  const meta = await client.coordination.getObjectBlobMetadata({ account: p.accountAddress, name }).catch(() => undefined);
  stored.B = name;
  say(`   stored ${name}`);
  return { name, chainEncryption: meta?.blob?.content?.encryption ?? meta?.content?.encryption ?? null };
});

for (const k of ["A", "B"]) {
  const name = stored[k]; if (!name) continue;
  await step(`3${k} read from the public address with no key`, async () => {
    const head = await gatewayRange(name, 0, 1024);
    const t0 = Date.now(); const whole = await gatewayRead(name, 0, storedSizeForPlaintext(SIZE, geometry)); const readMs = Date.now() - t0;
    const stranger = { firstByteIsContainerVersion: head[0] === 1, headIsVideo: sha(head) === sha(plain.subarray(0, 1024)), videoBytesFoundInWholeFile: whole.includes(plain.subarray(5 * MB, 5 * MB + 64)), wholeBytes: whole.length };
    const t1 = Date.now(); const opened = await openRange(async (a, b) => whole.subarray(a, b), SIZE, name, kek, 0, SIZE); const openMs = Date.now() - t1;
    const seek = await openRange((a, b) => gatewayRead(name, a, b), SIZE, name, kek, 10.5 * MB, 11.5 * MB);
    let wrongSecretOpened = true; try { await openRange((a, b) => gatewayRead(name, a, b), SIZE, name, await kekFor(crypto.randomBytes(32)), 0, 1024); } catch { wrongSecretOpened = false; }
    const ok = { strangerSeesOnlyCiphertext: !stranger.headIsVideo && !stranger.videoBytesFoundInWholeFile, wholeOpensWithSecret: sha(opened) === sha(plain), seekOpensWithSecret: sha(seek) === sha(plain.subarray(10.5 * MB, 11.5 * MB)), wrongSecretOpened };
    say(`   a stranger gets ${whole.length} bytes in ${(readMs / 1000).toFixed(1)} s; video visible to them: ${!ok.strangerSeesOnlyCiphertext}`);
    say(`   with VideoMind's secret: whole file ${ok.wholeOpensWithSecret ? "opens and matches" : "DOES NOT MATCH"} (${openMs} ms), seek ${ok.seekOpensWithSecret ? "opens and matches" : "DOES NOT MATCH"}, wrong secret opens: ${wrongSecretOpened}`);
    return { stranger, readMs, openMs, ok };
  });
}

await step("4 delete the test files", async () => {
  const out = {};
  for (const [k, name] of Object.entries(stored)) {
    try { const { transaction } = await client.coordination.deleteObject({ account: p, blobName: name }); await aptos.waitForTransaction({ transactionHash: transaction.hash }); out[k] = "deleted"; }
    catch (e) { out[k] = `not deleted: ${errText(e).slice(0, 200)}`; }
  }
  return out;
});

report.finishedAt = new Date().toISOString();
await fsp.writeFile(path.join(HERE, "probe5-report.json"), JSON.stringify(json(report), null, 2));
const failed = Object.entries(report.steps).filter(([, v]) => !v.ok).map(([k]) => k);
say(`\nDone. ${Object.keys(report.steps).length - failed.length} steps ok, ${failed.length} failed${failed.length ? ": " + failed.join(", ") : ""}.`);
say(`Report: ${path.join(HERE, "probe5-report.json")} (no keys or secrets in it). Paste it back to Claude.`);
process.exit(0);
