// src/lib/charge.ts
// vm_charge: actions paid with credits (Part 16c1).
//
// Every paid action holds its price before the work starts, and after it:
// settles when the work succeeded, releases (nothing charged) when it
// failed. While charging is off, or a price is 0, reserve() answers free and
// nothing here touches a balance. Who pays:
//   process_video  the video's owner, per minute of sound, once per video
//   ask            the video's owner, also for questions from visitors
//   search, learn_paths, learn_ask   the signed in wallet
//   live_captions  the event's host, per minute, in blocks
//   translate      the video's owner, per minute, once per language (lib/translate.ts)
// A settle that fails after the work is done is logged and the hold
// expires: the user is never refused something already delivered.
import { getDb } from "./db.js";
import { reserve, settle, release, CreditsError, type Hold } from "./credits.js";

export type PaidAction = "process_video" | "ask" | "search" | "learn_paths" | "learn_ask" | "live_captions";

const log = (what: string) => (e: any) => console.error(`[charge] ${what}: ${e?.message ?? e}`);

/**
 * Run fn as a paid action. Throws CreditsError 402 not_enough_credits
 * before any work starts when the payer cannot pay. With no payer (a
 * video that belongs to nobody) the work runs free.
 */
export async function charged<T>(a: { wallet: string | null | undefined; action: PaidAction; quantity?: number; videoId?: string | null }, fn: () => Promise<T>): Promise<T> {
  if (!a.wallet) return fn();
  const r = await reserve({ wallet: a.wallet, action: a.action, quantity: a.quantity ?? 1, videoId: a.videoId ?? null });
  let out: T;
  try { out = await fn(); }
  catch (e) {
    if (!r.free) await release(r.hold.id).catch(log(`releasing ${a.action}`));
    throw e;
  }
  if (!r.free) await settle(r.hold.id).catch(log(`settling ${a.action}`));
  return out;
}

/** The English message for a payer without enough credits. Visitors are told the owner is out of credits, not about anyone's balance. */
export const OWNER_OUT = "The owner of this video is out of credits, so it cannot answer questions right now.";

/** A route's answer for a credits refusal, or null for any other error. */
export function creditFailure(err: unknown, opts: { visitor?: boolean } = {}): { status: number; body: { error: string; code: string } } | null {
  if (!(err instanceof CreditsError)) return null;
  if (err.code === "not_enough_credits" && opts.visitor) return { status: 402, body: { error: OWNER_OUT, code: "owner_out_of_credits" } };
  return { status: err.status, body: { error: err.message, code: err.code } };
}

// ── processing a video ──────────────────────────────────────────────────────
const PROCESS_HOLD_MS = 7 * 24 * 3600_000;

async function openHold(videoId: string, action: PaidAction): Promise<string | null> {
  const r = await getDb().execute({
    sql: "SELECT id FROM credit_holds WHERE video_id = ? AND action = ? AND status = 'held' AND expires_at > ? ORDER BY created_at DESC LIMIT 1",
    args: [videoId, action, Date.now()],
  });
  return r.rows[0] ? String((r.rows[0] as any).id) : null;
}

async function alreadyPaid(videoId: string): Promise<boolean> {
  const r = await getDb().execute({
    sql: `SELECT 1 FROM credit_entries c WHERE c.video_id = ? AND c.kind = 'charge' AND c.action = 'process_video'
            AND NOT EXISTS (SELECT 1 FROM credit_entries r WHERE r.refund_of = c.id) LIMIT 1`,
    args: [videoId],
  });
  return r.rows.length > 0;
}

/**
 * Hold the price of processing a video, by the minutes of its sound, before
 * any transcription is paid for. A hold already open for the video (a
 * retry, or a restart in the middle) is kept, and a video already paid for
 * is not charged again.
 */
export async function holdProcessing(a: { videoId: string; wallet: string | null; seconds: number; jobId?: string | null }): Promise<Hold | null> {
  if (!a.wallet || !(a.seconds > 0)) return null;
  if (await openHold(a.videoId, "process_video")) return null;
  if (await alreadyPaid(a.videoId)) return null;
  const r = await reserve({ wallet: a.wallet, action: "process_video", quantity: a.seconds / 60, videoId: a.videoId, jobId: a.jobId ?? null, ttlMs: PROCESS_HOLD_MS });
  return r.free ? null : r.hold;
}

/** The video is ready: charge what was held for it. */
export async function settleProcessing(videoId: string): Promise<void> {
  const id = await openHold(videoId, "process_video");
  if (id) await settle(id).catch(log(`settling the processing of ${videoId}`));
}

/** Processing failed for good, or the video was deleted: nothing is charged. */
export async function releaseProcessing(videoId: string): Promise<void> {
  const id = await openHold(videoId, "process_video");
  if (id) await release(id).catch(log(`releasing the processing of ${videoId}`));
}
