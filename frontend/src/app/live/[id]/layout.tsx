// vm_live: what a link to a live event shows before it is opened.
import type { Metadata } from "next";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) return { title: "VideoMind", robots: { index: false, follow: false } };
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), 5000);
  try {
    const res = await fetch(`${API}/api/live/${params.id}`, { signal: stop.signal, next: { revalidate: 30 } });
    if (!res.ok) return { title: "VideoMind", robots: { index: false, follow: false } };
    const { event } = (await res.json()) as { event: { title: string; status: string; hostName: string | null } };
    const state = event.status === "live" ? "Live now" : event.status === "ended" ? "Ended" : "Live soon";
    const description = `${state} on VideoMind${event.hostName ? `, with ${event.hostName}` : ""}.`;
    return {
      title: `${event.title} | ${state}`,
      description,
      robots: { index: false, follow: false },
      openGraph: { title: event.title, description, siteName: "VideoMind", type: "video.other" },
      twitter: { card: "summary", title: event.title, description },
    };
  } catch {
    return { title: "VideoMind", robots: { index: false, follow: false } };
  } finally {
    clearTimeout(timer);
  }
}

export default function LiveLayout({ children }: { children: React.ReactNode }) {
  return children;
}
