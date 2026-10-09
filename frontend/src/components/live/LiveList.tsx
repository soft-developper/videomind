"use client";
// vm_live: the signed in wallet's live events, and a new one.
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { WalletButton } from "@/components/layout/WalletButton";
import { useSessionWallet } from "@/components/layout/AuthProvider";
import { getMyLiveEvents, createLiveEvent, ApiError, type LiveEventInfo } from "@/lib/api";

const when = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const STATUS: Record<LiveEventInfo["status"], string> = { scheduled: "Not started", live: "Live now", ended: "Ended" };

export function LiveList() {
  const { connected } = useWallet();
  const wallet = useSessionWallet();
  const router = useRouter();
  const { data, isLoading } = useQuery({ queryKey: ["my-live", wallet ?? null], queryFn: getMyLiveEvents, enabled: !!wallet });
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!connected) return <EmptyState title="Connect a wallet to go live" action={<WalletButton />}>Live events belong to your wallet. Viewers need no wallet to watch.</EmptyState>;
  if (!wallet) return <EmptyState title="Sign in to go live">Your wallet is connected. One signature proves it is yours. The prompt is at the bottom of the page.</EmptyState>;
  if (isLoading || !data) return <p className="text-[14px] text-dim">Loading</p>;
  if (!data.enabled) {
    return (
      <EmptyState title="Live is not set up yet">
        Going live needs a LiveKit project. Its address and keys are set on the server (LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET). Until then you can record on the Record page.
      </EmptyState>
    );
  }

  const create = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { const r = await createLiveEvent(title); router.push(`/live/${r.event.id}/studio`); }
    catch (x: any) { setErr(x instanceof ApiError ? x.message : "The live event could not be created."); setBusy(false); }
  };

  return (
    <div className="max-w-[860px] space-y-8">
      <form onSubmit={create} className="flex items-end gap-2 flex-wrap" aria-label="Create a live event">
        <div className="flex-1 min-w-[220px]">
          <label htmlFor="live-title" className="block text-[13px] font-medium text-paper mb-1.5">New live event</label>
          <input id="live-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="What it is about" className="w-full h-10 px-3 text-[14px]" />
        </div>
        <button type="submit" disabled={busy || !title.trim()} className="btn btn-signal h-10 px-4">{busy ? "Creating" : "Create"}</button>
        {err && <p className="w-full text-[13px] text-error" role="alert">{err}</p>}
      </form>

      {data.events.length > 0 && (
        <ul className="border-t border-rule" aria-label="Your live events">
          {data.events.map((e) => (
            <li key={e.id} className="flex items-center gap-3 py-3 border-b border-rule">
              <span className="flex-1 min-w-0">
                <span className="block text-[14px] text-paper truncate">{e.title}</span>
                <span className="tc block mt-0.5">{STATUS[e.status]}, {when(e.startedAt ?? e.createdAt)}{e.peakViewers ? `, up to ${e.peakViewers} watching` : ""}</span>
              </span>
              {e.status !== "ended"
                ? <Link href={`/live/${e.id}/studio`} className="btn btn-ghost h-9 px-3.5 inline-flex items-center">Open studio</Link>
                : e.videoId
                  ? <Link href={`/video/${e.videoId}`} className="btn btn-ghost h-9 px-3.5 inline-flex items-center">Recording</Link>
                  : <Link href={`/live/${e.id}/studio`} className="text-[13px] text-paper-2 underline underline-offset-2 no-min">Details</Link>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
