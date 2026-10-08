// vm_profile: what a link to a public page shows before anyone opens it.
// Runs on the server, like the shared video page (see app/v/[id]/layout.tsx).
import type { Metadata } from "next";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const WAIT_MS = 5000;

interface Shared { wallet: string; name: string | null; bio: string | null; videos: unknown[] }

async function profile(wallet: string): Promise<Shared | null> {
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(wallet)) return null;
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), WAIT_MS);
  try {
    const res = await fetch(`${API}/api/profiles/${wallet}`, { signal: stop.signal, next: { revalidate: 60 }, headers: { accept: "application/json" } });
    return res.ok ? ((await res.json()) as Shared) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function generateMetadata({ params }: { params: { wallet: string } }): Promise<Metadata> {
  const p = await profile(params.wallet);
  if (!p) return { title: "VideoMind", robots: { index: false, follow: false } };
  const who = p.name ?? `${p.wallet.slice(0, 6)}…${p.wallet.slice(-4)}`;
  const description = (p.bio ?? `Videos by ${who} on VideoMind.`).replace(/\s+/g, " ").slice(0, 200);
  return {
    title: `${who} | VideoMind`,
    description,
    // A page with nothing public on it is not for search engines.
    robots: p.videos.length ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: { title: who, description, type: "profile", siteName: "VideoMind" },
    twitter: { card: "summary", title: who, description },
  };
}

export default function PublicProfileLayout({ children }: { children: React.ReactNode }) {
  return children;
}
