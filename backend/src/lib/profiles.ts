// src/lib/profiles.ts
// vm_profile: a wallet's public name and bio.
//
// A profile is optional. Without one the public page shows the wallet's
// address. Names are not unique and prove nothing: the wallet address is
// the identity, and the page always shows it.
import { getDb } from "./db.js";
import { normalizeWallet } from "./auth.js";

export interface Profile { wallet: string; name: string | null; bio: string | null; updatedAt: number | null }

export const NAME_MAX = 60;
export const BIO_MAX = 500;

export class ProfileError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export async function getProfile(wallet: string): Promise<Profile> {
  const w = normalizeWallet(wallet) ?? wallet.toLowerCase();
  const r = await getDb().execute({ sql: "SELECT * FROM profiles WHERE wallet = ?", args: [w] });
  const row = r.rows[0] as Record<string, unknown> | undefined;
  return { wallet: w, name: row?.name ? String(row.name) : null, bio: row?.bio ? String(row.bio) : null, updatedAt: row ? Number(row.updated_at) : null };
}

/** Names for many wallets at once (for showing who made a video). */
export async function namesOf(wallets: string[]): Promise<Map<string, string>> {
  const list = [...new Set(wallets.map((w) => normalizeWallet(w)).filter((w): w is string => !!w))];
  const out = new Map<string, string>();
  if (!list.length) return out;
  const r = await getDb().execute({ sql: `SELECT wallet, name FROM profiles WHERE wallet IN (${list.map(() => "?").join(",")}) AND name IS NOT NULL`, args: list });
  for (const row of r.rows as any[]) out.set(String(row.wallet), String(row.name));
  return out;
}

/** Spaces tidied, control characters dropped. Empty means none. */
function clean(v: unknown, max: number, field: string, keepLines: boolean): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") throw new ProfileError(400, `bad_${field}`, `${field} must be text.`);
  let t = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  t = keepLines ? t.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim() : t.replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (t.length > max) throw new ProfileError(400, `${field}_too_long`, `Keep the ${field} to ${max} characters.`);
  return t;
}

export async function saveProfile(wallet: string, body: unknown): Promise<Profile> {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = clean(b.name, NAME_MAX, "name", false);
  const bio = clean(b.bio, BIO_MAX, "bio", true);
  const w = normalizeWallet(wallet) ?? wallet.toLowerCase();
  await getDb().execute({
    sql: `INSERT INTO profiles (wallet, name, bio, updated_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(wallet) DO UPDATE SET name = excluded.name, bio = excluded.bio, updated_at = excluded.updated_at`,
    args: [w, name, bio, Date.now()],
  });
  return getProfile(w);
}
