"use client";
// vm_livechat: the chat beside a live event, for viewers and for the host.
//
// Messages are sent to the server, which checks and keeps them and sends
// them to everyone in the room. New messages come in through the room
// (`bus`), and the list is also read again now and then, so nothing is
// missed after a reconnection. The newest message is at the top and the
// list never scrolls by itself.
import { useCallback, useEffect, useRef, useState } from "react";
import { BadgeCheck, Ban, Trash2 } from "lucide-react";
import { clsx } from "clsx";
import {
  joinLiveChat, getLiveChat, sendLiveChat, deleteLiveChat, blockLiveChat, ApiError,
  type ChatMessageInfo, type ChatMode, type ChatPassInfo, type LiveStatus,
} from "@/lib/api";
import { getSession } from "@/lib/session";

const MAX = 300;
const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const passKey = (id: string) => `vm.livechat.${id}`;
function readPass(id: string): ChatPassInfo | null {
  try { const v = sessionStorage.getItem(passKey(id)); return v ? JSON.parse(v) : null; } catch { return null; }
}
function keepPass(id: string, p: ChatPassInfo | null) {
  try { if (p) sessionStorage.setItem(passKey(id), JSON.stringify(p)); else sessionStorage.removeItem(passKey(id)); } catch { /* private mode */ }
}

export function LiveChat({ eventId, status, chatMode, owner, bus, className }: {
  eventId: string;
  status: LiveStatus;
  chatMode: ChatMode;
  owner: boolean;
  /** Messages from the room: dispatches "chat" events whose detail is the message body. */
  bus: EventTarget;
  className?: string;
}) {
  const [messages, setMessages] = useState<ChatMessageInfo[]>([]);
  const [pass, setPass] = useState<ChatPassInfo | null>(null);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const gone = useRef(new Set<string>());

  useEffect(() => { setPass(readPass(eventId)); setSignedIn(!!getSession()); }, [eventId]);

  const merge = useCallback((list: ChatMessageInfo[]) => {
    setMessages((cur) => {
      const byId = new Map(cur.map((m) => [m.id, m]));
      for (const m of list) if (!gone.current.has(m.id)) byId.set(m.id, m);
      return Array.from(byId.values()).sort((a, b) => b.at - a.at).slice(0, 300);
    });
  }, []);

  const reload = useCallback(async () => {
    try {
      const r = await getLiveChat(eventId);
      setMessages(r.messages.filter((m) => !gone.current.has(m.id)).sort((a, b) => b.at - a.at));
    } catch { /* the next read will do */ }
  }, [eventId]);

  // The list: read now, then again every so often; the host more often, to catch every message to moderate.
  useEffect(() => {
    void reload();
    if (status !== "live") return;
    const t = setInterval(() => { void reload(); }, owner ? 5000 : 20000);
    return () => clearInterval(t);
  }, [reload, status, owner]);

  // New messages and deletions from the room.
  useEffect(() => {
    const on = (e: Event) => {
      const body = (e as CustomEvent).detail;
      if (body?.type === "message" && body.message) merge([body.message]);
      if (body?.type === "delete" && Array.isArray(body.ids)) {
        for (const id of body.ids) gone.current.add(id);
        setMessages((cur) => cur.filter((m) => !body.ids.includes(m.id)));
      }
    };
    bus.addEventListener("chat", on);
    return () => bus.removeEventListener("chat", on);
  }, [bus, merge]);

  // The host is in the chat as soon as the event is live.
  useEffect(() => {
    if (!owner || status !== "live" || pass?.host) return;
    joinLiveChat(eventId).then((p) => { keepPass(eventId, p); setPass(p); }).catch(() => {});
  }, [owner, status, pass, eventId]);

  const fail = (x: unknown) => {
    if (x instanceof ApiError && ["join_needed", "wallet_needed", "blocked"].includes(x.code ?? "")) { keepPass(eventId, null); setPass(null); }
    setErr(x instanceof ApiError ? x.message : "That did not work. Try again.");
  };

  const join = async (ev: React.FormEvent) => {
    ev.preventDefault(); setErr(null); setBusy(true);
    try { const p = await joinLiveChat(eventId, name.trim() || undefined); keepPass(eventId, p); setPass(p); }
    catch (x) { fail(x); }
    finally { setBusy(false); }
  };
  const send = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!pass || !text.trim()) return;
    setErr(null); setBusy(true);
    try { const r = await sendLiveChat(eventId, pass.token, text); merge([r.message]); setText(""); }
    catch (x) { fail(x); }
    finally { setBusy(false); }
  };
  const remove = async (m: ChatMessageInfo, block: boolean) => {
    if (block && !window.confirm(`Block ${m.name} from this chat? Everything they wrote is removed.`)) return;
    setErr(null);
    try {
      if (block) { await blockLiveChat(eventId, m.id); await reload(); }
      else { await deleteLiveChat(eventId, m.id); gone.current.add(m.id); setMessages((cur) => cur.filter((x) => x.id !== m.id)); }
    } catch (x) { fail(x); }
  };

  const canWrite = status === "live" && !!pass && (pass.host || chatMode === "anyone" || (chatMode === "wallets" && signedIn));
  let note: string | null = null;
  if (status === "scheduled") note = "The chat opens when the event starts.";
  else if (status === "ended") note = messages.length ? "The chat is closed." : null;
  else if (!owner && chatMode === "off") note = "The host has turned the chat off.";
  else if (!owner && chatMode === "wallets" && !signedIn) note = "Only signed in wallets can write here. Sign in on VideoMind with a wallet, then come back to this page.";

  return (
    <section className={clsx("panel flex flex-col min-h-0", className)} aria-label="Live chat">
      <header className="flex items-center justify-between gap-2 px-4 h-11 border-b border-rule shrink-0">
        <span className="text-[14px] font-semibold text-paper">Chat</span>
        {pass && status === "live" && <span className="tc truncate" data-chat-as>as {pass.name}</span>}
      </header>

      <div className="px-4 py-3 border-b border-rule space-y-2 shrink-0">
        {note && <p className="text-[13px] text-dim" data-chat-note>{note}</p>}
        {status === "live" && !pass && !note && (
          <form onSubmit={join} className="flex gap-2" aria-label="Join the chat">
            <input
              value={name} onChange={(e) => setName(e.target.value)} maxLength={30}
              placeholder={signedIn ? "Name (optional)" : "Your name"} aria-label="Your name in the chat"
              className="flex-1 min-w-0 h-9 px-2.5 text-[13.5px]"
            />
            <button type="submit" disabled={busy || (!signedIn && !name.trim())} className="btn btn-ghost h-9 px-3 shrink-0">Join chat</button>
          </form>
        )}
        {status === "live" && !pass && !note && (
          <p className="text-[12px] text-dim">By joining, you agree to the <a href="/legal/terms" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-paper">Terms of Service</a>.</p>
        )}
        {canWrite && (
          <form onSubmit={send} className="space-y-1.5" aria-label="Write a message">
            <div className="flex gap-2">
              <input
                value={text} onChange={(e) => setText(e.target.value)} maxLength={MAX}
                placeholder="Say something" aria-label="Message"
                className="flex-1 min-w-0 h-9 px-2.5 text-[13.5px]"
              />
              <button type="submit" disabled={busy || !text.trim()} className="btn btn-signal h-9 px-3.5 shrink-0">Send</button>
            </div>
            {text.length > MAX - 50 && <p className="tc">{MAX - text.length} characters left</p>}
          </form>
        )}
        {err && <p className="text-[12.5px] text-error" role="alert">{err}</p>}
      </div>

      <ul className="flex-1 min-h-[160px] overflow-y-auto px-4 py-2 space-y-2.5" aria-label="Chat messages">
        {messages.map((m) => (
          <li key={m.id} className="group text-[13.5px] leading-snug" data-chat-message>
            <div className="flex items-baseline gap-1.5 flex-wrap">
              <span className={clsx("font-medium", m.host ? "text-signal" : "text-paper")}>{m.name}</span>
              {m.host && m.name.trim().toLowerCase() !== "host" && <span className="text-[11px] uppercase tracking-wide text-signal">Host</span>}
              {m.wallet && !m.host && <BadgeCheck size={12} className="text-dim" aria-label="Signed in with a wallet" />}
              <span className="tc">{time(m.at)}</span>
              {owner && !m.host && status === "live" && (
                <span className="ml-auto flex gap-1">
                  <button onClick={() => void remove(m, false)} aria-label={`Delete the message from ${m.name}`} className="w-7 h-7 flex items-center justify-center rounded text-dim hover:text-error hover:bg-slate-2 no-min"><Trash2 size={12} /></button>
                  <button onClick={() => void remove(m, true)} aria-label={`Block ${m.name}`} className="w-7 h-7 flex items-center justify-center rounded text-dim hover:text-error hover:bg-slate-2 no-min"><Ban size={12} /></button>
                </span>
              )}
            </div>
            <p className="text-paper-2 whitespace-pre-wrap break-words">{m.text}</p>
          </li>
        ))}
        {!messages.length && status !== "scheduled" && <li className="text-[13px] text-dim">No messages yet.</li>}
      </ul>
    </section>
  );
}
