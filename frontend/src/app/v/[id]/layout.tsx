// vm_knowledge: what a shared link shows before anyone opens it.
//
// The page itself runs in the browser, but link previews (messages,
// social posts) and search engines only read the HTML the server sends.
// This layout runs on the server and puts the video's title, a short
// description and its cover picture in that HTML.
//
// Public videos may be indexed by search engines. Unlisted videos show a
// preview to whoever has the link but ask search engines not to list
// them. A private video, a missing one, or a backend that does not answer
// in time gets the plain VideoMind preview, never anything about the video.
import type { Metadata } from "next";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const WAIT_MS = 5000;

interface Shared {
  title?: string;
  description?: string | null;
  visibility?: string;
  status?: string;
  ai?: { summary?: string | null } | null;
  meta?: { durationSeconds?: number | null } | null;
}

/** The video as a visitor would see it, or null. Never throws. */
async function sharedVideo(id: string): Promise<Shared | null> {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) return null;
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), WAIT_MS);
  try {
    const res = await fetch(`${API}/api/videos/${encodeURIComponent(id)}`, {
      signal: stop.signal,
      // A minute is short enough that a change of title or of who may see
      // the video shows up quickly, and long enough to spare the backend
      // when a link is being shared around.
      next: { revalidate: 60 },
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as Shared;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** About two sentences, cut at a word, for the preview text. */
function previewText(text: string, max = 200): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, "")}…`;
}

const PLAIN: Metadata = {
  title: "VideoMind",
  robots: { index: false, follow: false },
};

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const v = await sharedVideo(params.id);
  if (!v || !v.title || v.visibility === "private") return PLAIN;

  const title = `${v.title} | VideoMind`;
  const description = previewText(
    v.ai?.summary || v.description || "Watch it with its transcript and chapters, and ask questions about it on VideoMind.",
  );
  const cover = `${API}/api/videos/${encodeURIComponent(params.id)}/cover`;
  const listed = v.visibility === "public";

  return {
    title,
    description,
    robots: listed ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: {
      title: v.title,
      description,
      type: "video.other",
      siteName: "VideoMind",
      images: [{ url: cover, alt: v.title }],
    },
    twitter: {
      card: "summary_large_image",
      title: v.title,
      description,
      images: [cover],
    },
  };
}

export default function SharedVideoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
