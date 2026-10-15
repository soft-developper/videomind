// src/lib/securityLog.ts
// vm_ops: recent security events for the admin dashboard, kept in this
// process's memory only and lost on restart (nothing is written to the
// database). Callers are shown as a short code made from the IP address
// with a secret that changes on every restart, so the code cannot be
// turned back into the address or followed across restarts.
import crypto from "crypto";

const MAX = 300;
const secret = crypto.randomBytes(32);
export const startedAt = Date.now();

export interface LimitHit { at: number; family: string; caller: string }
export interface RefusedSignIn { at: number; wallet: string | null; reason: string }

const hits: LimitHit[] = [];
const refused: RefusedSignIn[] = [];
const push = <T>(list: T[], x: T) => { list.push(x); if (list.length > MAX) list.splice(0, list.length - MAX); };

export const callerCode = (ip: string) => crypto.createHmac("sha256", secret).update(ip).digest("hex").slice(0, 8);

export function recordLimitHit(family: string, ip: string) { push(hits, { at: Date.now(), family, caller: callerCode(ip) }); }
export function recordRefusedSignIn(wallet: string | null, reason: string) { push(refused, { at: Date.now(), wallet, reason: reason.slice(0, 200) }); }

/** Rate limit hits grouped by limit and caller, most recent first. */
export function limitSummary() {
  const by = new Map<string, { family: string; caller: string; count: number; first: number; last: number }>();
  for (const h of hits) {
    const k = `${h.family}|${h.caller}`;
    const g = by.get(k) ?? { family: h.family, caller: h.caller, count: 0, first: h.at, last: h.at };
    g.count++; g.last = Math.max(g.last, h.at); g.first = Math.min(g.first, h.at); by.set(k, g);
  }
  return [...by.values()].sort((a, b) => b.last - a.last);
}
export const refusedSignIns = () => refused.slice().reverse();
export const counts = () => ({ limitHits: hits.length, refusedCount: refused.length, since: startedAt });
/** For tests. */
export function _clearSecurityLog() { hits.length = 0; refused.length = 0; }
