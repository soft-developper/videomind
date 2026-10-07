// src/lib/session.ts
// vm_signin: the signed in session, kept in this browser.
//
// The API answers sign in with a bearer token. It is held in memory and
// in localStorage so a reload does not ask the wallet to sign again. It
// is a bearer token and not a cookie because the site and the API are on
// different domains, where browsers block cookies.
//
// No React and no "@/..." imports here, so it can be tested in plain Node.

export interface Session {
  token: string;
  /** canonical wallet address the server signed in */
  wallet: string;
  /** unix ms */
  expiresAt: number;
}

const KEY = "vm.session.v1";
let current: Session | null | undefined; // undefined = not read from storage yet
const listeners = new Set<() => void>();

function read(): Session | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    if (typeof s?.token !== "string" || typeof s?.wallet !== "string" || typeof s?.expiresAt !== "number") return null;
    return s;
  } catch {
    return null;
  }
}

function write(s: Session | null) {
  try {
    if (s) window.localStorage.setItem(KEY, JSON.stringify(s));
    else window.localStorage.removeItem(KEY);
  } catch {
    // storage blocked (private window): the session lives in memory only
  }
}

/** The current session, or null. Safe to call during server rendering. */
export function getSession(): Session | null {
  if (typeof window === "undefined") return null;
  if (current === undefined) current = read();
  if (current && current.expiresAt <= Date.now()) {
    current = null;
    write(null);
  }
  return current;
}

export function setSession(s: Session | null) {
  if (typeof window === "undefined") return;
  const before = getSession();
  if (before === s || (before && s && before.token === s.token)) return;
  current = s;
  write(s);
  listeners.forEach((fn) => fn());
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Compare two Aptos addresses regardless of case or leading zeros. */
export function sameWallet(a?: string | null, b?: string | null): boolean {
  const norm = (v?: string | null) =>
    typeof v === "string" && /^0x[0-9a-fA-F]{1,64}$/.test(v) ? v.slice(2).toLowerCase().padStart(64, "0") : null;
  const x = norm(a);
  return x !== null && x === norm(b);
}
