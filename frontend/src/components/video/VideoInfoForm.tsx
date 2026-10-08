"use client";
// vm_info: the details of a video. The same form is used when a video is
// uploaded and when its owner edits it later.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, Lock, Link2, Globe } from "lucide-react";
import { clsx } from "clsx";
import { getCollections, type VideoInfoPatch, type VideoRecord, type Visibility } from "@/lib/api";
import { CATEGORIES, VISIBILITY, MAX_TAGS, MAX_TAG_LENGTH } from "@/lib/categories";
import { useSessionWallet } from "@/components/layout/AuthProvider";

/** Value of the collection field when a new collection is being named. */
const NEW = "__new__";

export interface InfoDraft {
  title: string;
  description: string;
  /** "" means no category */
  category: string;
  /** "" means none, NEW means the name in newCollection, otherwise a collection id */
  collection: string;
  newCollection: string;
  tags: string[];
  visibility: Visibility;
}

export const emptyDraft = (over: Partial<InfoDraft> = {}): InfoDraft => ({
  title: "", description: "", category: "", collection: "", newCollection: "", tags: [], visibility: "private", ...over,
});

export const draftFromVideo = (v: VideoRecord): InfoDraft => ({
  title: v.title, description: v.description ?? "", category: v.category ?? "", collection: v.collection?.id ?? "",
  newCollection: "", tags: v.tags ?? [], visibility: v.visibility ?? "unlisted",
});

/** What to send to the server for this draft. */
export function draftToPatch(d: InfoDraft): VideoInfoPatch {
  const patch: VideoInfoPatch = {
    title: d.title.trim(), description: d.description.trim(), category: d.category || null,
    visibility: d.visibility, tags: d.tags,
  };
  if (d.collection === NEW && d.newCollection.trim()) patch.newCollection = d.newCollection.trim();
  else patch.collectionId = d.collection && d.collection !== NEW ? d.collection : null;
  return patch;
}

export const VISIBILITY_ICON = { private: Lock, unlisted: Link2, public: Globe } as const;

const LABEL = "block text-[13px] font-medium text-paper-2 mb-1.5";

/** Tags as small removable labels, with a box to type the next one. */
function TagInput({ id, tags, onChange }: { id: string; tags: string[]; onChange: (t: string[]) => void }) {
  const [text, setText] = useState("");
  const full = tags.length >= MAX_TAGS;

  const add = (raw: string) => {
    const next = [...tags];
    for (const piece of raw.split(/[,\n]/)) {
      const tag = piece.replace(/\s+/g, " ").trim().replace(/^#+\s*/, "").slice(0, MAX_TAG_LENGTH).trim();
      if (!tag || next.length >= MAX_TAGS) continue;
      if (!next.some((t) => t.toLowerCase() === tag.toLowerCase())) next.push(tag);
    }
    if (next.length !== tags.length) onChange(next);
    setText("");
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 min-h-10 px-2 py-1.5 rounded border border-rule bg-side focus-within:border-dim transition-colors">
        {tags.map((t) => (
          <span key={t.toLowerCase()} className="inline-flex items-center gap-1 h-6 pl-2 pr-1 rounded-full bg-slate-2 text-[12.5px] text-paper-2 max-w-full">
            <span className="truncate">{t}</span>
            <button
              type="button"
              onClick={() => onChange(tags.filter((x) => x !== t))}
              aria-label={`Remove tag ${t}`}
              className="w-4 h-4 flex items-center justify-center rounded-full text-dim hover:text-paper hover:bg-rule-lit no-min"
            >
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={text}
          disabled={full}
          onChange={(e) => (e.target.value.includes(",") ? add(e.target.value) : setText(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); add(text); }
            else if (e.key === "Backspace" && !text && tags.length) onChange(tags.slice(0, -1));
          }}
          onBlur={() => { if (text.trim()) add(text); }}
          placeholder={full ? "" : tags.length ? "Add another" : "blockchain, consensus"}
          aria-describedby={`${id}-hint`}
          className="flex-1 min-w-[120px] h-7 px-1 text-[14px] !bg-transparent !border-0 focus:!outline-none disabled:hidden"
        />
      </div>
      <p id={`${id}-hint`} className="text-[12.5px] text-dim mt-1.5">
        {full ? `${MAX_TAGS} tags is the most a video can have.` : "Press Enter or type a comma after each tag."}
      </p>
    </div>
  );
}

export function VideoInfoForm({ value, onChange, idPrefix = "info", autoFocusTitle = false }: {
  value: InfoDraft;
  onChange: (next: InfoDraft) => void;
  /** keeps field ids apart when two forms could be on one page */
  idPrefix?: string;
  autoFocusTitle?: boolean;
}) {
  const wallet = useSessionWallet();
  const collections = useQuery({
    queryKey: ["collections", wallet],
    queryFn: getCollections,
    enabled: !!wallet,
    staleTime: 10_000,
  });
  const set = <K extends keyof InfoDraft>(k: K, v: InfoDraft[K]) => onChange({ ...value, [k]: v });
  const id = (name: string) => `${idPrefix}-${name}`;
  const list = collections.data ?? [];
  // A collection the video is already in stays selectable while the list loads.
  const known = value.collection === "" || value.collection === NEW || list.some((c) => c.id === value.collection);

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor={id("title")} className={LABEL}>Title</label>
        <input
          id={id("title")}
          value={value.title}
          onChange={(e) => set("title", e.target.value)}
          maxLength={300}
          autoFocus={autoFocusTitle}
          placeholder="What is this recording?"
          className="w-full h-10 px-3 text-[14px]"
        />
      </div>

      <div>
        <label htmlFor={id("description")} className={LABEL}>Description <span className="font-normal text-dim">(optional)</span></label>
        <textarea
          id={id("description")}
          value={value.description}
          onChange={(e) => set("description", e.target.value)}
          rows={3}
          maxLength={5000}
          placeholder="Anything that helps you find it later"
          className="w-full px-3 py-2 text-[14px] resize-y min-h-[76px]"
        />
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor={id("category")} className={LABEL}>Category</label>
          <select
            id={id("category")}
            value={value.category}
            onChange={(e) => set("category", e.target.value)}
            className="w-full h-10 px-2.5 text-[14px]"
          >
            <option value="">No category</option>
            {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>

        <div>
          <label htmlFor={id("collection")} className={LABEL}>Collection</label>
          <select
            id={id("collection")}
            value={value.collection}
            onChange={(e) => onChange({ ...value, collection: e.target.value, newCollection: e.target.value === NEW ? value.newCollection : "" })}
            className="w-full h-10 px-2.5 text-[14px]"
          >
            <option value="">None</option>
            {!known && <option value={value.collection}>Current collection</option>}
            {list.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            <option value={NEW}>New collection</option>
          </select>
          {value.collection === NEW && (
            <div className="mt-2">
              <label htmlFor={id("new-collection")} className="sr-only">Name of the new collection</label>
              <input
                id={id("new-collection")}
                value={value.newCollection}
                onChange={(e) => set("newCollection", e.target.value)}
                maxLength={120}
                autoFocus
                placeholder="Name, for example Blockchain 101"
                className="w-full h-10 px-3 text-[14px]"
              />
            </div>
          )}
          <p className="text-[12.5px] text-dim mt-1.5">A collection groups videos, such as the lectures of one course.</p>
        </div>
      </div>

      <div>
        <label htmlFor={id("tags")} className={LABEL}>Tags <span className="font-normal text-dim">(optional)</span></label>
        <TagInput id={id("tags")} tags={value.tags} onChange={(t) => set("tags", t)} />
      </div>

      <fieldset>
        <legend className={LABEL}>Who can watch</legend>
        <div className="grid gap-2">
          {VISIBILITY.map((o) => {
            const Icon = VISIBILITY_ICON[o.id];
            const on = value.visibility === o.id;
            return (
              <label
                key={o.id}
                className={clsx(
                  "relative flex items-start gap-3 px-3.5 py-3 rounded-md border cursor-pointer transition-colors",
                  on ? "border-rule-lit bg-slate" : "border-rule hover:border-rule-lit"
                )}
              >
                <input
                  type="radio"
                  name={id("visibility")}
                  value={o.id}
                  checked={on}
                  onChange={() => set("visibility", o.id)}
                  className="peer sr-only"
                />
                <span
                  aria-hidden
                  className={clsx(
                    "mt-[3px] w-4 h-4 shrink-0 rounded-full border flex items-center justify-center peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-signal",
                    on ? "border-paper" : "border-dim-2"
                  )}
                >
                  {on && <span className="w-2 h-2 rounded-full bg-paper" />}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-[14px] font-medium text-paper">
                    <Icon size={13} strokeWidth={1.75} className="text-paper-2" /> {o.label}
                  </span>
                  <span className="block text-[13px] text-dim mt-0.5 leading-relaxed">{o.hint}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}
