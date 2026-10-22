"use client";
// vm_reactions (Part 21a): applause, heart, laugh, wow and thumbs up. A viewer
// sends one through the server, which sends it into the room; everyone
// watching and the host see it float up over the picture. Nothing is stored.
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { sendLiveReaction, ApiError } from "@/lib/api";

export const REACTIONS = ["clap", "heart", "laugh", "wow", "up"] as const;
export type Reaction = (typeof REACTIONS)[number];
export const EMOJI: Record<Reaction, string> = { clap: "\u{1F44F}", heart: "❤️", laugh: "\u{1F602}", wow: "\u{1F62E}", up: "\u{1F44D}" };
const MAX_ON_SCREEN = 24;
const COOLDOWN_MS = 400;

/** Buttons to send a reaction. The reaction shows when it comes back through the room. */
export function ReactionBar({ eventId, onSent }: { eventId: string; onSent?: (r: Reaction) => void }) {
  const t = useTranslations("liveWatch");
  const last = useRef(0);
  const [note, setNote] = useState<string | null>(null);
  const send = async (r: Reaction) => {
    if (Date.now() - last.current < COOLDOWN_MS) return;
    last.current = Date.now();
    onSent?.(r);
    try { await sendLiveReaction(eventId, r); setNote(null); }
    catch (e) { if (e instanceof ApiError && e.status === 429) setNote(t("slowDown")); }
  };
  return (
    <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label={t("react")} data-reaction-bar>
      {REACTIONS.map((r) => (
        <button key={r} type="button" onClick={() => void send(r)} aria-label={t(`reaction.${r}`)} title={t(`reaction.${r}`)}
          className="h-9 w-10 rounded-md border border-rule hover:border-rule-lit text-[18px] leading-none inline-flex items-center justify-center no-min" data-reaction={r}>
          <span aria-hidden>{EMOJI[r]}</span>
        </button>
      ))}
      {note && <span className="text-[12.5px] text-dim ms-1" role="status">{note}</span>}
    </div>
  );
}

/** Reactions floating up over the picture. Listens for "reaction" events on the bus. */
export function ReactionLayer({ bus }: { bus: EventTarget }) {
  const [items, setItems] = useState<Array<{ id: number; r: Reaction; x: number }>>([]);
  const n = useRef(0);
  const add = useCallback((r: Reaction) => {
    const id = ++n.current;
    setItems((cur) => [...cur.slice(-(MAX_ON_SCREEN - 1)), { id, r, x: 8 + Math.random() * 18 }]);
    setTimeout(() => setItems((cur) => cur.filter((i) => i.id !== id)), 2600);
  }, []);
  useEffect(() => {
    const on = (e: Event) => { const r = (e as CustomEvent).detail?.kind; if ((REACTIONS as readonly string[]).includes(r)) add(r as Reaction); };
    bus.addEventListener("reaction", on);
    return () => bus.removeEventListener("reaction", on);
  }, [bus, add]);
  return (
    <div className="absolute inset-y-0 end-0 w-1/3 pointer-events-none overflow-hidden z-10" aria-hidden data-reaction-layer>
      {items.map((i) => (
        <span key={i.id} className="vm-react absolute bottom-12 text-[26px] leading-none" style={{ insetInlineEnd: `${i.x}%` }} data-floating={i.r}>{EMOJI[i.r]}</span>
      ))}
    </div>
  );
}
