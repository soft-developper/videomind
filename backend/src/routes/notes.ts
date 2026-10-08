// src/routes/notes.ts
// vm_notes: the signed in wallet's own bookmarks and notes on a video.
//   GET    /api/videos/:id/notes
//   POST   /api/videos/:id/notes            { kind: "bookmark" | "note", atSeconds, text? }
//   PATCH  /api/videos/:id/notes/:noteId    { atSeconds?, text? }
//   DELETE /api/videos/:id/notes/:noteId
// The wallet must be able to open the video. A private video someone else
// owns answers 403 and shows nothing about the notes.
import { Router } from "express";
import { store } from "../lib/store.js";
import { requireAuth, authOf } from "../lib/auth.js";
import { rateLimit } from "../lib/guard.js";
import { canView, PRIVATE_VIDEO } from "../lib/videoInfo.js";
import { listNotes, addNote, editNote, deleteNote, NoteError } from "../lib/notes.js";
import type { VideoRecord } from "../types/video.js";

const router = Router();

const limitNotes = rateLimit({
  name: "notes",
  label: "note changes",
  perClient: { max: Number(process.env.LIMIT_NOTES_PER_CLIENT_10MIN) || 300, windowMs: 10 * 60_000 },
  global:    { max: Number(process.env.LIMIT_NOTES_GLOBAL_10MIN) || 6000,   windowMs: 10 * 60_000 },
});

/** The video, when this wallet may open it; otherwise the answer is already sent. */
async function videoFor(req: any, res: any): Promise<VideoRecord | null> {
  const video = await store.get(req.params.id);
  if (!video) { res.status(404).json({ error: "Video not found" }); return null; }
  if (!canView(video, authOf(req)!.wallet)) { res.status(403).json(PRIVATE_VIDEO); return null; }
  return video;
}
const lengthOf = (v: VideoRecord) => {
  const end = Math.max(0, ...(v.ai?.transcript ?? []).map((s) => s.end));
  return v.meta?.durationSeconds ?? v.media?.durationSeconds ?? (end > 0 ? end + 1 : null);
};
const fail = (res: any, err: any) => {
  if (err instanceof NoteError) return res.status(err.status).json({ error: err.message, code: err.code });
  console.error(`[notes] ${err?.message ?? err}`);
  return res.status(500).json({ error: "Notes hit a problem. Please try again." });
};

router.get("/:id/notes", requireAuth, async (req, res) => {
  try {
    const video = await videoFor(req, res); if (!video) return;
    return res.json({ notes: await listNotes(video.id, authOf(req)!.wallet) });
  } catch (err) { return fail(res, err); }
});

router.post("/:id/notes", limitNotes, requireAuth, async (req, res) => {
  try {
    const video = await videoFor(req, res); if (!video) return;
    return res.status(201).json(await addNote(video.id, authOf(req)!.wallet, req.body, lengthOf(video)));
  } catch (err) { return fail(res, err); }
});

router.patch("/:id/notes/:noteId", limitNotes, requireAuth, async (req, res) => {
  try {
    const video = await videoFor(req, res); if (!video) return;
    return res.json(await editNote(video.id, authOf(req)!.wallet, req.params.noteId, req.body, lengthOf(video)));
  } catch (err) { return fail(res, err); }
});

router.delete("/:id/notes/:noteId", limitNotes, requireAuth, async (req, res) => {
  try {
    const video = await videoFor(req, res); if (!video) return;
    await deleteNote(video.id, authOf(req)!.wallet, req.params.noteId);
    return res.status(204).end();
  } catch (err) { return fail(res, err); }
});

export default router;
