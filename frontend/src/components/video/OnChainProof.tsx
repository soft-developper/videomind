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
// vm_lang
import { useTranslations } from "next-intl";
import { useFormat } from "@/lib/format";

function shorten(v: string, head = 10, tail = 8) {
  if (!v) return "";
  return v.length > head + tail + 3 ? `${v.slice(0, head)}…${v.slice(-tail)}` : v;
}
// vm_lang: chip and history wording are message keys under "proof.chip" and "proof.state".
const STATE: Record<AnchorState, { dot: string; tone: string }> = {
  checking:   { dot: "dot-work", tone: "text-paper-2" },
  anchored:   { dot: "dot-live", tone: "tc-marker" },
  lapsed:     { dot: "dot-dead", tone: "text-warn" },
  missing:    { dot: "dot-dead", tone: "text-warn" },
  unverified: { dot: "dot-dead", tone: "text-error" },
};

function CopyBtn({ value }: { value: string }) {
  const tp = useTranslations("proof");
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={(e) => { e.preventDefault(); navigator.clipboard.writeText(value).catch(() => {}); setDone(true); setTimeout(() => setDone(false), 1600); }}
      className="text-dim-2 hover:text-paper transition-colors shrink-0 no-min"
      aria-label={tp("copyValue")}
      title={tp("copyValue")}
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
          <a href={href} target="_blank" rel="noopener noreferrer" dir={mono ? "ltr" : undefined} className={clsx("truncate hover:text-signal transition-colors group inline-flex items-center gap-1.5", cls)}>
            {value}
            <ExternalLink size={9} className="text-dim-2 group-hover:text-signal shrink-0" />
          </a>
        ) : (
          <span dir={mono ? "ltr" : undefined} className={clsx("truncate", cls)}>{value}</span>
        )}
        {copy && <CopyBtn value={copy} />}
      </span>
    </div>
  );
}

function Shell({ state, children }: { state?: AnchorState; children: React.ReactNode }) {
  const tp = useTranslations("proof");
  const s = state ? STATE[state] : null;
  return (
    <section className="panel" aria-label={tp("title")}>
      <header className="flex items-center gap-2.5 px-5 h-11 border-b border-rule">
        <ShieldCheck size={13} className={state === "anchored" ? "text-marker" : "text-dim"} />
        <span className="text-[14px] font-semibold text-paper">{tp("title")}</span>
        {s && (
          <span className="ms-auto flex items-center gap-1.5" data-anchor-state={state}>
            <span className={clsx("dot", s.dot)} />
            <span className={clsx("tc", s.tone)}>{tp(`chip.${state!}`)}</span>
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
  const tp = useTranslations("proof");
  const fmt = useFormat();
  const when = (ms: number) => fmt.date(ms, { dateStyle: "medium", timeStyle: "short" });
  const day = (ms: number) => fmt.date(ms, { dateStyle: "medium" });
  const timeLeft = (ms: number) => {
    const left = ms - Date.now();
    if (left <= 0) return { text: tp("ended"), danger: true };
    const d = Math.floor(left / 86_400_000), h = Math.floor((left % 86_400_000) / 3_600_000);
    return { text: d > 0 ? tp("daysLeft", { count: d }) : tp("hoursLeft", { count: h }), danger: d < 3 };
  };
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
    catch (e: any) { setErr(e instanceof ApiError ? e.message : tp("checkFailed")); }
    finally { setBusy(false); }
  };

  if (isLoading || !data) return null;

  // Never stored
  if (!cur) {
    if (!isOwner || !storeHref) return null;
    return (
      <Shell>
        <div className="px-5 py-4">
          <p className="text-[14px] text-paper">{tp("notStored")}</p>
          <p className="text-[13.5px] text-dim mt-1 leading-relaxed max-w-[60ch]">
            {tp("notStoredBody")}
          </p>
          <a href={storeHref} className="btn btn-ghost h-9 px-3.5 inline-flex items-center mt-4">{tp("store")}</a>
        </div>
      </Shell>
    );
  }

  const first = data.history.find((a) => a.commitment);
  const earlier = data.history.slice(0, -1).reverse();
  const stillPlays = tp("stillPlays");

  return (
    <Shell state={cur.state}>
      <div className="px-5 py-3 space-y-3">
        {cur.state === "checking" && (
          <p className="text-[13.5px] text-paper-2 leading-relaxed max-w-[62ch]">
            {isOwner
              ? tp("checkingOwner")
              : tp("checking")}
          </p>
        )}
        {cur.state === "lapsed" && (
          <p className="text-[13.5px] text-paper-2 leading-relaxed max-w-[62ch]">
            {cur.paidUntil ? tp("lapsedOn", { date: day(cur.paidUntil) }) : tp("lapsed")} {stillPlays}
            {isOwner ? ` ${tp("renew")}` : ""}
          </p>
        )}
        {cur.state === "missing" && (
          <p className="text-[13.5px] text-paper-2 leading-relaxed max-w-[62ch]">
            {tp("missing")} {stillPlays}
            {isOwner ? ` ${tp("again")}` : ""}
          </p>
        )}
        {cur.state === "unverified" && (
          <p className="text-[13.5px] text-paper-2 leading-relaxed max-w-[62ch]">
            {tp("unverified")}{isOwner && cur.error ? ` ${cur.error}` : ""}
          </p>
        )}

        {verified && (
          <div>
            <Row label={tp("row.owner")} value={shorten(cur.wallet)} href={explorer.account(cur.wallet)} copy={cur.wallet} />
            {cur.blobUid && <Row label={tp("row.blob")} value={cur.blobUid} copy={cur.blobUid} />}
            {cur.commitment && <Row label={tp("row.commitment")} value={shorten(cur.commitment)} copy={cur.commitment} />}
            {cur.sizeBytes != null && <Row label={tp("row.size")} value={fmt.bytes(cur.sizeBytes)} />}
            {cur.committedAt != null && <Row label={tp("row.committed")} value={when(cur.committedAt)} mono={false} />}
            {cur.paidUntil != null && (
              <Row
                label={tp("row.paidUntil")}
                mono={false}
                value={<span className={timeLeft(cur.paidUntil).danger ? "text-warn" : ""}>{when(cur.paidUntil)} · {timeLeft(cur.paidUntil).text}</span>}
              />
            )}
            {live.data?.slice_address && <Row label={tp("row.slice")} value={shorten(live.data.slice_address)} href={explorer.object(live.data.slice_address)} copy={live.data.slice_address} />}
            <Row label={tp("row.contract")} value={shorten(SHELBY_DEPLOYER)} href={explorer.account(SHELBY_DEPLOYER)} copy={SHELBY_DEPLOYER} />
            <Row label={tp("row.object")} value={shorten(cur.objectName, 16, 20)} copy={cur.objectName} />
            <Row
              label={tp("row.browser")}
              mono={false}
              value={live.isLoading ? tp("browser.reading") : live.isError ? tp("browser.unreachable") : live.data ? tp("browser.found") : tp("browser.notFound")}
            />
            {isOwner && cur.error && <p className="text-[12.5px] text-warn mt-2">{cur.error}</p>}
          </div>
        )}

        {data.history.length > 1 && cur.sameAsFirst !== null && first && first.id !== cur.id && (
          <p className={clsx("text-[13px]", cur.sameAsFirst ? "text-paper-2" : "text-warn")}>
            {cur.sameAsFirst
              ? tp("same", { date: day(first.createdAt) })
              : tp("different", { date: day(first.createdAt) })}
          </p>
        )}

        {isOwner && (
          <div className="flex items-center gap-2 flex-wrap pt-1">
            {data.canStoreAgain && storeHref && (
              <a href={storeHref} className="btn btn-ghost h-9 px-3.5 inline-flex items-center">{tp("storeAgain")}</a>
            )}
            {cur.state !== "checking" && (
              <button onClick={checkNow} disabled={busy} className="btn btn-ghost h-9 px-3.5">
                {busy ? tp("checkingNow") : tp("checkAgain")}
              </button>
            )}
          </div>
        )}
        {err && <p className="text-[13px] text-error" role="alert">{err}</p>}

        {earlier.length > 0 && (
          <details className="pt-1">
            <summary className="text-[13px] text-dim hover:text-paper cursor-pointer select-none">{tp("earlier", { count: earlier.length })}</summary>
            <ul className="mt-2 space-y-1.5" aria-label={tp("earlierLabel")}>
              {earlier.map((a: AnchorInfo) => (
                <li key={a.id} className="flex items-baseline gap-3 text-[13px]">
                  <span className="text-paper-2 w-28 shrink-0">{day(a.createdAt)}</span>
                  <span className="text-dim flex-1 min-w-0 truncate">{tp(`state.${a.state}`)}</span>
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
            {tp("footer")}
          </p>
        </footer>
      )}
    </Shell>
  );
}
