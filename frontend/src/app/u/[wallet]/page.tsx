"use client";
// vm_profile: a wallet's public page. Its name and bio if it set them, its
// address always (the address is the identity, a name proves nothing), and
// its public videos and courses. Unlisted and private videos never appear.
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Copy, Check, ExternalLink } from "lucide-react";
import { getPublicProfile, ApiError, type ProfileCard } from "@/lib/api";
import { clock } from "@/components/video/VideoCard";
import { explorer } from "@/lib/explorer";
import { categoryLabel } from "@/lib/categories";
import { useSessionWallet } from "@/components/layout/AuthProvider";
import { LegalFooter } from "@/components/legal/LegalPage";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function Bar() {
  return (
    <nav className="fixed top-0 inset-x-0 z-50 h-14 bg-side border-b border-rule">
      <div className="section h-full flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5">
          <svg width="13" height="15" viewBox="0 0 14 16" fill="none" aria-hidden>
            <path d="M7 15.2 0.6 1.6A1 1 0 0 1 1.5 0.2h11a1 1 0 0 1 0.9 1.4L7 15.2z" className="fill-signal" />
          </svg>
          <span className="text-[15px] font-semibold tracking-tight leading-none text-paper">VideoMind</span>
        </Link>
        <Link href="/" className="btn btn-ghost h-9 px-3.5 flex items-center">Open VideoMind</Link>
      </div>
    </nav>
  );
}

function Tile({ v }: { v: ProfileCard }) {
  const length = clock(v.durationSeconds);
  return (
    <article className="min-w-0">
      <Link href={`/v/${v.id}`} className="group block">
        <span className="relative block aspect-video rounded-md overflow-hidden bg-screen">
          {v.thumbUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={v.thumbUrl} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
          )}
          {length && <span className="absolute right-1.5 bottom-1.5 tc bg-void/80 px-1.5 rounded-sm">{length}</span>}
        </span>
        <h3 className="mt-2 text-[14px] font-medium text-paper leading-snug group-hover:underline line-clamp-2">{v.title}</h3>
      </Link>
      <p className="tc mt-0.5">
        {[categoryLabel(v.category), v.chapters ? `${v.chapters} chapter${v.chapters === 1 ? "" : "s"}` : null].filter(Boolean).join(", ")}
      </p>
    </article>
  );
}

export default function PublicProfilePage({ params }: { params: { wallet: string } }) {
  const me = useSessionWallet();
  const [copied, setCopied] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ["public-profile", params.wallet],
    queryFn: () => getPublicProfile(params.wallet),
    retry: (n, e) => !(e instanceof ApiError && e.status === 400) && n < 1,
  });

  const body = () => {
    if (isLoading) return <p className="text-[14px] text-dim py-10">Loading</p>;
    if (!data) {
      const bad = error instanceof ApiError && error.status === 400;
      return (
        <div className="py-14 max-w-[46ch]">
          <h1 className="font-display text-[20px] text-paper">{bad ? "That is not a wallet address" : "This page could not be loaded"}</h1>
          <p className="text-[14px] text-dim mt-1.5">{bad ? "Check the link. A wallet address starts with 0x." : "Try again in a minute."}</p>
        </div>
      );
    }
    const own = !!me && me.toLowerCase() === data.wallet.toLowerCase();
    return (
      <>
        <header className="py-8 border-b border-rule">
          <h1 className="font-display text-[24px] sm:text-[28px] leading-tight text-paper break-words">{data.name ?? short(data.wallet)}</h1>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span className="tc break-all">{data.wallet}</span>
            <button
              onClick={() => { navigator.clipboard.writeText(data.wallet).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1600); }}
              aria-label="Copy the wallet address"
              className="inline-flex items-center justify-center w-8 h-8 -my-2 rounded text-dim hover:text-paper hover:bg-slate-2 no-min"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
            </button>
            <a href={explorer.account(data.wallet)} target="_blank" rel="noopener noreferrer" aria-label="Open the wallet on the Aptos Explorer" className="inline-flex items-center justify-center w-8 h-8 -my-2 rounded text-dim hover:text-paper hover:bg-slate-2 no-min">
              <ExternalLink size={12} />
            </a>
          </div>
          {data.bio && <p className="text-[14.5px] text-paper-2 leading-relaxed mt-4 max-w-[65ch] whitespace-pre-line">{data.bio}</p>}
          {own && (
            <p className="text-[13px] text-dim mt-4">
              This is your public page. <Link href="/profile" className="underline underline-offset-2 hover:text-paper">Edit your name and bio</Link>.
              {" "}Only videos you made public are listed.
            </p>
          )}
        </header>

        {data.courses.length > 0 && (
          <section className="py-8 border-b border-rule" aria-labelledby="courses-h">
            <h2 id="courses-h" className="text-[15px] font-semibold text-paper mb-4">Courses</h2>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.courses.map((c) => (
                <li key={c.id}>
                  <Link href={`/v/${c.firstVideoId}`} className="group flex gap-3 items-start">
                    <span className="relative w-28 aspect-video rounded-sm overflow-hidden bg-screen shrink-0">
                      {c.thumbUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={c.thumbUrl} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[14px] font-medium text-paper group-hover:underline">{c.name}</span>
                      <span className="tc block mt-0.5">{c.lessons} lesson{c.lessons === 1 ? "" : "s"}</span>
                      {c.description && <span className="block text-[13px] text-dim mt-1 line-clamp-2">{c.description}</span>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="py-8" aria-labelledby="videos-h">
          <h2 id="videos-h" className="text-[15px] font-semibold text-paper mb-4">Videos</h2>
          {data.videos.length === 0 ? (
            <p className="text-[14px] text-dim">No public videos yet.</p>
          ) : (
            <div className="grid gap-x-4 gap-y-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {data.videos.map((v) => <Tile key={v.id} v={v} />)}
            </div>
          )}
        </section>
      </>
    );
  };

  return (
    <div className="min-h-screen bg-void">
      <Bar />
      <main className="pt-14 pb-16 section max-w-[1400px] mx-auto">{body()}</main>
      <LegalFooter />
    </div>
  );
}
