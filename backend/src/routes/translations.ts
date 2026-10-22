// src/routes/translations.ts
// vm_translate: a video's transcript in other languages (see lib/translate.ts). Mounted at /api/videos.
//
//   GET    /:id/translations          the spoken language, the languages offered and where each stands
//   POST   /:id/translations          the owner asks for one { lang }; its price is held (402 without credits)
//   GET    /:id/translations/:lang    a finished language: transcript lines, summary, chapters, key moments
//   DELETE /:id/translations/:lang    the owner removes one; anything held for it is released
// Captions in a language are GET /:id/captions?lang=xx (routes/videos.ts).
import { Router } from "express";
import { store } from "../lib/store.js";
import { requireAuth, optionalAuth, authOf } from "../lib/auth.js";
import { ownsVideo, canView, blockedFor } from "../lib/videoInfo.js";
import { rateLimit } from "../lib/guard.js";
import { creditFailure } from "../lib/charge.js";
import {
  LANGS, isLang, spokenLanguage, listTranslations, getTranslation, startTranslation, removeTranslation,
  publicView, contentOf, minutesOf, TranslateError,
} from "../lib/translate.js";

const router = Router();

const limitTranslate = rateLimit({
  name: "translate",
  label: "translation requests",
  perClient: { max: Number(process.env.LIMIT_TRANSLATE_PER_CLIENT_10MIN) || 20, windowMs: 10 * 60_000 },
  global:    { max: Number(process.env.LIMIT_TRANSLATE_GLOBAL_10MIN) || 300, windowMs: 10 * 60_000 },
});

const NOT_OWNER = { error: "This video belongs to a different wallet.", code: "not_owner" };

router.get("/:id/translations", optionalAuth, async (req, res) => {
  try {
    const video = await store.get(req.params.id);
    if (!video) return res.status(404).json({ error: "Video not found" });
    const wallet = authOf(req)?.wallet;
    if (!canView(video, wallet)) return res.status(403).json(blockedFor(video));
    const owner = !!wallet && ownsVideo(video, wallet);
    const spoken = await spokenLanguage(video.id);
    const items = (await listTranslations(video.id)).filter((t) => owner || t.status === "done").map((t) => publicView(t, owner));
    const hasWords = (video.ai?.transcript ?? []).some((s) => s.text?.trim());
    return res.json({
      spoken,
      offered: LANGS.filter((l) => l !== spoken),
      items,
      ...(owner ? {
        canTranslate: video.status === "ready" && hasWords && !video.removed,
        minutes: Math.round(minutesOf(video) * 100) / 100,
      } : {}),
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.post("/:id/translations", limitTranslate, requireAuth, async (req, res) => {
  try {
    const wallet = authOf(req)!.wallet;
    const video = await store.get(req.params.id);
    if (!video) return res.status(404).json({ error: "Video not found" });
    if (!ownsVideo(video, wallet)) return res.status(403).json(NOT_OWNER);
    const t = await startTranslation(video, wallet, req.body?.lang);
    return res.status(202).json(publicView(t, true));
  } catch (err: any) {
    if (err instanceof TranslateError) return res.status(err.status).json({ error: err.message, code: err.code });
    const c = creditFailure(err);
    if (c) return res.status(c.status).json(c.body);
    return res.status(500).json({ error: err.message });
  }
});

router.get("/:id/translations/:lang", optionalAuth, async (req, res) => {
  try {
    const video = await store.get(req.params.id);
    if (!video) return res.status(404).json({ error: "Video not found" });
    if (!canView(video, authOf(req)?.wallet)) return res.status(403).json(blockedFor(video));
    const t = isLang(req.params.lang) ? await getTranslation(video.id, req.params.lang) : null;
    if (!t || t.status !== "done") return res.status(404).json({ error: "This video has no translation in that language.", code: "no_translation" });
    res.setHeader("Cache-Control", "private, max-age=60");
    res.setHeader("Content-Language", t.lang);
    return res.json(contentOf(t, video));
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete("/:id/translations/:lang", limitTranslate, requireAuth, async (req, res) => {
  try {
    const video = await store.get(req.params.id);
    if (!video) return res.status(404).json({ error: "Video not found" });
    if (!ownsVideo(video, authOf(req)!.wallet)) return res.status(403).json(NOT_OWNER);
    if (!(await removeTranslation(video.id, req.params.lang))) return res.status(404).json({ error: "This video has no translation in that language.", code: "no_translation" });
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
