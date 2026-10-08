"use client";
// vm_anchors: the Ownership panel. It shows what the server confirmed
// on the Shelby chain for the newest store of this video (checking,
// verified, paid period ended, no longer on Shelby, not confirmed), the
// identifiers anyone can look up on the Aptos Explorer, whether a later
// store is the same file as the first, and every earlier store. The owner
// can store the video again or ask for a fresh check.
//
// A live read from the browser (vm_shelby09c, see src/lib/onchain.ts)
// still runs for a verified store, so a visitor's own browser checks the
// chain too.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { clsx } from "clsx";
import { ExternalLink, Copy, Check, ShieldCheck } from "lucide-react";
import { useOnChainBlob } from "@/hooks/useOnChainBlob";
import { explorer, SHELBY_DEPLOYER } from "@/lib/explorer";
import { getAnchors, checkAnchorsNow, ApiError, type AnchorInfo, type AnchorState } from "@/lib/api";

function shorten(v: string, head = 10, tail = 8) {
  if (!v) return "";
  return v.length > head + tail + 3 ? `${v.slice(0, head)}…${v.slice(-tail)}` : v;
}
function bytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(2)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
const when = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { dateStyle: "medium" });
function timeLeft(ms: number) {
  const left = ms - Date.now();
  if (left <= 0) return { text: "ended", danger: true };
  const d = Math.floor(left / 86_400_000), h = Math.floor((left % 86_400_000) / 3_600_000);
  return { text: d > 0 ? `${d} days left` : `${h} hours left`, danger: d < 3 };
}

const STATE: Record<AnchorState, { chip: string; dot: string; tone: string }> = {
  checking:   { chip: "Confirming on Shelby",   dot: "dot-work", tone: "text-paper-2" },
  anchored:   { chip: "Verified on shelbynet",  dot: "dot-live", tone: "tc-marker" },
  lapsed:     { chip: "Paid period ended",      dot: "dot-dead", tone: "text-warn" },
  missing:    { chip: "No longer on Shelby",    dot: "dot-dead", tone: "text-warn" },
  unverified: { chip: "Not confirmed",          dot: "dot-dead", tone: "text-error" },
};
const LABEL: Record<AnchorState, string> = {
  checking: "Confirming", anchored: "Verified", lapsed: "Paid period ended", missing: "No longer on Shelby", unverified: "Not confirmed",
};

function CopyBtn({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={(e) => { e.preventDefault(); navigator.clipboard.writeText(value).catch(() => {}); setDone(true); setTimeout(() => setDone(false), 1600); }}
      className="text-dim-2 hover:text-paper transition-colors shrink-0 no-min"
      aria-label="Copy the full value"
      title="Copy the full value"
    >
      {done ? <Check size={10} className="text-marker" /> : <Copy size={10} />}
    </button>
  );
}

function Row({ label, value, href, mono = true, copy }: { label: string; value: React.ReactNode; href?: string; mono?: boolean; copy?: string }) {
  const cls = mono ? "tc text-paper-2" : "text-[13px] font-sans text-paper-2";
  return (
    <div className="flex items-baseline gap-3 py-2 border-t border-rule first:border-t-0">
      <span className="eyebrow shrink-0 w-28 sm:w-32">{label}</span>
      <span className="flex-1 min-w-0 flex items-center gap-2">
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className={clsx("truncate hover:text-signal transition-colors group inline-flex items-center gap-1.5", cls)}>
            {value}
            <ExternalLink size={9} className="text-dim-2 group-hover:text-signal shrink-0" />
          </a>
        ) : (
          <span className={clsx("truncate", cls)}>{value}</span>
        )}
        {copy && <CopyBtn value={copy} />}
      </span>
    </div>
  );
}

function Shell({ state, children }: { state?: AnchorState; children: React.ReactNode }) {
  const s = state ? STATE[state] : null;
  return (
    <section className="panel" aria-label="Ownership">
      <header className="flex items-center gap-2.5 px-5 h-11 border-b border-rule">
        <ShieldCheck size={13} className={state === "anchored" ? "text-marker" : "text-dim"} />
        <span className="text-[14px] font-semibold text-paper">Ownership</span>
        {s && (
          <span className="ml-auto flex items-center gap-1.5" data-anchor-state={state}>
            <span className={clsx("dot", s.dot)} />
            <span className={clsx("tc", s.tone)}>{s.chip}</span>
          </span>
        )}
      </header>
      {children}
    </section>
  );
}

export function OnChainProof({ videoId, isOwner, storeHref }: {
  videoId: string;
  isOwner: boolean;
  /** where the owner goes to store the file on Shelby */
  storeHref?: string;
}) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["anchors", videoId],
    queryFn: () => getAnchors(videoId),
    retry: 1,
    // While a store is being confirmed, look again every few seconds.
    refetchInterval: (q) => (q.state.data?.current?.state === "checking" ? 8000 : false),
  });
  const cur = data?.current ?? null;
  const verified = cur && (cur.state === "anchored" || cur.state === "lapsed");
  const live = useOnChainBlob(verified ? cur.wallet : undefined, verified ? cur.blobName : undefined);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const checkNow = async () => {
    setBusy(true); setErr(null);
    try { qc.setQueryData(["anchors", videoId], await checkAnchorsNow(videoId)); }
    catch (e: any) { setErr(e instanceof ApiError ? e.message : "The check did not go through. Try again in a minute."); }
    finally { setBusy(false); }
  };

  if (isLoading || !data) return null;

  // Never stored
  if (!cur) {
    if (!isOwner || !storeHref) return null;
    return (
      <Shell>
        <div className="px-5 py-4">
          <p className="text-[14px] text-paper">Not stored on Shelby yet</p>
          <p className="text-[13.5px] text-dim mt-1 leading-relaxed max-w-[60ch]">
            The video is in your library and plays normally. Storing it on Shelby signs it with your wallet and gives it a proof anyone can check.
          </p>
          <a href={storeHref} className="btn btn-ghost h-9 px-3.5 inline-flex items-center mt-4">Store on Shelby</a>
        </div>
      </Shell>
    );
  }

  const first = data.history.find((a) => a.commitment);
  const earlier = data.history.slice(0, -1).reverse();
  const stillPlays = "The video still plays from VideoMind.";

  return (
    <Shell state={cur.state}>
      <div className="px-5 py-3 space-y-3">
        {cur.state === "checking" && (
          <p className="text-[13.5px] text-paper-2 leading-relaxed max-w-[62ch]">
            {isOwner
              ? "Your wallet stored the file. VideoMind is confirming it on the Shelby chain, which can take a few minutes."
              : "This video was just stored on Shelby and is being confirmed on the chain."}
          </p>
        )}
        {cur.state === "lapsed" && (
          <p className="text-[13.5px] text-paper-2 leading-relaxed max-w-[62ch]">
            The storage paid for on Shelby ended{cur.paidUntil ? ` on ${day(cur.paidUntil)}` : ""}. {stillPlays}
            {isOwner ? " Store it again to renew the proof." : ""}
          </p>
        )}
        {cur.state === "missing" && (
          <p className="text-[13.5px] text-paper-2 leading-relaxed max-w-[62ch]">
            Shelby no longer has this file. shelbynet is a test network that is reset about once a week, which removes what is stored on it. {stillPlays}
            {isOwner ? " Store it again for a new proof." : ""}
          </p>
        )}
        {cur.state === "unverified" && (
          <p className="text-[13.5px] text-paper-2 leading-relaxed max-w-[62ch]">
            VideoMind could not confirm this store on the Shelby chain.{isOwner && cur.error ? ` ${cur.error}` : ""}
          </p>
        )}

        {verified && (
          <div>
            <Row label="Owner" value={shorten(cur.wallet)} href={explorer.account(cur.wallet)} copy={cur.wallet} />
            {cur.blobUid && <Row label="Blob UID" value={cur.blobUid} copy={cur.blobUid} />}
            {cur.commitment && <Row label="Commitment" value={shorten(cur.commitment)} copy={cur.commitment} />}
            {cur.sizeBytes != null && <Row label="Size on chain" value={bytes(cur.sizeBytes)} />}
            {cur.committedAt != null && <Row label="Committed" value={when(cur.committedAt)} mono={false} />}
            {cur.paidUntil != null && (
              <Row
                label="Paid until"
                mono={false}
                value={<span className={timeLeft(cur.paidUntil).danger ? "text-warn" : ""}>{when(cur.paidUntil)} · {timeLeft(cur.paidUntil).text}</span>}
              />
            )}
            {live.data?.slice_address && <Row label="Storage slice" value={shorten(live.data.slice_address)} href={explorer.object(live.data.slice_address)} copy={live.data.slice_address} />}
            <Row label="Contract" value={shorten(SHELBY_DEPLOYER)} href={explorer.account(SHELBY_DEPLOYER)} copy={SHELBY_DEPLOYER} />
            <Row label="Object name" value={shorten(cur.objectName, 16, 20)} copy={cur.objectName} />
            <Row
              label="Your browser"
              mono={false}
              value={live.isLoading ? "Reading the chain…" : live.isError ? "Could not reach the chain just now" : live.data ? "Found it on the chain too" : "Did not find it just now"}
            />
            {isOwner && cur.error && <p className="text-[12.5px] text-warn mt-2">{cur.error}</p>}
          </div>
        )}

        {data.history.length > 1 && cur.sameAsFirst !== null && first && first.id !== cur.id && (
          <p className={clsx("text-[13px]", cur.sameAsFirst ? "text-paper-2" : "text-warn")}>
            {cur.sameAsFirst
              ? `Same file as the first store on ${day(first.createdAt)} (the commitments match).`
              : `Not the same file as the first store on ${day(first.createdAt)} (the commitments differ).`}
          </p>
        )}

        {isOwner && (
          <div className="flex items-center gap-2 flex-wrap pt-1">
            {data.canStoreAgain && storeHref && (
              <a href={storeHref} className="btn btn-ghost h-9 px-3.5 inline-flex items-center">Store on Shelby again</a>
            )}
            {cur.state !== "checking" && (
              <button onClick={checkNow} disabled={busy} className="btn btn-ghost h-9 px-3.5">
                {busy ? "Checking…" : "Check again"}
              </button>
            )}
          </div>
        )}
        {err && <p className="text-[13px] text-error" role="alert">{err}</p>}

        {earlier.length > 0 && (
          <details className="pt-1">
            <summary className="text-[13px] text-dim hover:text-paper cursor-pointer select-none">Earlier stores ({earlier.length})</summary>
            <ul className="mt-2 space-y-1.5" aria-label="Earlier stores">
              {earlier.map((a: AnchorInfo) => (
                <li key={a.id} className="flex items-baseline gap-3 text-[13px]">
                  <span className="text-paper-2 w-28 shrink-0">{day(a.createdAt)}</span>
                  <span className="text-dim flex-1 min-w-0 truncate">{LABEL[a.state]}</span>
                  {a.commitment && <span className="tc">{shorten(a.commitment, 6, 4)}</span>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {verified && (
        <footer className="px-5 py-3 border-t border-rule">
          <p className="tc leading-relaxed">
            VideoMind read these values from the shelbynet object index and the Shelby contract, and your browser checked the chain again. Storage is prepaid in payment epochs when the file is stored; Paid until is worked out from them. Anyone can look the owner and the contract up on the Aptos Explorer.
          </p>
        </footer>
      )}
    </Shell>
  );
}
