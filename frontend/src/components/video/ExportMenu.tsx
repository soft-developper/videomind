"use client";
import { useState, useRef, useEffect } from "react";
import { Download, ChevronDown, Check } from "lucide-react";
import { clsx } from "clsx";
import {
  toSRT, toVTT, toMarkdown, toPlainText, downloadFile, slugify, type Segment,
} from "@/lib/exports";

interface Props {
  title: string;
  transcript?: Segment[];
  summary?: string;
  chapters?: Array<{ title: string; startSeconds: number; summary: string }>;
  highlights?: Array<{ startSeconds: number; endSeconds: number; reason: string; text: string }>;
  tags?: string[];
}

export function ExportMenu(props: Props) {
  const { title, transcript } = props;
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  if (!transcript?.length) return null;
  const slug = slugify(title);

  const flash = () => { setDone(true); setTimeout(() => setDone(false), 1800); setOpen(false); };

  const OPTS = [
    { ext: "srt", note: "subtitles for editors",  run: () => { downloadFile(toSRT(transcript), `${slug}.srt`); flash(); } },
    { ext: "vtt", note: "web video players",       run: () => { downloadFile(toVTT(transcript), `${slug}.vtt`, "text/vtt"); flash(); } },
    { ext: "md",  note: "notes, cuts and quotes",  run: () => { downloadFile(toMarkdown(props), `${slug}.md`, "text/markdown"); flash(); } },
    { ext: "txt", note: "transcript, no timecodes",run: () => { downloadFile(toPlainText(transcript), `${slug}.txt`); flash(); } },
  ];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 h-8 px-3 btn-ghost text-[12px] no-min"
      >
        {done ? <Check size={11} className="text-marker" /> : <Download size={11} />}
        {done ? "Downloaded" : "Export"}
        <ChevronDown size={10} className={clsx("transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 w-56 bg-void border border-rule z-40">
          {OPTS.map(({ ext, note, run }) => (
            <button
              key={ext}
              onClick={run}
              className="w-full flex items-baseline gap-3 px-3 py-2.5 text-left border-b border-rule last:border-0 hover:bg-slate transition-colors no-min"
            >
              <span className="tc tc-signal">.{ext}</span>
              <span className="text-[12px] font-sans text-dim">{note}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
