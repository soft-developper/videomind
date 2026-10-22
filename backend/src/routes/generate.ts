// src/routes/generate.ts
// vm_generate: videos made from a prompt (Part 17b).
//
//   GET  /api/generate   may this wallet generate, and the models it can use
//   POST /api/generate   { prompt, modelId, seconds, aspect, title, visibility }
//                        holds the price, starts the job, answers { videoId }
import { Router } from "express";
import { requireAuth, authOf } from "../lib/auth.js";
import { rateLimit } from "../lib/guard.js";
import { CreditsError } from "../lib/credits.js";
import { generateInfo, startGeneration, GenError } from "../lib/generation.js";
import { storagePaused, STORAGE_UNPAID } from "../lib/storageCharge.js";

const router = Router();

const limitGenerate = rateLimit({
  name: "generate", label: "video generations",
  perClient: { max: Number(process.env.LIMIT_GENERATE_PER_CLIENT_10MIN) || 10, windowMs: 10 * 60_000 },
  global: { max: Number(process.env.LIMIT_GENERATE_GLOBAL_10MIN) || 200, windowMs: 10 * 60_000 },
});

function fail(res: any, err: any, what: string) {
  if (err instanceof GenError || err instanceof CreditsError) return res.status(err.status).json({ error: err.message, code: err.code });
  console.error(`[generate] ${what}: ${err?.message ?? err}`);
  return res.status(500).json({ error: "Video generation hit a problem. Try again in a minute.", code: "server_error" });
}

router.get("/", requireAuth, async (req, res) => {
  try { res.setHeader("Cache-Control", "no-store"); return res.json(await generateInfo(authOf(req)!.wallet)); }
  catch (err) { return fail(res, err, "reading the settings"); }
});

router.post("/", limitGenerate, requireAuth, async (req, res) => {
  try {
    const wallet = authOf(req)!.wallet;
    // vm_storagecharge: a new video waits while storage is unpaid, as an upload does.
    if (await storagePaused(wallet)) return res.status(402).json({ error: STORAGE_UNPAID, code: "storage_unpaid" });
    const b = (req.body ?? {}) as Record<string, unknown>;
    const r = await startGeneration({ wallet, prompt: b.prompt, modelId: b.modelId, seconds: b.seconds, aspect: b.aspect, title: b.title, visibility: b.visibility });
    return res.status(201).json(r);
  } catch (err) { return fail(res, err, "starting a generation"); }
});

export default router;
