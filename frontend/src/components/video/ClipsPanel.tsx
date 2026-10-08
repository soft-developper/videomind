"use client";
// vm_clips: the owner makes clips of a video and downloads them.
//
//   Quick cut     copied from the original, ready in seconds, up to 10:00
//   Social clip   vertical, square or 16:9, captions drawn in, up to 1:30,
//                 made in the background (minutes on a small server)
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Scissors, Trash2 } from "lucide-react";
import { clsx } from "clsx";
import {
  getClips, makeClip, retryClip, deleteClip, clipDownload, clipCaptions, parseClock, ApiError,
  type ClipInfo, type ClipKind, type ClipFrame,
} from "@/lib/api";
import { downloadFile } from "@/lib/exports";

const clock = (sec: number) => {
  const s = Math.max(0, Math.floor(sec)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
};
function bytes(n: number) {
  if (n < 1024 ** 2) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}
const FRAME_LABEL: Record<ClipFrame, string> = { original: "Original", vertical: "Vertical 9:16", square: "Square 1:1", landscape: "16:9" };

function describe(c: ClipInfo): string {
  const range = `${clock(c.startSeconds)} to ${clock(c.endSeconds)}`;
  if (c.kind === "cut") return `Quick cut, ${range}`;
  return `Social clip, ${FRAME_LABEL[c.frame]}${c.captions ? ", captions" : ""}, ${range}`;
}

export function ClipsPanel({ videoId, currentTime, duration, chapters, onSeek }: {
  videoId: string;
  currentTime: number;
  duration: number;
  chapters?: Array<{ title: string; startSeconds: number }>;
  onSeek: (s: number) => void;
}) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["clips", videoId],
    queryFn: () => getClips(videoId),
    // While a clip is waiting or being made, look again every few seconds.
    refetchInterval: (q) => (q.state.data?.clips.some((c) => c.status === "queued" || c.status === "making") ? 5000 : false),
  });

  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [kind, setKind] = useState<ClipKind>("cut");
  const [frame, setFrame] = useState<Exclude<ClipFrame, "original">>("vertical");
  const [captions, setCaptions] = useState(true);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rowErr, setRowErr] = useState<Record<string, string>>({});

  const marks = useMemo(() => (chapters ?? []).slice().sort((a, b) => a.startSeconds - b.startSeconds), [chapters]);
  const s = parseClock(start), e = parseClock(end);
  const seconds = s != null && e != null ? e - s : null;
  const max = kind === "cut" ? data?.limits.cutSeconds ?? 600 : data?.limits.socialSeconds ?? 90;
  const problem =
    s == null || e == null ? null
    : e <= s ? "The end must come after the start."
    : duration && e > duration + 0.5 ? `The video is ${clock(duration)} long.`
    : seconds! < 1 ? "A clip must be at least a second long."
    : seconds! > max ? `${kind === "cut" ? "A quick cut" : "A social clip"} can be up to ${clock(max)} long.`
    : null;
  useEffect(() => { setErr(null); }, [start, end, kind]);

  const fromChapter = (i: number) => {
    const c = marks[i]; if (!c) return;
    setStart(clock(c.startSeconds));
    setEnd(clock(marks[i + 1]?.startSeconds ?? duration));
    if (!title) setTitle(c.title);
  };

  const make = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (s == null || e == null || problem) { setErr(problem ?? "Give a start and an end, like 1:30."); return; }
    setBusy(true); setErr(null);
    try {
      await makeClip(videoId, { kind, ...(kind === "social" ? { frame, captions } : {}), startSeconds: s, endSeconds: e, title: title.trim() || undefined });
      setTitle("");
      await qc.invalidateQueries({ queryKey: ["clips", videoId] });
    } catch (x: any) {
      setErr(x instanceof ApiError ? x.message : "The clip could not be started. Try again.");
    } finally { setBusy(false); }
  };

  const act = async (c: ClipInfo, what: "download" | "captions" | "retry" | "delete") => {
    setRowErr((m) => ({ ...m, [c.id]: "" }));
    try {
      if (what === "download") {
        const { url } = await clipDownload(videoId, c.id);
        const a = document.createElement("a"); a.href = url; a.rel = "noopener";
        document.body.appendChild(a); a.click(); a.remove();
      } else if (what === "captions") {
        downloadFile(await clipCaptions(videoId, c.id), (c.fileName ?? "clip").replace(/\.[a-z0-9]+$/i, "") + ".srt", "application/x-subrip");
      } else if (what === "retry") {
        await retryClip(videoId, c.id); await qc.invalidateQueries({ queryKey: ["clips", videoId] });
      } else {
        if (!window.confirm(`Delete the clip "${c.title}"?`)) return;
        await deleteClip(videoId, c.id); await qc.invalidateQueries({ queryKey: ["clips", videoId] });
      }
    } catch (x: any) {
      setRowErr((m) => ({ ...m, [c.id]: x instanceof ApiError ? x.message : "That did not work. Try again." }));
    }
  };

  if (!data) return null;
  const field = "w-full h-9 px-2.5 text-[13.5px] tc";

  return (
    <section className="panel" aria-label="Clips">
      <header className="flex items-center gap-2.5 px-5 h-11 border-b border-rule">
        <Scissors size={13} className="text-dim" />
        <span className="text-[14px] font-semibold text-paper">Clips</span>
      </header>

      <div className="px-5 py-4 space-y-5">
        {!data.canMake ? (
          <p className="text-[13.5px] text-dim">This server cannot make clips right now (FFmpeg is missing).</p>
        ) : (
          <form onSubmit={make} className="space-y-3.5" aria-label="Make a clip">
            <div className="grid grid-cols-2 gap-3 max-w-[460px]">
              {([["Start", start, setStart], ["End", end, setEnd]] as const).map(([label, value, set]) => (
                <div key={label}>
                  <label htmlFor={`clip-${label}`} className="block text-[12.5px] text-dim mb-1">{label}</label>
                  <input id={`clip-${label}`} value={value} onChange={(x) => set(x.target.value)} placeholder="m:ss" inputMode="numeric" className={field} />
                  <button type="button" onClick={() => set(clock(currentTime))} className="text-[12.5px] text-paper-2 hover:text-paper underline underline-offset-2 mt-1 no-min">
                    Use {clock(currentTime)}
                  </button>
                </div>
              ))}
            </div>
            {marks.length > 0 && (
              <div className="max-w-[460px]">
                <label htmlFor="clip-chapter" className="block text-[12.5px] text-dim mb-1">Or a whole chapter</label>
                <select id="clip-chapter" defaultValue="" onChange={(x) => { if (x.target.value !== "") fromChapter(Number(x.target.value)); }} className="w-full h-9 px-2 text-[13.5px]">
                  <option value="" disabled>Choose a chapter</option>
                  {marks.map((c, i) => <option key={i} value={i}>{clock(c.startSeconds)} {c.title}</option>)}
                </select>
              </div>
            )}

            <fieldset className="space-y-2">
              <legend className="text-[12.5px] text-dim mb-1">Kind</legend>
              {([
                ["cut", "Quick cut", `Copied as it is. Ready in seconds, up to ${clock(data.limits.cutSeconds)}.`],
                ["social", "Social clip", `Vertical, square or 16:9, with captions drawn in. Up to ${clock(data.limits.socialSeconds)}. Takes several minutes.`],
              ] as const).map(([k, label, note]) => (
                <label key={k} className="flex items-start gap-2.5 cursor-pointer">
                  <input type="radio" name="clip-kind" checked={kind === k} onChange={() => setKind(k)} className="mt-1" />
                  <span>
                    <span className="block text-[13.5px] text-paper">{label}</span>
                    <span className="block text-[12.5px] text-dim">{note}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            {kind === "social" && (
              <div className="space-y-2.5 pl-6">
                <div role="radiogroup" aria-label="Frame" className="flex gap-1.5 flex-wrap">
                  {(["vertical", "square", "landscape"] as const).map((f) => (
                    <button
                      type="button" key={f} role="radio" aria-checked={frame === f} onClick={() => setFrame(f)}
                      className={clsx("h-8 px-3 rounded border text-[13px] no-min", frame === f ? "border-paper text-paper bg-slate-2" : "border-rule text-paper-2 hover:border-rule-lit")}
                    >
                      {FRAME_LABEL[f]}
                    </button>
                  ))}
                </div>
                <label className="flex items-center gap-2 text-[13px] text-paper-2 cursor-pointer">
                  <input type="checkbox" checked={captions && data.captionsDrawn} disabled={!data.captionsDrawn} onChange={(x) => setCaptions(x.target.checked)} />
                  Draw captions into the video
                </label>
                {!data.captionsDrawn && <p className="text-[12.5px] text-dim">This server cannot draw captions yet. The clip's captions can still be downloaded as a file.</p>}
              </div>
            )}

            <div className="max-w-[460px]">
              <label htmlFor="clip-title" className="block text-[12.5px] text-dim mb-1">Title (optional)</label>
              <input id="clip-title" value={title} maxLength={120} onChange={(x) => setTitle(x.target.value)} placeholder="Used for the file name" className="w-full h-9 px-2.5 text-[13.5px]" />
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <button type="submit" disabled={busy || s == null || e == null || !!problem} className="btn btn-ghost h-9 px-3.5">
                {busy ? "Starting" : "Make clip"}
              </button>
              {seconds != null && !problem && <span className="tc">Length {clock(seconds)}</span>}
              {(problem || err) && <span className="text-[13px] text-error" role="alert">{err ?? problem}</span>}
            </div>
          </form>
        )}

        {data.clips.length > 0 && (
          <ul className="border-t border-rule" aria-label="Your clips">
            {data.clips.map((c) => (
              <li key={c.id} className="py-3 border-b border-rule last:border-b-0">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] text-paper truncate">{c.title}</p>
                    <p className="tc mt-0.5">{describe(c)}{c.sizeBytes ? `, ${bytes(c.sizeBytes)}` : ""}</p>
                    <p className={clsx("text-[13px] mt-1", c.status === "failed" ? "text-error" : c.status === "ready" ? "text-paper-2" : "text-dim")} data-clip-status={c.status}>
                      {c.status === "queued" && "Waiting to be made"}
                      {c.status === "making" && (c.kind === "social" ? "Being made. A social clip takes several minutes; you can leave this page." : "Being made")}
                      {c.status === "ready" && "Ready"}
                      {c.status === "failed" && `Could not be made. ${c.error ?? ""}`}
                    </p>
                    {c.note && <p className="text-[12.5px] text-dim mt-1">{c.note}</p>}
                    {rowErr[c.id] && <p className="text-[12.5px] text-error mt-1" role="alert">{rowErr[c.id]}</p>}
                  </div>
                  <button onClick={() => act(c, "delete")} aria-label={`Delete ${c.title}`} className="w-8 h-8 flex items-center justify-center rounded text-dim hover:text-error hover:bg-slate-2 shrink-0 no-min">
                    <Trash2 size={13} />
                  </button>
                </div>
                <div className="flex items-center gap-3 mt-2 flex-wrap text-[13px]">
                  {c.status === "ready" && (
                    <button onClick={() => act(c, "download")} className="btn btn-ghost h-8 px-3 text-[13px]">Download</button>
                  )}
                  {(c.kind === "cut" || c.captions) && (
                    <button onClick={() => act(c, "captions")} className="text-paper-2 hover:text-paper underline underline-offset-2 no-min">Captions (.srt)</button>
                  )}
                  <button onClick={() => onSeek(c.startSeconds)} className="text-paper-2 hover:text-paper underline underline-offset-2 no-min">Play from {clock(c.startSeconds)}</button>
                  {c.status === "failed" && (
                    <button onClick={() => act(c, "retry")} className="text-paper-2 hover:text-paper underline underline-offset-2 no-min">Try again</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
