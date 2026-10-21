// VideoMind, Part 16 probe, fourth run: can a browser's video player read a
// public video straight from Shelby? (Part 16d: public videos play from
// Shelby only, the founder's choice of 21 Oct 2026.)
//
//   cd scripts/shelby_probe
//   export SHELBY_API_KEY=...       # the same value as NEXT_PUBLIC_APTOS_API_KEY
//   node probe4.mjs
//
// A video element asks for the file with a plain GET and a Range header,
// with no API key (it cannot add one) and, unless the page asks for CORS,
// without needing CORS headers. Seeking asks for a new range. This uploads
// one 20 MB TEST file and asks for it the way a browser would, on both
// Shelby addresses VideoMind knows:
//   A  https://shelby.shelbynet.shelby.xyz/shelby   (the SDK's RPC address)
//   B  https://api.shelbynet.shelby.xyz/shelby      (the address the site plays from today)
// For each: a small range with and without the key, the whole file without a
// Range header, an open ended range ("bytes=0-", what a player sends first)
// read for up to 60 s, a range from the middle (a seek), and whether CORS
// headers come back for VideoMind's address. Then it deletes the file.
// Writes probe4-report.json, with no keys in it.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { Account, Ed25519PrivateKey, Network } from "@aptos-labs/ts-sdk";
import { ShelbyNodeClient, SHELBYUSD_FA_METADATA_ADDRESS } from "@shelby-protocol/sdk/node";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API_KEY = process.env.SHELBY_API_KEY || process.env.NEXT_PUBLIC_APTOS_API_KEY || process.env.APTOS_API_KEY;
if (!API_KEY) { console.error("Set SHELBY_API_KEY first. Do not paste it anywhere else."); process.exit(1); }
const SIZE = 20 * 1048576;
const HOSTS = { A: "https://shelby.shelbynet.shelby.xyz/shelby", B: "https://api.shelbynet.shelby.xyz/shelby" };
const ORIGIN = "https://vidzmind.xyz";
const KEEP = ["content-type", "content-length", "content-range", "accept-ranges", "access-control-allow-origin", "access-control-expose-headers", "cache-control", "etag", "server"];

const client = new ShelbyNodeClient({ network: Network.SHELBYNET, apiKey: API_KEY, locationHint: "shelbynet-1" });
const aptos = client.aptos;
const report = { probeVersion: 4, startedAt: new Date().toISOString(), host: process.env.RENDER ? "render" : "this machine", hosts: HOSTS, steps: {} };
const say = (s) => console.log(s);
const json = (v) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));
function errText(e) { const p = []; for (let x = e, d = 0; x && d < 6; x = x.cause, d++) p.push(`${x.message ?? String(x)}${x.code ? ` [${x.code}]` : ""}`); return p.join(" <- "); }
async function step(name, fn) {
  say(`\n== ${name}`); const t0 = Date.now();
  try { const out = await fn(); report.steps[name] = { ok: true, ms: Date.now() - t0, ...json(out ?? {}) }; say(`   ok (${Date.now() - t0} ms)`); return out; }
  catch (e) { report.steps[name] = { ok: false, ms: Date.now() - t0, error: errText(e).slice(0, 2000) }; say(`   FAILED: ${errText(e).slice(0, 600)}`); return undefined; }
}
function payer() {
  const file = path.join(HERE, "probe-accounts.json");
  let saved = {}; try { saved = JSON.parse(fs.readFileSync(file, "utf8")); } catch { /* first run */ }
  const make = (k) => (saved[k] ? Account.fromPrivateKey({ privateKey: new Ed25519PrivateKey(saved[k]) }) : Account.generate());
  const p = make("payer"), t = make("treasury");
  fs.writeFileSync(file, JSON.stringify({ note: "shelbynet TEST accounts made by the probe. No value.", payer: p.privateKey.toString(), treasury: t.privateKey.toString() }, null, 2), { mode: 0o600 });
  return p;
}

/** One request as a browser would make it. Reads at most `maxBytes` or `maxMs`, then stops. */
async function ask(url, { range, key = false, origin = false, maxBytes = Infinity, maxMs = 30_000 } = {}) {
  const headers = {};
  if (range) headers.Range = range;
  if (key) headers.Authorization = `Bearer ${API_KEY}`;
  if (origin) headers.Origin = ORIGIN;
  const t0 = Date.now(); const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), maxMs);
  const out = { request: { range: range ?? null, key, origin } };
  try {
    const r = await fetch(url, { headers, signal: ctl.signal });
    out.status = r.status; out.headers = Object.fromEntries(KEEP.filter((h) => r.headers.get(h) != null).map((h) => [h, r.headers.get(h)]));
    out.firstByteMs = null; out.bytes = 0;
    const hash = crypto.createHash("sha256");
    if (r.body) {
      const reader = r.body.getReader();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) { out.ended = "complete"; break; }
          if (out.firstByteMs === null) out.firstByteMs = Date.now() - t0;
          out.bytes += value.length; hash.update(value);
          if (out.bytes >= maxBytes) { out.ended = "stopped by the probe (enough bytes)"; await reader.cancel().catch(() => {}); break; }
        }
      } catch (e) { out.ended = ctl.signal.aborted ? `stopped by the probe after ${maxMs / 1000} s` : `cut by the server: ${errText(e).slice(0, 160)}`; }
    }
    out.sha256 = hash.digest("hex");
    if (out.status >= 400) out.text = undefined;
  } catch (e) { out.error = errText(e).slice(0, 300); }
  finally { clearTimeout(timer); out.ms = Date.now() - t0; }
  return out;
}
const line = (r) => r.error ? `NO ANSWER: ${r.error}` : `${r.status}, ${r.bytes} bytes in ${(r.ms / 1000).toFixed(1)} s${r.ended ? `, ${r.ended}` : ""}${r.headers?.["content-range"] ? `, ${r.headers["content-range"]}` : ""}${r.headers?.["accept-ranges"] ? `, accept-ranges ${r.headers["accept-ranges"]}` : ""}`;

const p = payer();
say(`Test account (shelbynet, no value): ${p.accountAddress.toString()}`);
let blob;
await step("1 upload a 20 MB test file", async () => {
  const dir = path.join(HERE, "probe-data"); await fsp.mkdir(dir, { recursive: true });
  const data = crypto.randomBytes(SIZE);
  const blobName = `probe/${Date.now()}-play.bin`;
  const b = await aptos.view({ payload: { function: "0x1::primary_fungible_store::balance", typeArguments: ["0x1::fungible_asset::Metadata"], functionArguments: [p.accountAddress, SHELBYUSD_FA_METADATA_ADDRESS] } }).then((r) => Number(r[0])).catch(() => 0);
  if (b < 1_000_000) await client.fundAccountWithShelbyUSD({ address: p.accountAddress, amount: 100_000_000 }).catch(() => {});
  await client.upload({ signer: p, blobData: data, blobName });
  blob = { blobName, sha: crypto.createHash("sha256").update(data).digest("hex"), mid: crypto.createHash("sha256").update(data.subarray(10 * 1048576, 10 * 1048576 + 1048576)).digest("hex"), head: crypto.createHash("sha256").update(data.subarray(0, 1024)).digest("hex") };
  say(`   stored ${blobName}`);
  return { blobName };
});

if (blob) {
  for (const [label, base] of Object.entries(HOSTS)) {
    const url = `${base}/v1/blobs/${p.accountAddress.toString()}/${blob.blobName.split("/").map(encodeURIComponent).join("/")}`;
    await step(`2${label} read as a browser from ${base}`, async () => {
      const small = await ask(url, { range: "bytes=0-1023" });
      const smallKey = await ask(url, { range: "bytes=0-1023", key: true });
      const cors = await ask(url, { range: "bytes=0-1023", origin: true });
      const whole = await ask(url, { maxMs: 60_000 });
      const open = await ask(url, { range: "bytes=0-", maxMs: 60_000 });
      const seek = await ask(url, { range: `bytes=${10 * 1048576}-${11 * 1048576 - 1}` });
      const ok = {
        smallWithoutKey: small.status === 206 && small.sha256 === blob.head,
        smallWithKey: smallKey.status === 206 && smallKey.sha256 === blob.head,
        corsHeader: cors.headers?.["access-control-allow-origin"] ?? null,
        wholeComplete: whole.ended === "complete" && whole.sha256 === blob.sha,
        openEndedComplete: open.ended === "complete" && open.sha256 === blob.sha,
        seekCorrect: seek.status === 206 && seek.sha256 === blob.mid,
      };
      say(`   range 0-1023, no key:   ${line(small)}${ok.smallWithoutKey ? " (bytes correct)" : ""}`);
      say(`   range 0-1023, with key: ${line(smallKey)}${ok.smallWithKey ? " (bytes correct)" : ""}`);
      say(`   CORS for ${ORIGIN}: ${ok.corsHeader ?? "no access-control-allow-origin header"}`);
      say(`   whole file, no Range:   ${line(whole)}${ok.wholeComplete ? " (all bytes correct)" : ""}`);
      say(`   bytes=0- (player start): ${line(open)}${ok.openEndedComplete ? " (all bytes correct)" : ""}`);
      say(`   seek to 10 MB, 1 MB:    ${line(seek)}${ok.seekCorrect ? " (bytes correct)" : ""}`);
      return { url: `${base}/v1/blobs/<account>/<name>`, ok, small, smallKey, cors, whole, open, seek };
    });
  }
  await step("3 delete the test file", async () => {
    const { transaction } = await client.coordination.deleteObject({ account: p, blobName: blob.blobName });
    await aptos.waitForTransaction({ transactionHash: transaction.hash });
    return { deleted: true };
  });
}

report.finishedAt = new Date().toISOString();
await fsp.writeFile(path.join(HERE, "probe4-report.json"), JSON.stringify(json(report), null, 2));
await fsp.rm(path.join(HERE, "probe-data"), { recursive: true, force: true });
const failed = Object.entries(report.steps).filter(([, v]) => !v.ok).map(([k]) => k);
say(`\nDone. ${Object.keys(report.steps).length - failed.length} steps ok, ${failed.length} failed${failed.length ? ": " + failed.join(", ") : ""}.`);
say(`Report: ${path.join(HERE, "probe4-report.json")} (no private keys in it). Paste it back to Claude.`);
process.exit(0);
