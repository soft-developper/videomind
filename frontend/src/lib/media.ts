// src/lib/media.ts
// vm_media: how the facts the server read from a file are worded.
import type { MediaFacts } from "./api";

const CODEC: Record<string, string> = {
  h264: "H.264", hevc: "HEVC", vp8: "VP8", vp9: "VP9", av1: "AV1", mpeg4: "MPEG-4", mpeg2video: "MPEG-2",
  prores: "ProRes", dnxhd: "DNxHD", wmv3: "WMV", msmpeg4v3: "MPEG-4", theora: "Theora", mjpeg: "Motion JPEG",
};
const CONTAINER: Record<string, string> = { mp4: "MP4", mov: "MOV", webm: "WebM", mkv: "MKV", avi: "AVI" };

export const codecLabel = (c?: string) => (c ? CODEC[c] ?? c.toUpperCase() : null);
export const containerLabel = (c?: string) => (c ? CONTAINER[c] ?? c.toUpperCase() : null);

/** "HEVC in MOV", for a sentence about the format. */
export function formatLabel(m?: MediaFacts | null): string | null {
  if (!m) return null;
  const codec = codecLabel(m.videoCodec), box = containerLabel(m.container);
  if (codec && box) return `${codec} in ${box}`;
  return codec ?? box;
}

/** "1280 x 720, 30 fps, H.264, MP4": the short line under a video's title. */
export function factsLine(m?: MediaFacts | null): string | null {
  if (!m || !m.hasVideo) return null;
  const parts = [
    m.width && m.height ? `${m.width} x ${m.height}` : null,
    m.fps ? `${Math.round(m.fps)} fps` : null,
    codecLabel(m.videoCodec),
    containerLabel(m.container),
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/** What to tell the owner when browsers cannot all play the file as it is. null when there is nothing to say. */
export function playbackNote(m?: MediaFacts | null): { tone: "warn" | "quiet"; text: string } | null {
  if (!m) return null;
  if (!m.hasVideo) return { tone: "warn", text: "This file has sound but no picture, so there is nothing to show in the player." };
  const format = formatLabel(m) ?? "an unusual format";
  if (m.playable === "no") {
    return { tone: "warn", text: `This file is ${format}. Browsers cannot play that, so it will not play here until VideoMind converts videos itself. An MP4 with H.264 video plays everywhere.` };
  }
  if (m.playable === "some") {
    return { tone: "quiet", text: `This file is ${format}. Some browsers cannot play that. An MP4 with H.264 video plays everywhere.` };
  }
  return null;
}
