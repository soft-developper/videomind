// src/routes/generate.ts
// vm_generate: videos made from a prompt (Part 17b).
//
//   GET  /api/generate   may this wallet generate, and the models it can use
//   POST /api/generate   { prompt, modelId, seconds, aspect, title, visibility }
//                        holds the price, starts the job, answers { videoId }
//   POST /api/generate/direct   { idea, aspect?, seconds?, modelId? }  vm_director: Claude
//                        suggests the model, length, shape and the description (nothing is made)
import { Router } from "express";
import { requireAuth, authOf } from "../lib/auth.js";
import { rateLimit } from "../lib/guard.js";
import { CreditsError } from "../lib/credits.js";
import { generateInfo, startGeneration, mayGenerate, GenError } from "../lib/generation.js";
import { direct, DirectorError } from "../lib/director.js";
import { claudeFailure } from "../services/claude.js";
import { storagePaused, STORAGE_UNPAID } from "../lib/storageCharge.js";

const router = Router();

const limitGenerate = rateLimit({
  name: "generate", label: "video generations",
  perClient: { max: Number(process.env.LIMIT_GENERATE_PER_CLIENT_10MIN) || 10, windowMs: 10 * 60_000 },
  global: { max: Number(process.env.LIMIT_GENERATE_GLOBAL_10MIN) || 200, windowMs: 10 * 60_000 },
});

function fail(res: any, err: any, what: string) {
  if (err instanceof GenError || err instanceof CreditsError || err instanceof DirectorError) return res.status(err.status).json({ error: err.message, code: err.code });
  const c = claudeFailure(err);
  if (c) return res.status(c.status).json({ error: c.error, code: c.code });
  console.error(`[generate] ${what}: ${err?.message ?? err}`);
  return res.status(500).json({ error: "Video generation hit a problem. Try again in a minute.", code: "server_error" });
}

// Writing a description is an AI call: its own, smaller limit.
const limitDirect = rateLimit({
  name: "generate_direct", label: "description suggestions",
  perClient: { max: Number(process.env.LIMIT_GENERATE_DIRECT_PER_CLIENT_10MIN) || 20, windowMs: 10 * 60_000 },
  global: { max: Number(process.env.LIMIT_GENERATE_DIRECT_GLOBAL_10MIN) || 300, windowMs: 10 * 60_000 },
});

router.post("/direct", limitDirect, requireAuth, async (req, res) => {
  try {
    const wallet = authOf(req)!.wallet;
    if (!(await mayGenerate(wallet))) return res.status(403).json({ error: "Video generation is not open to this wallet yet.", code: "not_allowed" });
    const b = (req.body ?? {}) as Record<string, unknown>;
    return res.json(await direct({ wallet, idea: b.idea, aspect: b.aspect, seconds: b.seconds, modelId: b.modelId }));
  } catch (err) { return fail(res, err, "writing a description"); }
});

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
