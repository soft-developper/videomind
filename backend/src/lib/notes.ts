// src/lib/notes.ts
// vm_notes: bookmarks and notes. Any signed in wallet can keep them on any
// video it can open. They belong to that wallet alone: nobody else reads
// them, the video's owner included.
import crypto from "crypto";
import { getDb } from "./db.js";

export type NoteKind = "bookmark" | "note";
export interface Note { id: string; kind: NoteKind; atSeconds: number; text: string; createdAt: number; updatedAt: number }

export const MAX_NOTES_PER_VIDEO = 500;
export const MAX_NOTE_TEXT = 5000;
export const MAX_BOOKMARK_LABEL = 200;

export class NoteError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); this.name = "NoteError"; }
}

const rowToNote = (r: Record<string, unknown>): Note => ({
  id: String(r.id), kind: String(r.kind) as NoteKind, atSeconds: Number(r.at_sec), text: String(r.text ?? ""),
  createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
});

/** A moment in the video: a number of seconds, not past its end when that is known. */
function moment(v: unknown, length?: number | null): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) throw new NoteError(400, "bad_time", "Say where in the video, in seconds.");
  if (length && length > 0 && v > length + 1) throw new NoteError(400, "after_end", "That moment is after the video ends.");
  return Math.round(v * 10) / 10;
}
function words(v: unknown, kind: NoteKind): string {
  if (v == null) v = "";
  if (typeof v !== "string") throw new NoteError(400, "bad_text", "The note must be text.");
  const t = v.replace(/\r\n/g, "\n").trim();
  const max = kind === "note" ? MAX_NOTE_TEXT : MAX_BOOKMARK_LABEL;
  if (t.length > max) throw new NoteError(400, "too_long", `Keep it under ${max} characters.`);
  if (kind === "note" && !t) throw new NoteError(400, "empty", "Write something in the note.");
  return t;
}

export async function listNotes(videoId: string, wallet: string): Promise<Note[]> {
  const r = await getDb().execute({
    sql: "SELECT * FROM video_notes WHERE wallet = ? AND video_id = ? ORDER BY at_sec ASC, created_at ASC",
    args: [wallet, videoId],
  });
  return r.rows.map((x) => rowToNote(x as Record<string, unknown>));
}

export async function addNote(videoId: string, wallet: string, body: any, length?: number | null): Promise<Note> {
  const kind: NoteKind = body?.kind === "bookmark" ? "bookmark" : body?.kind === "note" ? "note" : (() => { throw new NoteError(400, "bad_kind", "A note is a bookmark or a note."); })();
  const at = moment(body?.atSeconds, length);
  const text = words(body?.text, kind);
  const count = Number(((await getDb().execute({ sql: "SELECT COUNT(*) AS c FROM video_notes WHERE wallet = ? AND video_id = ?", args: [wallet, videoId] })).rows[0] as any)?.c ?? 0);
  if (count >= MAX_NOTES_PER_VIDEO) throw new NoteError(409, "too_many", `You can keep up to ${MAX_NOTES_PER_VIDEO} bookmarks and notes on one video.`);
  const now = Date.now();
  const note: Note = { id: crypto.randomUUID(), kind, atSeconds: at, text, createdAt: now, updatedAt: now };
  await getDb().execute({
    sql: "INSERT INTO video_notes (id, video_id, wallet, kind, at_sec, text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    args: [note.id, videoId, wallet, kind, at, text, now, now],
  });
  return note;
}

async function mine(videoId: string, wallet: string, id: string): Promise<Note> {
  const r = await getDb().execute({ sql: "SELECT * FROM video_notes WHERE id = ? AND video_id = ? AND wallet = ?", args: [id, videoId, wallet] });
  // Someone else's note answers the same as one that does not exist.
  if (!r.rows.length) throw new NoteError(404, "not_found", "That note was not found.");
  return rowToNote(r.rows[0] as Record<string, unknown>);
}

export async function editNote(videoId: string, wallet: string, id: string, body: any, length?: number | null): Promise<Note> {
  const n = await mine(videoId, wallet, id);
  const at = body?.atSeconds === undefined ? n.atSeconds : moment(body.atSeconds, length);
  const text = body?.text === undefined ? n.text : words(body.text, n.kind);
  const now = Date.now();
  await getDb().execute({ sql: "UPDATE video_notes SET at_sec = ?, text = ?, updated_at = ? WHERE id = ?", args: [at, text, now, id] });
  return { ...n, atSeconds: at, text, updatedAt: now };
}

export async function deleteNote(videoId: string, wallet: string, id: string): Promise<void> {
  await mine(videoId, wallet, id);
  await getDb().execute({ sql: "DELETE FROM video_notes WHERE id = ?", args: [id] });
}
