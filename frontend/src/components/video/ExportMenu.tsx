"use client";
import { useState, useRef, useEffect } from "react";
import { Download, FileText, Captions, FileCode, ChevronDown, CheckCircle } from "lucide-react";
import { clsx } from "clsx";
import {
  toSRT, toVTT, toMarkdown, toPlainText, downloadFile, slugify,
  type Segment,
} from "@/lib/exports";

interface ExportMenuProps {
  title: string;
  transcript?: Segment[];
  summary?: string;
  chapters?: Array<{ title: string; startSeconds: number; summary: string }>;
  highlights?: Array<{ startSeconds: number; endSeconds: number; reason: string; text: string }>;
  tags?: string[];
}

export function ExportMenu(props: ExportMenuProps) {
  const { title, transcript } = props;
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (!transcript?.length) return null;

  const slug = slugify(title);

  const flash = (label: string) => {
    setDone(label);
    setTimeout(() => setDone(null), 2000);
    setOpen(false);
  };

  const OPTIONS = [
    {
      key: "srt",
      label: "Subtitles (.srt)",
      hint: "For video editors & players",
      icon: Captions,
      run: () => { downloadFile(toSRT(transcript), `${slug}.srt`, "text/plain"); flash("srt"); },
    },
    {
      key: "vtt",
      label: "WebVTT (.vtt)",
      hint: "For web video players",
      icon: Captions,
      run: () => { downloadFile(toVTT(transcript), `${slug}.vtt`, "text/vtt"); flash("vtt"); },
    },
    {
      key: "md",
      label: "Full notes (.md)",
      hint: "Summary, chapters, highlights & transcript",
      icon: FileCode,
      run: () => { downloadFile(toMarkdown(props), `${slug}.md`, "text/markdown"); flash("md"); },
    },
    {
      key: "txt",
      label: "Plain text (.txt)",
      hint: "Transcript only, no timestamps",
      icon: FileText,
      run: () => { downloadFile(toPlainText(transcript), `${slug}.txt`, "text/plain"); flash("txt"); },
    },
  ];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-dark-700 border border-white/10 text-xs font-syne font-semibold text-white/60 hover:text-white hover:border-white/20 transition-all"
      >
        {done
          ? <><CheckCircle size={12} className="text-volt" /> Downloaded</>
          : <><Download size={12} /> Export</>
        }
        <ChevronDown size={11} className={clsx("transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-64 glass-card rounded-xl overflow-hidden z-40 shadow-xl shadow-black/40">
          <div className="px-4 py-2.5 border-b border-white/[0.06]">
            <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest">
              Export transcript
            </p>
          </div>
          {OPTIONS.map(({ key, label, hint, icon: Icon, run }) => (
            <button
              key={key}
              onClick={run}
              className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-white/[0.04] transition-all border-b border-white/[0.03] last:border-0"
            >
              <Icon size={13} className="text-volt/60 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-xs font-dm text-white/80">{label}</p>
                <p className="text-[10px] font-mono text-white/25 mt-0.5">{hint}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
