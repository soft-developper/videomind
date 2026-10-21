"use client";
// vm_search_page: search across the library, down to the moment. Every
// sentence of every ready video is searched by meaning. Each moment opens
// the video there (?t=). The search is part of the address, so a result
// page can be reloaded, shared with yourself, or reached with Back.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Search, RefreshCw, X } from "lucide-react";
import Link from "next/link";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { searchAllVideos, getCollections, type SearchResult } from "@/lib/api";
// vm_charge
import { PriceTag, AddCreditsLink, isNoCredits } from "@/components/credits/Credits";
import { useSessionWallet } from "@/components/layout/AuthProvider";
import { readableTime } from "@/lib/exports";
import { CATEGORIES, useLabels } from "@/lib/categories";
// vm_lang
import { useTranslations } from "next-intl";
import { EmptyState } from "@/components/ui/EmptyState";
import { WalletButton } from "@/components/layout/WalletButton";

/**
 * The words of the search worth marking in a result (three letters or more).
 * vm_lang: words are letters and digits of any script (Arabic, accented
 * Latin and so on), so a search in any language is marked.
 */
function marks(text: string, query: string): Array<{ t: string; hit: boolean }> {
  const words = Array.from(new Set(query.toLowerCase().split(new RegExp("[^\\p{L}\\p{N}]+", "u")).filter((w) => w.length >= 3)));
  if (!words.length) return [{ t: text, hit: false }];
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return text.split(re).filter(Boolean).map((t) => ({ t, hit: words.includes(t.toLowerCase()) }));
}

interface Asked { q: string; category: string; collection: string }

function fromUrl(): Asked {
  if (typeof window === "undefined") return { q: "", category: "", collection: "" };
  const p = new URLSearchParams(window.location.search);
  return { q: p.get("q") ?? "", category: p.get("category") ?? "", collection: p.get("collection") ?? "" };
}

export function SearchInterface() {
  const t = useTranslations("search");
  const labels = useLabels();
  const { connected } = useWallet();
  // vm_signin: search runs only once the wallet has signed in
  const wallet = useSessionWallet();
  const router = useRouter();

  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [collection, setCollection] = useState("");
  const [asked, setAsked] = useState<Asked | null>(null);
  const [hits, setHits] = useState<SearchResult[] | null>(null);
  const [notIndexed, setNotIndexed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [errCode, setErrCode] = useState<string | undefined>(undefined);
  const started = useRef(false);

  const { data: collections = [] } = useQuery({
    queryKey: ["collections", wallet ?? null], queryFn: getCollections, enabled: !!wallet, staleTime: 60_000,
  });

  const run = async (a: Asked, push = true) => {
    const query = a.q.trim();
    if (!query) return;
    if (!wallet) { setErr(t("signInFirst")); return; }
    setQ(query); setAsked({ ...a, q: query }); setBusy(true); setErr(null);
    if (push) {
      const p = new URLSearchParams({ q: query });
      if (a.category) p.set("category", a.category);
      if (a.collection) p.set("collection", a.collection);
      router.replace(`/search?${p.toString()}`, { scroll: false });
    }
    try {
      const d = await searchAllVideos(query, { categories: a.category ? [a.category] : undefined, collectionId: a.collection || undefined });
      setHits(d.results); setNotIndexed(d.notIndexed ?? 0);
    } catch (e: any) { setErr(e?.message ?? t("failed")); setErrCode(e?.code); setHits(null); }
    finally { setBusy(false); }
  };

  // A search in the address runs once the wallet is signed in.
  useEffect(() => {
    if (started.current || !wallet) return;
    started.current = true;
    const a = fromUrl();
    setQ(a.q); setCategory(a.category); setCollection(a.collection);
    if (a.q.trim()) run(a, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet]);

  const now: Asked = { q, category, collection };
  const clear = () => { setHits(null); setAsked(null); setQ(""); setErr(null); router.replace("/search", { scroll: false }); };

  if (!connected) {
    return (
      <EmptyState title={t("connectTitle")} action={<WalletButton />}>
        {t("connectBody")}
      </EmptyState>
    );
  }

  const moments = hits?.reduce((n, r) => n + r.matches.length, 0) ?? 0;

  return (
    <div className="space-y-6">
      {/* Query bar */}
      <form
        role="search"
        onSubmit={(e) => { e.preventDefault(); run(now); }}
        className="flex items-center rounded-md border border-rule bg-side focus-within:border-dim transition-colors overflow-hidden"
      >
        <span className="ps-3 shrink-0">
          {busy ? <span className="dot dot-work" /> : <Search size={14} className="text-dim" />}
        </span>
        <label htmlFor="search-q" className="sr-only">{t("label")}</label>
        <input
          id="search-q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("placeholder")}
          maxLength={500}
          className="flex-1 min-w-0 h-12 px-3 text-[15px] font-sans bg-transparent border-0 rounded-none focus:border-0"
        />
        <button
          type="submit"
          disabled={busy || !q.trim()}
          className="h-9 me-1.5 px-4 rounded bg-paper text-void text-[13.5px] font-sans font-medium hover:bg-white transition-colors disabled:bg-rule disabled:text-dim disabled:cursor-not-allowed shrink-0 no-min"
        >
          {t("button")}
        </button>
      </form>

      {/* vm_charge: what a search costs, when it costs something */}
      <PriceTag what="search" className="-mt-4" />

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <label className="sr-only" htmlFor="search-kind">{t("kind")}</label>
        <select
          id="search-kind"
          value={category}
          onChange={(e) => { setCategory(e.target.value); if (asked) run({ ...now, category: e.target.value }); }}
          className="h-9 px-2.5 text-[13px]"
        >
          <option value="">{t("allKinds")}</option>
          {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{labels.category(c.id)}</option>)}
        </select>
        {collections.length > 0 && (
          <>
            <label className="sr-only" htmlFor="search-collection">{t("collection")}</label>
            <select
              id="search-collection"
              value={collection}
              onChange={(e) => { setCollection(e.target.value); if (asked) run({ ...now, collection: e.target.value }); }}
              className="h-9 px-2.5 text-[13px] max-w-[16rem]"
            >
              <option value="">{t("allCollections")}</option>
              {collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </>
        )}
      </div>

      {/* Idle */}
      {hits === null && !busy && !err && (
        <p className="text-[13.5px] text-dim leading-relaxed max-w-[60ch]">
          {t("idle")}
        </p>
      )}

      {/* Error */}
      {err && (
        <div role="alert" className="rounded-md border border-error/50 bg-error/5 p-3.5 flex items-start gap-3">
          <p className="text-[13px] font-sans text-error flex-1">{err}{isNoCredits(errCode) && <> <AddCreditsLink /></>}</p>
          {asked && (
            <button onClick={() => run(asked)} aria-label={t("again")} className="tc text-error/70 hover:text-error no-min">
              <RefreshCw size={11} />
            </button>
          )}
        </div>
      )}

      {/* Results */}
      {hits !== null && !err && (
        <div className={busy ? "space-y-5 opacity-60" : "space-y-5"} aria-busy={busy}>
          <div className="flex items-center justify-between gap-4 pb-3 border-b border-rule">
            <p className="text-[13.5px] text-paper-2" aria-live="polite">
              {hits.length === 0
                ? t("nothingFound")
                : t("summary", { moments, videos: hits.length })}
            </p>
            <button onClick={clear} className="tc hover:text-paper transition-colors no-min flex items-center gap-1">
              <X size={10} /> {t("clear")}
            </button>
          </div>

          {notIndexed > 0 && (
            <p className="text-[13px] text-dim">
              {t("notIndexed", { count: notIndexed })}
            </p>
          )}

          {hits.length === 0 && (
            <p className="py-4 text-[14px] font-sans text-dim">
              {asked?.category || asked?.collection
                ? t("noneFiltered")
                : t("none")}
            </p>
          )}

          {hits.map((r) => (
            <article key={r.videoId} className="panel overflow-hidden">
              <header className="flex items-center gap-3 px-4 py-3 border-b border-rule">
                {r.thumbUrl
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={r.thumbUrl} alt="" className="w-20 aspect-video object-cover rounded-sm bg-screen shrink-0" />
                  : <span className="w-20 aspect-video rounded-sm bg-screen shrink-0" aria-hidden />}
                <div className="min-w-0 flex-1">
                  <h3 dir="auto" className="text-[15px] font-semibold text-paper truncate">
                    <Link href={`/video/${r.videoId}`} className="hover:underline">{r.title}</Link>
                  </h3>
                  <p className="tc mt-0.5">
                    {labels.category(r.category) ? `${labels.category(r.category)}, ` : ""}{t("moments", { count: r.matches.length })}
                  </p>
                </div>
              </header>
              <ul>
                {r.matches.map((m, i) => (
                  <li key={i} className="border-b border-rule last:border-0">
                    <Link
                      href={`/video/${r.videoId}?t=${Math.floor(m.time)}`}
                      aria-label={t("openAt", { title: r.title, time: readableTime(m.time) })}
                      className="flex items-start gap-3 px-4 py-2.5 hover:bg-slate-2 transition-colors group"
                    >
                      <span className="tc tc-signal tabular-nums shrink-0 pt-0.5 w-11">{readableTime(m.time)}</span>
                      <span dir="auto" className="text-[13.5px] font-sans text-paper-2 leading-relaxed line-clamp-3 group-hover:text-paper">
                        {marks(m.text, asked?.q ?? "").map((p, j) => p.hit
                          ? <mark key={j} className="bg-signal/25 text-paper rounded-sm">{p.t}</mark>
                          : <span key={j}>{p.t}</span>)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
