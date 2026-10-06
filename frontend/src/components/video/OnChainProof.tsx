"use client";
// vm_shelby09c: rebuilt for the object index + contract views (sdk 0.8+).
// On-chain verification panel - proves this specific video is stored on
// Shelby, with every identifier linking to the Aptos Explorer.
import { useOnChainBlob, toObjectName } from "@/hooks/useOnChainBlob";
import { explorer, SHELBY_DEPLOYER } from "@/lib/explorer";
import { ExternalLink, Copy, Check, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { clsx } from "clsx";

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

/** chain timestamps are microseconds */
function whenMicros(us: number) {
  return new Date(us / 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** time left until a microsecond timestamp; warns inside the last 3 days */
function timeLeft(us: number) {
  const ms = us / 1000 - Date.now();
  if (ms <= 0) return { text: "payment period ended", danger: true };
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const text = d > 0 ? `${d}d ${h}h left` : h > 0 ? `${h}h ${m}m left` : `${m}m left`;
  return { text, danger: d < 3 };
}

/** "CommittedObject" -> "Committed object" */
function stateLabel(state: string) {
  const words = state.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function CopyBtn({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.preventDefault();
        navigator.clipboard.writeText(value);
        setDone(true);
        setTimeout(() => setDone(false), 1600);
      }}
      className="text-dim-2 hover:text-paper transition-colors shrink-0 no-min"
      title="Copy full value"
    >
      {done ? <Check size={10} className="text-marker" /> : <Copy size={10} />}
    </button>
  );
}

function Row({
  label, value, href, mono = true, copy,
}: {
  label: string;
  value: React.ReactNode;
  href?: string;
  mono?: boolean;
  copy?: string;
}) {
  return (
    <div className="flex items-baseline gap-3 py-2 border-t border-rule first:border-t-0">
      <span className="eyebrow shrink-0 w-32">{label}</span>
      <span className="flex-1 min-w-0 flex items-center gap-2">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={clsx(
              "truncate hover:text-signal transition-colors group inline-flex items-center gap-1.5",
              mono ? "tc text-paper-2" : "text-[13px] font-sans text-paper-2"
            )}
          >
            {value}
            <ExternalLink size={9} className="text-dim-2 group-hover:text-signal shrink-0" />
          </a>
        ) : (
          <span className={clsx("truncate", mono ? "tc text-paper-2" : "text-[13px] font-sans text-paper-2")}>
            {value}
          </span>
        )}
        {copy && <CopyBtn value={copy} />}
      </span>
    </div>
  );
}

export function OnChainProof({
  owner, blobName,
}: {
  owner?: string;
  blobName?: string;
}) {
  const { data, isLoading, isError, error } = useOnChainBlob(owner, blobName);

  if (!owner || !blobName) return null;

  return (
    <section className="panel">
      <header className="flex items-center gap-2.5 px-5 h-11 border-b border-rule">
        <ShieldCheck size={13} className={data?.is_committed ? "text-marker" : "text-dim"} />
        <span className="eyebrow">On-chain proof</span>
        {data?.is_committed && (
          <span className="ml-auto flex items-center gap-1.5">
            <span className="dot dot-live" />
            <span className="tc tc-marker">Verified on shelbynet</span>
          </span>
        )}
      </header>

      <div className="px-5 py-3">
        {isLoading && (
          <p className="tc py-3">Reading chain state…</p>
        )}

        {isError && (
          <p className="tc text-error/70 py-3">
            Could not reach the indexer: {(error as Error)?.message}
          </p>
        )}

        {!isLoading && !isError && !data && (
          <p className="tc py-3">
            Not found on-chain - the blob may still be committing, or it is no longer stored.
          </p>
        )}

        {data && (
          <>
            <Row
              label="Blob UID"
              value={String(data.uid)}
              copy={String(data.uid)}
            />
            <Row
              label="Owner"
              value={shorten(data.owner)}
              href={explorer.account(data.owner)}
              copy={data.owner}
            />
            {data.state && (
              <Row label="State" value={stateLabel(data.state)} mono={false} />
            )}
            {data.slice_address && (
              <Row
                label="Storage slice"
                value={shorten(data.slice_address)}
                href={explorer.object(data.slice_address)}
                copy={data.slice_address}
              />
            )}
            {data.location_name && (
              <Row label="Location" value={data.location_name} />
            )}
            {data.blob_commitment && (
              <Row
                label="Commitment"
                value={shorten(data.blob_commitment)}
                copy={data.blob_commitment}
              />
            )}
            <Row
              label="Size on chain"
              value={bytes(Number(data.size))}
            />
            {data.num_chunksets != null && (
              <Row label="Chunksets" value={String(data.num_chunksets)} />
            )}
            {data.created_at != null && (
              <Row label="Registered" value={whenMicros(data.created_at)} mono={false} />
            )}
            {data.committed_at != null && (
              <Row label="Committed" value={whenMicros(data.committed_at)} mono={false} />
            )}
            {data.payment && (
              <Row
                label="Storage paid"
                value={`${data.payment.epochs} payment epochs`}
                mono={false}
              />
            )}
            {data.payment?.paidUntil != null && (
              <Row
                label="Paid until"
                value={
                  <span className={timeLeft(data.payment.paidUntil).danger ? "text-warn" : ""}>
                    {whenMicros(data.payment.paidUntil)}
                    {" · "}
                    {timeLeft(data.payment.paidUntil).text}
                  </span>
                }
                mono={false}
              />
            )}
            <Row
              label="Contract"
              value={shorten(SHELBY_DEPLOYER)}
              href={explorer.account(SHELBY_DEPLOYER)}
              copy={SHELBY_DEPLOYER}
            />
            <Row
              label="Object name"
              value={shorten(toObjectName(owner, blobName), 16, 20)}
              copy={toObjectName(owner, blobName)}
            />
          </>
        )}
      </div>

      {data && (
        <footer className="px-5 py-3 border-t border-rule">
          <p className="tc leading-relaxed">
            Every value above is read live from the shelbynet object index and
            the Shelby contract, and links to the Aptos Explorer. Storage is
            prepaid in payment epochs at upload; "Paid until" is computed from
            the epochs paid. Anyone can independently verify this video is
            stored on Shelby.
          </p>
        </footer>
      )}
    </section>
  );
}
