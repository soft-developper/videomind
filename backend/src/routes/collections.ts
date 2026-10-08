// src/routes/collections.ts
// vm_info: collections of videos, such as the lectures of one course.
// A collection belongs to the signed in wallet. Someone else's collection
// answers "not found", so nothing about it can be learned.
import { Router, type Response } from "express";
import { rateLimit } from "../lib/guard.js";
import { requireAuth, authOf } from "../lib/auth.js";
import { listCollections, getCollection, createCollection, updateCollection, deleteCollection, InfoError } from "../lib/videoInfo.js";

const router = Router();

const limitWrite = rateLimit({
  name: "collection_write",
  label: "collection changes",
  perClient: { max: Number(process.env.LIMIT_EDIT_PER_CLIENT_10MIN) || 120, windowMs: 10 * 60_000 },
  global:    { max: Number(process.env.LIMIT_EDIT_GLOBAL_10MIN) || 3000,    windowMs: 10 * 60_000 },
});

const NOT_FOUND = { error: "Collection not found.", code: "collection_not_found" };

function fail(res: Response, err: any) {
  if (err instanceof InfoError) return res.status(err.status).json({ error: err.message, code: err.code, ...err.extra });
  console.error(`[collections] ${err?.name ?? "Error"}: ${err?.message ?? err}`);
  return res.status(500).json({ error: "Collections hit a problem. Please try again." });
}

// GET /api/collections: the caller's collections, by name
router.get("/", requireAuth, async (req, res) => {
  try { return res.json({ collections: await listCollections(authOf(req)!.wallet) }); }
  catch (err) { return fail(res, err); }
});

// GET /api/collections/:id
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const c = await getCollection(req.params.id, authOf(req)!.wallet);
    return c ? res.json(c) : res.status(404).json(NOT_FOUND);
  } catch (err) { return fail(res, err); }
});

// POST /api/collections  { name, description? }
router.post("/", limitWrite, requireAuth, async (req, res) => {
  try {
    const b = (req.body ?? {}) as Record<string, unknown>;
    return res.status(201).json(await createCollection(authOf(req)!.wallet, b.name, { description: b.description }));
  } catch (err) { return fail(res, err); }
});

// PATCH /api/collections/:id  { name?, description? }
router.patch("/:id", limitWrite, requireAuth, async (req, res) => {
  try { return res.json(await updateCollection(req.params.id, authOf(req)!.wallet, req.body)); }
  catch (err) { return fail(res, err); }
});

// DELETE /api/collections/:id: the videos in it stay in the library
router.delete("/:id", limitWrite, requireAuth, async (req, res) => {
  try {
    const ok = await deleteCollection(req.params.id, authOf(req)!.wallet);
    return ok ? res.json({ success: true }) : res.status(404).json(NOT_FOUND);
  } catch (err) { return fail(res, err); }
});

export default router;
