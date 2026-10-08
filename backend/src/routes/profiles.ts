// src/routes/profiles.ts
// vm_profile: a wallet's public page, its own profile, and its wallet page.
//
//   GET /api/profiles/:wallet   public: name, bio, public videos and courses
//   GET /api/me/profile         the signed in wallet's name and bio
//   PUT /api/me/profile         change them
//   GET /api/me/wallet          the signed in wallet: its stores on Shelby
//                               (and which need attention) and its usage
//
// Only public videos are listed on a public page. Unlisted videos open
// for whoever has the link, but are never listed anywhere.
import { Router } from "express";
import { store } from "../lib/store.js";
import { requireAuth, authOf, normalizeWallet } from "../lib/auth.js";
import { rateLimit } from "../lib/guard.js";
import { getProfile, saveProfile, ProfileError } from "../lib/profiles.js";
import { anchorsForVideos, latest, canStoreAgain, RENEW_WINDOW_MS } from "../lib/anchors.js";
import { usageTotals, storedBytes } from "../lib/usage.js";
import { getDb } from "../lib/db.js";
import { thumbUrls } from "./videos.js";
import type { VideoRecord } from "../types/video.js";

const router = Router();

const limitProfile = rateLimit({
  name: "profile",
  label: "profile changes",
  perClient: { max: Number(process.env.LIMIT_PROFILE_PER_CLIENT_10MIN) || 60, windowMs: 10 * 60_000 },
  global:    { max: Number(process.env.LIMIT_PROFILE_GLOBAL_10MIN) || 2000, windowMs: 10 * 60_000 },
});
const limitPublic = rateLimit({
  name: "profile_read",
  label: "page loads",
  perClient: { max: Number(process.env.LIMIT_PROFILE_READ_PER_CLIENT_10MIN) || 600, windowMs: 10 * 60_000 },
  global:    { max: Number(process.env.LIMIT_PROFILE_READ_GLOBAL_10MIN) || 20000, windowMs: 10 * 60_000 },
});

/** What a card needs, without the transcript. */
function card(v: VideoRecord, thumbUrl: string | null) {
  return {
    id: v.id, title: v.title, description: v.description ?? null, category: v.category ?? null,
    durationSeconds: v.meta?.durationSeconds ?? null, createdAt: v.createdAt, thumbUrl,
    chapters: v.ai?.chapters?.length ?? 0, collection: v.collection ?? null,
  };
}

// ── GET /api/profiles/:wallet ───────────────────────────────────────────────
router.get("/profiles/:wallet", limitPublic, async (req, res) => {
  try {
    const wallet = normalizeWallet(req.params.wallet);
    if (!wallet) return res.status(400).json({ error: "That is not a wallet address.", code: "bad_wallet" });
    const profile = await getProfile(wallet);
    const mine = (await store.getAll(wallet))
      .filter((v) => normalizeWallet(v.ownerWallet) === wallet && v.visibility === "public" && v.status === "ready");
    const thumbs = await thumbUrls(mine.map((v) => v.id));
    const videos = mine.map((v) => card(v, thumbs.get(v.id) ?? null));

    // Courses: collections with at least one public lesson, lessons in the owner's order.
    const byCourse = new Map<string, typeof videos>();
    for (const v of videos) if (v.collection) byCourse.set(v.collection.id, [...(byCourse.get(v.collection.id) ?? []), v]);
    const ids = [...byCourse.keys()];
    const about = new Map<string, { name: string; description: string | null }>();
    if (ids.length) {
      const r = await getDb().execute({ sql: `SELECT id, name, description FROM collections WHERE id IN (${ids.map(() => "?").join(",")})`, args: ids });
      for (const row of r.rows as any[]) about.set(String(row.id), { name: String(row.name), description: row.description ? String(row.description) : null });
    }
    const courses = ids.map((id) => {
      const lessons = byCourse.get(id)!.slice().sort((a, b) => (a.collection?.position ?? 0) - (b.collection?.position ?? 0) || a.createdAt - b.createdAt);
      return { id, name: about.get(id)?.name ?? lessons[0].collection!.name, description: about.get(id)?.description ?? null,
        lessons: lessons.length, firstVideoId: lessons[0].id, thumbUrl: lessons.find((l) => l.thumbUrl)?.thumbUrl ?? null };
    }).sort((a, b) => b.lessons - a.lessons || a.name.localeCompare(b.name));

    return res.json({ wallet, name: profile.name, bio: profile.bio, videos, courses });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ── the signed in wallet's own profile ────────────────────────────────────────
router.get("/me/profile", requireAuth, async (req, res) => {
  try {
    const p = await getProfile(authOf(req)!.wallet);
    return res.json({ wallet: p.wallet, name: p.name, bio: p.bio });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.put("/me/profile", limitProfile, requireAuth, async (req, res) => {
  try {
    const p = await saveProfile(authOf(req)!.wallet, req.body);
    return res.json({ wallet: p.wallet, name: p.name, bio: p.bio });
  } catch (err: any) {
    if (err instanceof ProfileError) return res.status(err.status).json({ error: err.message, code: err.code });
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /api/me/wallet ────────────────────────────────────────────────────────
router.get("/me/wallet", requireAuth, async (req, res) => {
  try {
    const wallet = authOf(req)!.wallet;
    const list = (await store.getAll(wallet)).filter((v) => v.status !== "uploading");
    const [stores, thumbs, bytes] = await Promise.all([anchorsForVideos(list.map((v) => v.id)), thumbUrls(list.map((v) => v.id)), storedBytes(wallet)]);
    const now = Date.now();
    const videos = list.map((v) => {
      const all = stores.get(v.id) ?? [];
      const cur = latest(all);
      const endingSoon = cur?.state === "anchored" && !!cur.paidUntil && cur.paidUntil - now < RENEW_WINDOW_MS;
      const attention = !!cur && (cur.state === "lapsed" || cur.state === "missing" || cur.state === "unverified" || endingSoon);
      return {
        id: v.id, title: v.title, visibility: v.visibility ?? "unlisted", thumbUrl: thumbs.get(v.id) ?? null, sizeBytes: v.meta?.sizeBytes ?? null,
        state: cur?.state ?? "never", paidUntil: cur?.paidUntil ?? null, stores: all.length,
        endingSoon, attention, canStoreAgain: canStoreAgain(all, now).ok,
      };
    });
    const count = (s: string) => videos.filter((v) => v.state === s).length;
    const since = now - 30 * 86_400_000;
    return res.json({
      wallet,
      summary: {
        videos: videos.length, verified: count("anchored"), checking: count("checking"), never: count("never"),
        attention: videos.filter((v) => v.attention).length, storedBytesNow: bytes,
      },
      videos,
      usage: { days: 30, since, totals: await usageTotals(wallet, since) },
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
