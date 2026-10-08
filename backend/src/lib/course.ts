// src/lib/course.ts
// vm_courses: a collection watched in order, as a course. Its videos are
// lessons, numbered by their place in the collection.
import { getDb } from "./db.js";
import { store } from "./store.js";
import { canView, InfoError } from "./videoInfo.js";
import type { VideoRecord } from "../types/video.js";

export interface Lesson { id: string; title: string }
export interface CourseInfo { id: string; name: string; lesson: number; lessons: number; prev: Lesson | null; next: Lesson | null }

/** The collection's videos in lesson order: by position, then by when they were added. */
async function lessonIds(collectionId: string): Promise<string[]> {
  const r = await getDb().execute({
    sql: "SELECT video_id FROM collection_items WHERE collection_id = ? ORDER BY position ASC, added_at ASC",
    args: [collectionId],
  });
  return r.rows.map((x) => String((x as Record<string, unknown>).video_id));
}

/**
 * Where a video sits in its course, for someone who may open it. Only
 * lessons this wallet may open count, so a private lesson is never named
 * to anyone but its owner.
 */
export async function courseOf(video: VideoRecord, wallet: string | null | undefined): Promise<CourseInfo | null> {
  const c = video.collection;
  if (!c?.id) return null;
  const ids = await lessonIds(c.id);
  const open: Lesson[] = [];
  for (const id of ids) {
    const v = id === video.id ? video : await store.get(id);
    if (v && (v.id === video.id || (v.status === "ready" && canView(v, wallet)))) open.push({ id: v.id, title: v.title });
  }
  const at = open.findIndex((l) => l.id === video.id);
  if (at === -1) return null;
  return { id: c.id, name: c.name, lesson: at + 1, lessons: open.length, prev: open[at - 1] ?? null, next: open[at + 1] ?? null };
}

/**
 * Put a collection's videos in a new order. `videoIds` must be exactly
 * the videos in it, each once.
 */
export async function reorderCourse(collectionId: string, wallet: string, videoIds: unknown): Promise<string[]> {
  const own = await getDb().execute({ sql: "SELECT 1 FROM collections WHERE id = ? AND owner_wallet = ?", args: [collectionId, wallet] });
  if (!own.rows.length) throw new InfoError(404, "collection_not_found", "Collection not found.");
  if (!Array.isArray(videoIds) || videoIds.some((v) => typeof v !== "string")) throw new InfoError(400, "bad_order", "Send the videos as a list of ids.");
  const now = await lessonIds(collectionId);
  const asked = videoIds as string[];
  const same = asked.length === now.length && new Set(asked).size === asked.length && asked.every((id) => now.includes(id));
  if (!same) throw new InfoError(409, "order_mismatch", "The collection changed. Reload the page and try again.");
  await getDb().batch(asked.map((id, i) => ({
    sql: "UPDATE collection_items SET position = ? WHERE collection_id = ? AND video_id = ?", args: [i + 1, collectionId, id],
  })), "write");
  return asked;
}
