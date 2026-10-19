"use client";
// vm_info: the facts about a video under its title (who can watch,
// category, collection, tags), and for its owner the form to change them.
import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { clsx } from "clsx";
import { updateVideo, type VideoRecord } from "@/lib/api";
import { useLabels } from "@/lib/categories";
// vm_lang
import { useTranslations } from "next-intl";
import { factsLine } from "@/lib/media";
import { VideoInfoForm, draftFromVideo, draftToPatch, VISIBILITY_ICON, type InfoDraft } from "./VideoInfoForm";

export function VideoDetails({ video, owner }: { video: VideoRecord; owner: boolean }) {
  const td = useTranslations("details");
  const tc = useTranslations("common");
  const labels = useLabels();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<InfoDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const visibility = video.visibility ?? "unlisted";
  const Icon = VISIBILITY_ICON[visibility];
  const category = labels.category(video.category);
  const tags = video.tags ?? [];

  const save = async () => {
    if (!draft || saving) return;
    if (!draft.title.trim()) { setErr(td("titleEmpty")); return; }
    setSaving(true); setErr(null);
    try {
      await updateVideo(video.id, draftToPatch(draft));
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["video", video.id] }),
        qc.invalidateQueries({ queryKey: ["videos"] }),
        qc.invalidateQueries({ queryKey: ["collections"] }),
      ]);
      setDraft(null);
    } catch (e: any) {
      setErr(e?.message ?? td("saveFailed"));
    } finally { setSaving(false); }
  };

  return (
    <div className="mt-3">
      <ul className="flex items-center gap-x-2 gap-y-2 flex-wrap" aria-label={td("label")}>
        {/* Who can watch is the owner's business. Visitors only ever see a video they are allowed to see. */}
        {owner && (
          <li className={clsx("badge", visibility === "private" && "badge-signal")}>
            <Icon size={11} strokeWidth={1.9} /> {labels.visibility(visibility)}
          </li>
        )}
        {category && <li className="badge">{category}</li>}
        {video.collection && (
          <li className="badge" dir="auto">
            {owner
              ? <Link href={`/library/courses/${video.collection.id}`} className="hover:text-paper transition-colors no-min">{video.collection.name}</Link>
              : video.collection.name}
          </li>
        )}
        {tags.map((t) => <li key={t.toLowerCase()} dir="auto" className="text-[12.5px] text-dim">#{t}</li>)}
        {/* vm_media: what the file is, as the server measured it */}
        {factsLine(video.media) && <li className="tc" title={td("factsTitle")} dir="ltr">{factsLine(video.media)}</li>}
        {owner && !draft && (
          <li>
            <button
              onClick={() => { setDraft(draftFromVideo(video)); setErr(null); }}
              className="inline-flex items-center gap-1.5 h-7 px-2 rounded text-[12.5px] text-dim hover:text-paper hover:bg-slate transition-colors no-min"
            >
              <Pencil size={11} /> {td("edit")}
            </button>
          </li>
        )}
      </ul>

      {owner && draft && (
        <section aria-label={td("edit")} className="panel mt-4 p-5 max-w-[680px]">
          <h2 className="font-display text-[15px] text-paper mb-4">{td("edit")}</h2>
          <VideoInfoForm value={draft} onChange={setDraft} idPrefix="edit" />
          {/* Making a video private closes its pages here. It cannot take back a copy already on Shelby. */}
          {draft.visibility === "private" && video.onShelby && (
            <p className="text-[13px] text-warn mt-4 leading-relaxed max-w-[62ch]">
              {td("privateShelby")}
            </p>
          )}
          {err && <p role="alert" className="text-[13.5px] text-error mt-4 leading-relaxed">{err}</p>}
          <div className="flex items-center gap-2.5 mt-5">
            <button onClick={() => void save()} disabled={saving} className="btn btn-signal h-9 px-3.5">
              {saving ? tc("saving") : tc("save")}
            </button>
            <button onClick={() => { setDraft(null); setErr(null); }} disabled={saving} className="btn btn-ghost h-9 px-3.5">
              {tc("cancel")}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
