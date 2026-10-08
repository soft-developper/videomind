"use client";
// vm_notes: the signed in wallet's own bookmarks and notes on this video.
// Nobody else sees them, the video's owner included. A note is pinned to
// the moment the video was at when writing started.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, StickyNote, Pencil, Trash2, Clock, Download } from "lucide-react";
import { clsx } from "clsx";
import { getNotes, addNote, editNote, deleteNote, type Note } from "@/lib/api";
import { readableTime, downloadFile, slugify } from "@/lib/exports";
import { useSessionWallet } from "@/components/layout/AuthProvider";
import { WalletButton } from "@/components/layout/WalletButton";

/** Notes as Markdown, in order of time, for keeping elsewhere. */
function toMarkdown(title: string, notes: Note[], link: (s: number) => string): string {
  const lines = [`# Notes on ${title}`, ""];
  for (const n of notes) {
    const at = `[${readableTime(n.atSeconds)}](${link(n.atSeconds)})`;
    lines.push(n.kind === "bookmark" ? `- ${at} Bookmark${n.text ? `: ${n.text}` : ""}` : `- ${at} ${n.text.replace(/\n/g, "\n  ")}`);
  }
  return lines.join("\n") + "\n";
}

export function NotesPanel({
  videoId, title, currentTime, onSeek, shareBase,
}: {
  videoId: string;
  title: string;
  currentTime: number;
  onSeek: (s: number) => void;
  /** the page address notes link back to in the export */
  shareBase?: string;
}) {
  const wallet = useSessionWallet();
  const qc = useQueryClient();
  const key = ["notes", videoId, wallet ?? null];
  const { data: notes = [], isLoading, error: loadError } = useQuery({
    queryKey: key, queryFn: () => getNotes(videoId), enabled: !!wallet, retry: false,
  });

  const [draft, setDraft] = useState("");
  const [draftAt, setDraftAt] = useState<number | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true); setError(null);
    try { await fn(); await refresh(); if (done) { setFlash(done); setTimeout(() => setFlash(null), 2000); } return true; }
    catch (e) { setError(e instanceof Error ? e.message : "That did not work. Please try again."); return false; }
    finally { setBusy(false); }
  };

  const at = draftAt ?? currentTime;
  const bookmark = () => run(() => addNote(videoId, { kind: "bookmark", atSeconds: Math.floor(currentTime * 10) / 10 }), `Bookmarked ${readableTime(currentTime)}`);
  const saveNote = async () => {
    if (!draft.trim()) return;
    if (await run(() => addNote(videoId, { kind: "note", atSeconds: Math.floor(at * 10) / 10, text: draft }), "Note saved")) { setDraft(""); setDraftAt(null); }
  };
  const saveEdit = async (n: Note) => {
    if (!editing) return;
    if (await run(() => editNote(videoId, n.id, { text: editing.text }))) setEditing(null);
  };
  const exportNotes = () => {
    const base = shareBase ?? (typeof window !== "undefined" ? window.location.origin + window.location.pathname : "");
    downloadFile(toMarkdown(title, notes, (s) => `${base}?t=${Math.floor(s)}`), `${slugify(title)}-notes.md`, "text/markdown");
  };

  return (
    <section className="panel overflow-hidden" aria-label="Your notes">
      <header className="flex items-center gap-3 px-4 h-12 border-b border-rule">
        <h2 className="text-[14px] font-semibold text-paper">Your notes</h2>
        {wallet && notes.length > 0 && <span className="tc">{notes.length}</span>}
        <span className="ml-auto" />
        {flash && <span className="text-[12.5px] text-marker" role="status">{flash}</span>}
        {wallet && notes.length > 0 && (
          <button onClick={exportNotes} className="btn btn-ghost h-8 px-2.5 inline-flex items-center gap-1.5 text-[12.5px] no-min">
            <Download size={12} /> Export
          </button>
        )}
      </header>

      {!wallet ? (
        <div className="p-4 space-y-3">
          <p className="text-[13.5px] text-dim leading-relaxed max-w-[60ch]">
            Sign in to bookmark moments and write notes on this video. Only you can see them.
          </p>
          <WalletButton />
        </div>
      ) : (
        <>
          <div className="p-4 space-y-2.5 border-b border-rule">
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={bookmark} disabled={busy} className="btn btn-ghost h-9 px-3 inline-flex items-center gap-1.5 text-[13px]">
                <Bookmark size={13} /> Bookmark {readableTime(currentTime)}
              </button>
              <span className="text-[12.5px] text-dim">Only you can see your bookmarks and notes.</span>
            </div>
            <label className="sr-only" htmlFor={`note-${videoId}`}>Write a note</label>
            <textarea
              id={`note-${videoId}`}
              value={draft}
              rows={2}
              maxLength={5000}
              onChange={(e) => { if (draftAt === null && e.target.value) setDraftAt(currentTime); setDraft(e.target.value); if (!e.target.value) setDraftAt(null); }}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveNote(); } }}
              placeholder={`Write a note at ${readableTime(currentTime)}`}
              className="w-full px-3 py-2 text-[13.5px] leading-relaxed resize-y"
            />
            {draft.trim() && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[12.5px] text-dim">Pinned to <span className="tc text-paper-2">{readableTime(at)}</span></span>
                <button
                  onClick={() => setDraftAt(currentTime)}
                  aria-label={`Pin the note to ${readableTime(currentTime)}`}
                  title="Pin to the moment the video is at"
                  className="h-7 w-7 flex items-center justify-center rounded border border-rule text-dim hover:text-paper no-min"
                >
                  <Clock size={12} />
                </button>
                <span className="ml-auto" />
                <button onClick={() => { setDraft(""); setDraftAt(null); }} className="btn btn-ghost h-8 px-3 text-[12.5px] no-min">Discard</button>
                <button onClick={saveNote} disabled={busy} className="btn btn-signal h-8 px-3.5 text-[12.5px] no-min">Save note</button>
              </div>
            )}
            {error && <p className="text-[12.5px] text-error" role="alert">{error}</p>}
          </div>

          {isLoading && <p className="px-4 py-4 tc">Loading your notes</p>}
          {loadError && <p className="px-4 py-4 text-[13px] text-error">Your notes could not be loaded. Reload the page to try again.</p>}
          {!isLoading && !loadError && notes.length === 0 && (
            <p className="px-4 py-4 text-[13.5px] text-dim">Nothing yet. Bookmark a moment or write a note as you watch.</p>
          )}

          <ol className="max-h-96 overflow-y-auto">
            {notes.map((n) => {
              const isEditing = editing?.id === n.id;
              return (
                <li key={n.id} className="flex items-start gap-3 px-4 py-2.5 border-b border-rule last:border-0 group">
                  <button onClick={() => onSeek(n.atSeconds)} aria-label={`Play from ${readableTime(n.atSeconds)}`} className="tc tc-signal tabular-nums shrink-0 pt-[3px] w-11 text-left no-min hover:underline">
                    {readableTime(n.atSeconds)}
                  </button>
                  {n.kind === "bookmark"
                    ? <Bookmark size={13} className="text-paper-2 shrink-0 mt-[4px]" aria-label="Bookmark" />
                    : <StickyNote size={13} className="text-paper-2 shrink-0 mt-[4px]" aria-label="Note" />}
                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <div className="space-y-2">
                        <label className="sr-only" htmlFor={`edit-${n.id}`}>Edit</label>
                        <textarea
                          id={`edit-${n.id}`}
                          value={editing.text}
                          rows={n.kind === "note" ? 3 : 1}
                          maxLength={n.kind === "note" ? 5000 : 200}
                          placeholder={n.kind === "bookmark" ? "Label (optional)" : undefined}
                          onChange={(e) => setEditing({ id: n.id, text: e.target.value })}
                          onKeyDown={(e) => { if (e.key === "Escape") setEditing(null); if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveEdit(n); } }}
                          className="w-full px-2.5 py-1.5 text-[13.5px] leading-relaxed resize-y"
                        />
                        <div className="flex gap-2 justify-end">
                          <button onClick={() => setEditing(null)} className="btn btn-ghost h-8 px-3 text-[12.5px] no-min">Cancel</button>
                          <button onClick={() => saveEdit(n)} disabled={busy} className="btn btn-signal h-8 px-3.5 text-[12.5px] no-min">Save</button>
                        </div>
                      </div>
                    ) : (
                      <p className={clsx("text-[13.5px] leading-relaxed whitespace-pre-wrap break-words", n.kind === "bookmark" && !n.text ? "text-dim" : "text-paper-2")}>
                        {n.kind === "bookmark" ? (n.text || "Bookmark") : n.text}
                      </p>
                    )}
                  </div>
                  {!isEditing && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => setEditing({ id: n.id, text: n.text })}
                        aria-label={n.kind === "bookmark" ? `Label the bookmark at ${readableTime(n.atSeconds)}` : `Edit the note at ${readableTime(n.atSeconds)}`}
                        className="h-8 w-8 flex items-center justify-center rounded text-dim hover:text-paper hover:bg-slate-2 no-min"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        onClick={() => run(() => deleteNote(videoId, n.id))}
                        aria-label={`Delete the ${n.kind} at ${readableTime(n.atSeconds)}`}
                        className="h-8 w-8 flex items-center justify-center rounded text-dim hover:text-error hover:bg-slate-2 no-min"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}
