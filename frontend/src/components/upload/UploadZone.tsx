"use client";
// vm_upload: upload first, Shelby after.
//
//   1. The file goes to storage in parts and survives a dropped
//      connection, a closed tab or a restart. Processing starts the
//      moment the last part arrives.
//   2. Storing the file on Shelby is its own step right after. The wallet
//      signs, and if that fails or is skipped the video is still there:
//      the step can be run again at any time.
//
// vm_info: the details form (category, collection, tags, who can watch)
// is filled in before the upload starts. A private video is not sent to
// Shelby by itself, because a file on Shelby can be read by anyone who
// has its address.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import { X, AlertTriangle, Check, FileVideo } from "lucide-react";
import { clsx } from "clsx";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { useSessionWallet } from "@/components/layout/AuthProvider";
import { useUploadBlobs } from "@shelby-protocol/react";
import {
  createUpload, listOpenUploads, discardUpload, anchorVideo, getVideo, ApiError, type UploadInfo,
  // vm_anchors
  startAnchor,
  getMySettings,
} from "@/lib/api";
import { ResumableUpload, StorageBlockedError, UploadStopped, type UploadProgress } from "@/lib/uploader";
// vm_shelby09: expiration removed from blob registration (sdk >= 0.8.0)
import { shelbyClient, SHELBY_LOCATION } from "@/lib/shelby";
import { VideoInfoForm, emptyDraft, draftToPatch, type InfoDraft } from "@/components/video/VideoInfoForm";
import { CATEGORIES } from "@/lib/categories";
// vm_lang
import { useTranslations } from "next-intl";
import { useFormat } from "@/lib/format";

// The category and visibility of the last upload are offered again for
// the next one. Kept in this browser only; the page works without it.
const DEFAULTS_KEY = "vm.upload.defaults.v1";
function readDefaults(): Partial<InfoDraft> {
  try {
    const d = JSON.parse(window.localStorage.getItem(DEFAULTS_KEY) ?? "{}");
    return {
      category: CATEGORIES.some((c) => c.id === d.category) ? d.category : "",
      visibility: ["private", "unlisted", "public"].includes(d.visibility) ? d.visibility : "private",
    };
  } catch { return {}; }
}
function saveDefaults(d: InfoDraft) {
  try { window.localStorage.setItem(DEFAULTS_KEY, JSON.stringify({ category: d.category, visibility: d.visibility })); } catch {}
}

const GB = 1024 ** 3;
/** Transcription reads the file in one request for now, and that request has a size limit. */
/** The Shelby step loads the whole file into the browser's memory. */
const SHELBY_LIMIT = 2 * GB;
const MAX_BYTES = 10 * GB;

/** Which plain explanation fits a wallet error, if any (message keys under "upload.wallet"). */
function walletReason(raw: string): "declined" | "funds" | "submit" | null {
  const r = raw || "";
  if (/reject|cancel|denied|declined/i.test(r)) return "declined";
  if (/INSUFFICIENT_BALANCE|insufficient.*(balance|fund|gas)|EINSUFFICIENT/i.test(r)) return "funds";
  if (/failed to sign and submit|sign and submit|submit.*transaction|transaction.*(failed|rejected by)|simulation/i.test(r)) return "submit";
  return null;
}

type Step =
  | { at: "choose" }
  | { at: "details" }
  | { at: "uploading"; paused: boolean }
  | { at: "uploaded" };

type Shelby =
  | { at: "idle" }
  /** vm_info: not started, because the video is private */
  | { at: "held" }
  | { at: "wallet" }
  | { at: "stored" }
  | { at: "failed"; why: string }
  | { at: "too_large" };

interface Target { videoId: string; videoBlobName: string; title: string; size: number }

/** vm_record: initialFile starts the form with a file already chosen (a recording made on this site). */
export function UploadZone({ initialFile, initialTitle, onUploaded }: {
  initialFile?: File; initialTitle?: string;
  /** vm_live: told the new video's id once the file is uploaded */
  onUploaded?: (videoId: string) => void;
} = {}) {
  const tu = useTranslations("upload");
  const tc = useTranslations("common");
  const fmt = useFormat();
  const bytes = fmt.bytes;
  const readableWallet = (raw: string) => { const k = walletReason(raw); return k ? tu(`wallet.${k}`) : raw; };
  const router = useRouter();
  const params = useSearchParams();
  const anchorId = params.get("anchor");
  const qc = useQueryClient();
  const { account, signAndSubmitTransaction, connected } = useWallet();
  // vm_signin: uploads need a signed in wallet
  const sessionWallet = useSessionWallet();

  const [file, setFile] = useState<File | null>(initialFile ?? null);
  const [draft, setDraft] = useState<InfoDraft>(() => initialFile ? emptyDraft({ ...readDefaults(), title: initialTitle ?? initialFile.name }) : emptyDraft());
  const title = draft.title;
  const [step, setStep] = useState<Step>(initialFile ? { at: "details" } : { at: "choose" });
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [shelby, setShelby] = useState<Shelby>({ at: "idle" });
  const [err, setErr] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const runner = useRef<ResumableUpload | null>(null);
  const info = useRef<UploadInfo | null>(null);
  // Each run gets a number. A run that was cancelled or replaced must
  // not touch the screen when its last promise settles.
  const runNo = useRef(0);

  // vm_settings: defaults chosen in Settings win over the last choice made in this browser.
  const mine = useQuery({ queryKey: ["my-settings", sessionWallet], queryFn: getMySettings, enabled: !!sessionWallet, staleTime: 60_000 });
  const defaults = useCallback((): Partial<InfoDraft> => {
    const d = readDefaults(), s = mine.data?.settings;
    return { ...d, ...(s?.uploadVisibility ? { visibility: s.uploadVisibility } : {}), ...(s?.uploadCategory ? { category: s.uploadCategory } : {}) };
  }, [mine.data]);
  const applied = useRef(false);
  useEffect(() => {
    if (applied.current || !mine.data || !initialFile) return;
    applied.current = true;
    const d = readDefaults();
    setDraft((cur) => (cur.visibility === d.visibility && cur.category === (d.category ?? "") ? { ...cur, ...defaults() } : cur));
  }, [mine.data, initialFile, defaults]);

  // Uploads this wallet started and did not finish, on any device.
  const open = useQuery({
    queryKey: ["open-uploads", sessionWallet],
    queryFn: listOpenUploads,
    enabled: !!sessionWallet && step.at === "choose" && !anchorId,
    staleTime: 5000,
  });
  const unfinished = open.data ?? [];

  // "Store on Shelby" for a video uploaded earlier: the file has to be chosen again.
  const anchorVideoQ = useQuery({
    queryKey: ["video", anchorId],
    queryFn: () => getVideo(anchorId!),
    enabled: !!anchorId,
  });

  // Docs pass the client explicitly rather than relying only on context:
  // https://docs.shelby.xyz/sdks/react/guides/dapp-example
  const blobs = useUploadBlobs({ client: shelbyClient });

  const busy = step.at === "uploading" || shelby.at === "wallet";
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);
  useEffect(() => () => { runner.current?.stop(); }, []);

  // ── Shelby step ───────────────────────────────────────────────────────────
  const storeOnShelby = useCallback(async (f: File, t: Target) => {
    if (!connected || !account || !signAndSubmitTransaction) {
      setShelby({ at: "failed", why: tu("connectToStore") });
      return;
    }
    if (f.size > SHELBY_LIMIT) { setShelby({ at: "too_large" }); return; }
    setShelby({ at: "wallet" });
    try {
      // vm_anchors: the server names each store (a store after the first gets a new name).
      const { blobName } = await startAnchor(t.videoId);
      const buf = new Uint8Array(await f.arrayBuffer());
      await new Promise<void>((res, rej) => {
        blobs.mutate(
          {
            // Official docs pass the AccountAddress object, not a string.
            signer: { account: account.address as any, signAndSubmitTransaction },
            blobs: [{ blobName, blobData: buf }],
            // Explicit location. Without one the contract rejects the write.
            options: { locationHint: SHELBY_LOCATION },
          },
          { onSuccess: () => res(), onError: (e) => rej(e) }
        );
      });
      await anchorVideo(t.videoId, { accountAddress: account.address.toString(), txHash: `wallet-${Date.now()}`, blobName });
      qc.invalidateQueries({ queryKey: ["anchors", t.videoId] });
      setShelby({ at: "stored" });
      qc.invalidateQueries({ queryKey: ["video", t.videoId] });
      router.push(`/video/${t.videoId}`);
    } catch (e: any) {
      console.error("[VideoMind] storing on Shelby failed:", e);
      setShelby({ at: "failed", why: e?.message ? readableWallet(e.message) : tu("storeFailed") });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, account, signAndSubmitTransaction, blobs, qc, router, tu]);

  // ── upload ────────────────────────────────────────────────────────────────
  const run = useCallback(async (f: File, u: UploadInfo) => {
    info.current = u;
    const t: Target = { videoId: u.videoId, videoBlobName: u.videoBlobName ?? "", title: u.title ?? f.name, size: u.size };
    setTarget(t);
    setStep({ at: "uploading", paused: false }); setErr(null);
    const mine = ++runNo.current;
    const r = new ResumableUpload(f, u, (p) => { if (runNo.current === mine) setProgress(p); });
    runner.current = r;
    try {
      await r.start();
      if (runNo.current !== mine) return;
      setStep({ at: "uploaded" });
      onUploaded?.(u.videoId);
      qc.invalidateQueries({ queryKey: ["videos"] });
      qc.invalidateQueries({ queryKey: ["open-uploads"] });
      qc.invalidateQueries({ queryKey: ["collections"] });
      // vm_info: a private video is not sent to Shelby by itself. If its
      // visibility cannot be read, it is treated as private.
      const saved = await getVideo(u.videoId).catch(() => null);
      if (runNo.current !== mine) return;
      if (saved && saved.visibility !== "private") void storeOnShelby(f, t);
      else setShelby({ at: "held" });
    } catch (e: any) {
      if (runNo.current !== mine) return;
      if (e instanceof UploadStopped) { setStep({ at: "uploading", paused: true }); return; }
      setStep({ at: "uploading", paused: true });
      if (e instanceof StorageBlockedError) setErr(e.message);
      else if (e instanceof ApiError && e.code === "expired") setErr(tu("expired"));
      else setErr(e?.message ?? tu("stopped"));
    }
  }, [qc, storeOnShelby, onUploaded, tu]);

  const begin = async () => {
    if (!file || !title.trim() || starting) return;
    if (!sessionWallet) { setErr(tu("signInFirst")); return; }
    setErr(null); setStarting(true);
    try {
      const u = await createUpload({ filename: file.name, size: file.size, contentType: file.type || "video/mp4", ...draftToPatch(draft) });
      saveDefaults(draft);
      await run(file, u);
    } catch (e: any) {
      setErr(e?.message ?? tu("startFailed"));
    } finally { setStarting(false); }
  };

  const pause = () => { runner.current?.stop(); };
  const resume = () => { if (file && info.current) void run(file, info.current); };
  const cancel = async () => {
    runner.current?.stop();
    const id = info.current?.videoId;
    reset();
    if (id) { await discardUpload(id).catch(() => {}); qc.invalidateQueries({ queryKey: ["open-uploads"] }); qc.invalidateQueries({ queryKey: ["videos"] }); }
  };

  const reset = () => {
    runNo.current++;
    setFile(null); setDraft(emptyDraft()); setErr(null);
    setStep({ at: "choose" }); setProgress(null); setTarget(null); setShelby({ at: "idle" });
    runner.current = null; info.current = null;
  };

  // ── choosing a file ───────────────────────────────────────────────────────
  const onDrop = useCallback((files: File[]) => {
    const f = files[0];
    if (!f) return;
    setErr(null);

    // Storing an earlier video on Shelby: it must be the same file.
    if (anchorId) {
      const v = anchorVideoQ.data;
      if (!v) return;
      if (f.size !== v.meta.sizeBytes) {
        setErr(tu("differentFile", { video: bytes(v.meta.sizeBytes), file: bytes(f.size) }));
        return;
      }
      const t: Target = { videoId: v.id, videoBlobName: v.shelby.videoBlobName, title: v.title, size: f.size };
      setFile(f); setTarget(t); setStep({ at: "uploaded" });
      void storeOnShelby(f, t);
      return;
    }

    // The same file as an unfinished upload: continue it.
    const match = unfinished.find((u) => u.filename === f.name && u.size === f.size);
    if (match) { setFile(f); setDraft(emptyDraft({ title: match.title ?? f.name })); void run(f, match); return; }

    setFile(f);
    setDraft(emptyDraft({ ...defaults(), title: f.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ") }));
    setStep({ at: "details" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorId, anchorVideoQ.data, unfinished, run, storeOnShelby, tu]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "video/*": [".mp4", ".webm", ".mov", ".avi", ".mkv"] },
    maxFiles: 1,
    maxSize: MAX_BYTES,
    onDropRejected: (r) => {
      const c = r[0]?.errors[0]?.code;
      if (c === "file-too-large") setErr(tu("tooLarge"));
      else if (c === "file-invalid-type") setErr(tu("badType"));
      else setErr(r[0]?.errors[0]?.message ?? tu("cannotUse"));
    },
  });

  const pct = progress && progress.totalBytes ? Math.floor((progress.uploadedBytes / progress.totalBytes) * 100) : 0;
  const paused = step.at === "uploading" && step.paused;
  const statusLine = useMemo(() => {
    if (!progress) return tu("status.starting");
    if (paused) return tu("status.paused", { size: bytes(progress.uploadedBytes) });
    if (progress.phase === "waiting") return tu("status.waiting", { size: bytes(progress.uploadedBytes) });
    if (progress.phase === "finishing") return tu("status.finishing");
    if (progress.phase === "starting") return tu("status.checking");
    return tu("status.uploading");
  }, [progress, paused, tu, bytes]);

  const errorBox = err && (
    <div role="alert" className="rounded-md border border-error/50 bg-error/5">
      <div className="flex items-start gap-3 p-3.5">
        <AlertTriangle size={15} className="text-error shrink-0 mt-0.5" />
        <p className="text-[13.5px] font-sans text-error leading-relaxed flex-1">{err}</p>
        <button onClick={() => setErr(null)} aria-label={tc("dismiss")} className="text-dim hover:text-paper shrink-0 no-min">
          <X size={13} />
        </button>
      </div>
    </div>
  );

  const fileRow = file && (
    <div className="flex items-center gap-4">
      <span className="w-11 h-11 shrink-0 rounded-md bg-slate-2 flex items-center justify-center text-paper-2">
        <FileVideo size={20} strokeWidth={1.6} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium text-paper leading-tight truncate">{step.at === "details" ? file.name : (target?.title ?? file.name)}</p>
        <p className="tc mt-1">{bytes(file.size)}</p>
      </div>
    </div>
  );

  // ── not connected / not signed in ─────────────────────────────────────────
  if (!connected || !sessionWallet) {
    return (
      <div className="flex items-center gap-3 px-3.5 py-3 rounded-md border border-rule bg-slate">
        <span className="dot dot-off" />
        <p className="text-[13.5px] text-paper-2">
          {!connected ? tu("connectToUpload") : tu("signInToUpload")}
        </p>
      </div>
    );
  }

  // ── after the upload: the Shelby step ─────────────────────────────────────
  if (step.at === "uploaded" && target) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-rule p-5">
          {fileRow}
          {!anchorId && (
            <p className="flex items-center gap-2 mt-4 text-[14px] text-paper">
              <Check size={15} className="text-marker" /> {tu("uploaded")}
            </p>
          )}
        </div>

        <div className="rounded-lg border border-rule p-5">
          <h2 className="font-display text-[15px] text-paper">{tu("storeTitle")}</h2>
          <p className="text-[13.5px] text-dim mt-1 leading-relaxed max-w-[58ch]">
            {tu("storeBody")}
          </p>

          <div className="mt-4" aria-live="polite">
            {shelby.at === "wallet" && (
              <p className="flex items-center gap-2.5 text-[14px] text-paper">
                <span className="dot dot-work" /> {tu("approve")}
              </p>
            )}
            {shelby.at === "stored" && (
              <p className="flex items-center gap-2 text-[14px] text-paper"><Check size={15} className="text-marker" /> {tu("stored")}</p>
            )}
            {shelby.at === "failed" && (
              <p role="alert" className="text-[13.5px] text-error leading-relaxed max-w-[62ch]">{shelby.why}</p>
            )}
            {shelby.at === "held" && (
              <p className="text-[13.5px] text-paper-2 leading-relaxed max-w-[62ch]">
                {tu("held")}
              </p>
            )}
            {shelby.at === "too_large" && (
              <p className="text-[13.5px] text-paper-2 leading-relaxed max-w-[62ch]">
                {tu("shelbyTooLarge", { size: bytes(target.size) })}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2.5 mt-5 flex-wrap">
            {(shelby.at === "failed" || shelby.at === "idle") && file && (
              <button onClick={() => void storeOnShelby(file, target)} className="btn btn-signal h-9 px-3.5">
                {shelby.at === "failed" ? tc("tryAgain") : tu("storeTitle")}
              </button>
            )}
            <Link
              href={`/video/${target.videoId}`}
              className={clsx("btn h-9 px-3.5 inline-flex items-center", shelby.at === "wallet" || shelby.at === "failed" || shelby.at === "idle" ? "btn-ghost" : "btn-signal")}
            >
              {shelby.at === "stored" || shelby.at === "too_large" || shelby.at === "held" ? tu("openVideo") : tu("later")}
            </Link>
            {shelby.at === "held" && file && (
              <button onClick={() => void storeOnShelby(file, target)} className="btn btn-ghost h-9 px-3.5">
                {tu("storeAnyway")}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── while uploading ───────────────────────────────────────────────────────
  if (step.at === "uploading") {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-rule p-5">
          {fileRow}
          <div className="mt-5 space-y-2">
            <div className="flex items-baseline justify-between gap-4">
              <span className={clsx("text-[13.5px]", progress?.phase === "waiting" && !paused ? "text-warn" : "text-paper-2")} aria-live="polite">{statusLine}</span>
              <span className="tc text-paper-2 shrink-0">
                {progress ? tu("of", { done: bytes(progress.uploadedBytes), total: bytes(progress.totalBytes) }) : ""}
              </span>
            </div>
            <div
              role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={tu("progress")}
              className="h-1.5 rounded-full bg-rule overflow-hidden"
            >
              <div className="h-full rounded-full bg-signal transition-[width] duration-300" style={{ width: `${pct}%` }} />
            </div>
            <p className="tc">{new Intl.NumberFormat(fmt.locale === "ar" ? "ar-u-nu-latn" : fmt.locale, { style: "percent" }).format(pct / 100)}</p>
          </div>

          <div className="flex items-center gap-2.5 mt-4">
            {paused
              ? <button onClick={resume} className="btn btn-signal h-9 px-3.5">{tu("resume")}</button>
              : <button onClick={pause} className="btn btn-ghost h-9 px-3.5">{tu("pause")}</button>}
            <button onClick={() => void cancel()} className="h-9 px-2 text-[13px] text-dim hover:text-error transition-colors">
              {tu("cancelUpload")}
            </button>
          </div>
        </div>
        {errorBox}
        <p className="text-[13px] text-dim leading-relaxed max-w-[62ch]">
          {tu("nothingLost")}
        </p>
      </div>
    );
  }

  // ── choosing and describing ───────────────────────────────────────────────
  const anchorTitle = anchorVideoQ.data?.title;
  return (
    <div className="space-y-4">
      {anchorId && (
        <div className="rounded-md border border-rule bg-slate px-4 py-3.5">
          <p className="text-[14px] font-medium text-paper">
            {anchorTitle ? tu("anchorTitleNamed", { title: anchorTitle }) : tu("anchorTitle")}
          </p>
          <p className="text-[13.5px] text-dim mt-1 leading-relaxed">
            {anchorVideoQ.data ? tu("anchorBodySize", { size: bytes(anchorVideoQ.data.meta.sizeBytes) }) : tu("anchorBody")}
          </p>
          {anchorVideoQ.data?.visibility === "private" && (
            <p className="text-[13.5px] text-warn mt-2 leading-relaxed">
              {tu("anchorPrivate")}
            </p>
          )}
        </div>
      )}

      {!anchorId && unfinished.length > 0 && step.at === "choose" && (
        <div className="rounded-md border border-rule bg-slate">
          <p className="px-4 pt-3.5 text-[14px] font-medium text-paper">
            {tu("unfinished", { count: unfinished.length })}
          </p>
          <p className="px-4 mt-1 text-[13.5px] text-dim">{tu("unfinishedHint")}</p>
          <ul className="mt-3 border-t border-rule divide-y divide-rule">
            {unfinished.map((u) => (
              <li key={u.videoId} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p dir="auto" className="text-[13.5px] text-paper truncate">{u.filename}</p>
                  <p className="tc mt-0.5">{tu("uploadedOf", { done: bytes(u.uploadedBytes), total: bytes(u.size) })}</p>
                </div>
                <button
                  onClick={async () => { await discardUpload(u.videoId).catch(() => {}); open.refetch(); }}
                  className="text-[13px] text-dim hover:text-error transition-colors shrink-0"
                >
                  {tu("discard")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div
        {...getRootProps()}
        className={clsx(
          "relative rounded-lg border border-dashed cursor-pointer transition-colors",
          isDragActive ? "drop-live" : "border-rule-lit hover:border-dim hover:bg-slate/60"
        )}
      >
        <input {...getInputProps()} />
        {file && step.at === "details" ? (
          <div className="p-6 flex items-center gap-4">
            <div className="flex-1 min-w-0">{fileRow}</div>
            <button
              onClick={(e) => { e.stopPropagation(); reset(); }}
              className="flex items-center gap-1.5 text-[13px] text-dim hover:text-error transition-colors shrink-0 no-min"
            >
              <X size={13} /> {tu("remove")}
            </button>
          </div>
        ) : (
          <div className="px-6 py-14 text-center">
            <p className="font-display text-[18px] text-paper leading-tight">
              {isDragActive ? tu("dropHere") : tu("dragHere")}
            </p>
            <p className="text-[13.5px] text-dim mt-2">{tu("orClick")}</p>
            <p className="tc mt-4">{tu("formats", { size: bytes(MAX_BYTES) })}</p>
          </div>
        )}
      </div>

      {file && step.at === "details" && (
        <div className="space-y-4">
          <VideoInfoForm value={draft} onChange={setDraft} idPrefix="upload" />
        </div>
      )}

      {errorBox}

      {!anchorId && (
        <button
          onClick={() => void begin()}
          disabled={!file || !title.trim() || starting || step.at !== "details"}
          className={clsx(
            "w-full h-11 rounded text-[14px] font-sans font-medium transition-colors border",
            file && title.trim() && !starting && step.at === "details"
              ? "bg-paper border-paper text-void hover:bg-white"
              : "bg-transparent border-rule text-dim cursor-not-allowed"
          )}
        >
          {starting ? tu("status.starting") : !file ? tu("chooseFirst") : !title.trim() ? tu("addTitle") : tu("upload")}
        </button>
      )}
    </div>
  );
}
