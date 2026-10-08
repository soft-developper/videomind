import axios, { type AxiosError } from "axios";
// vm_signin: every request carries the session token once signed in
import { getSession, setSession } from "./session";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export const api = axios.create({ baseURL: BASE, timeout: 120_000 });

api.interceptors.request.use((config) => {
  const s = getSession();
  if (s) config.headers.set("Authorization", `Bearer ${s.token}`);
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err: AxiosError<{ error?: string; code?: string }>) => {
    const serverMsg = err.response?.data?.error;
    const statusCode = err.response?.status;
    // The API no longer accepts this session (expired or signed out
    // elsewhere): drop it so the page offers sign in again.
    if (statusCode === 401 && err.response?.data?.code === "auth_required") setSession(null);
    let message: string;
    if (serverMsg) message = serverMsg;
    else if (err.code === "ECONNABORTED" || err.message.includes("timeout"))
      message = "Request timed out. The server may be busy, please try again.";
    else if (!err.response)
      message = "Cannot reach the VideoMind server. Is the backend running?";
    else if (statusCode === 413) message = "File is too large. Maximum size is 2 GB.";
    else if (statusCode === 415) message = "Unsupported file type. Please upload MP4, WebM, MOV, AVI, or MKV.";
    else if (statusCode === 500) message = "Server error. Check the backend logs for details.";
    else message = err.message ?? "An unexpected error occurred.";
    // vm_info: keep the status and the server's code, so a page can tell "private" from "not found"
    return Promise.reject(new ApiError(message, statusCode ?? 0, err.response?.data?.code, err.response?.data));
  }
);

// ── Upload flow ─────────────────────────────────────────────────────────────
// vm_upload: the file goes to storage in parts, straight from the browser.
// See src/lib/uploader.ts for the part that does the sending.
export interface UploadInfo {
  videoId: string;
  filename: string;
  size: number;
  partSize: number;
  partCount: number;
  status: "open" | "completed" | "aborted";
  /** part numbers that have arrived whole */
  done?: number[];
  uploadedBytes: number;
  title?: string;
  /** the name reserved for this file on Shelby */
  videoBlobName?: string;
  createdAt?: number;
}

/** An API error that keeps the server's code and any extra fields. */
export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string, public data?: any) { super(message); }
}
async function call<T>(fn: () => Promise<{ data: T }>): Promise<T> {
  try { return (await fn()).data; }
  catch (e: any) {
    const r = e?.response;
    throw new ApiError(r?.data?.error ?? e?.message ?? "Request failed.", r?.status ?? 0, r?.data?.code, r?.data);
  }
}
// Upload calls bypass the shared error wrapper so the uploader can tell
// "no network" (status 0) from an answer by the server.
const raw = axios.create({ baseURL: BASE, timeout: 60_000 });
raw.interceptors.request.use((config) => {
  const s = getSession();
  if (s) config.headers.set("Authorization", `Bearer ${s.token}`);
  return config;
});

export const createUpload = (b: { filename: string; size: number; contentType: string } & VideoInfoPatch) =>
  call<UploadInfo>(() => raw.post("/api/uploads", b));
export const getUpload = (id: string) => call<UploadInfo>(() => raw.get(`/api/uploads/${id}`));
export const listOpenUploads = () => call<{ uploads: UploadInfo[] }>(() => raw.get("/api/uploads")).then((d) => d.uploads);
export const getPartUrls = (id: string, parts: number[]) =>
  call<{ urls: Record<string, string>; expiresIn: number }>(() => raw.post(`/api/uploads/${id}/parts`, { parts }));
export const completeUpload = (id: string) => call<{ id: string; status: string }>(() => raw.post(`/api/uploads/${id}/complete`));
export const discardUpload = (id: string) => call<{ success: boolean }>(() => raw.delete(`/api/uploads/${id}`));
/** A part address that starts with "/" is on this API (local disk storage). */
export const absoluteUrl = (u: string) => (u.startsWith("/") ? BASE + u : u);

/** Record that the owner's wallet has stored the file on Shelby. */
export const anchorVideo = (id: string, b: { accountAddress: string; txHash: string }) =>
  call<{ id: string; onShelby: boolean }>(() => raw.post(`/api/videos/${id}/anchor`, b));

// ── Video details and collections ───────────────────────────────────────────
// vm_info: what the owner says about a video, and who may open it.
export type Visibility = "private" | "unlisted" | "public";

/** Only the fields that are sent change. */
export interface VideoInfoPatch {
  title?: string;
  description?: string;
  category?: string | null;
  visibility?: Visibility;
  tags?: string[];
  /** null takes the video out of its collection */
  collectionId?: string | null;
  /** put the video in the collection with this name, creating it if needed */
  newCollection?: string;
}

export interface VideoInfo {
  id: string; title: string; description: string; category: string | null;
  visibility: Visibility; tags: string[]; collection: { id: string; name: string } | null;
}

export const updateVideo = (id: string, patch: VideoInfoPatch) =>
  call<VideoInfo>(() => raw.patch(`/api/videos/${id}`, patch));

export interface Collection {
  id: string; name: string; description: string | null;
  createdAt: number; updatedAt: number;
  videoCount: number; totalSeconds: number;
}
export const getCollections = () =>
  call<{ collections: Collection[] }>(() => raw.get("/api/collections")).then((d) => d.collections);
export const createCollection = (name: string) => call<Collection>(() => raw.post("/api/collections", { name }));
export const renameCollection = (id: string, name: string) => call<Collection>(() => raw.patch(`/api/collections/${id}`, { name }));
export const deleteCollection = (id: string) => call<{ success: boolean }>(() => raw.delete(`/api/collections/${id}`));

// ── Video queries ───────────────────────────────────────────────────────────
export async function getVideos(walletAddress?: string): Promise<VideoRecord[]> {
  if (!walletAddress) return [];
  const res = await api.get("/api/videos", { params: { wallet: walletAddress } });
  const videos = res.data.videos as VideoRecord[];
  // vm_media: with local disk storage the picture addresses point at this API
  for (const v of videos) if (v.thumbUrl) v.thumbUrl = absoluteUrl(v.thumbUrl);
  return videos;
}

export async function getVideo(id: string) {
  const res = await api.get(`/api/videos/${id}`);
  const v = res.data as VideoRecord & { streamUrl: string | null };
  if (v.streamUrl) v.streamUrl = absoluteUrl(v.streamUrl);
  if (v.posterUrl) v.posterUrl = absoluteUrl(v.posterUrl);
  if (v.thumbUrl) v.thumbUrl = absoluteUrl(v.thumbUrl);
  return v;
}

/**
 * vm_captions: the video's captions, cut for reading on screen. WebVTT for
 * the player, SubRip for download. Fetched with the session, so a
 * private video's owner gets them too.
 */
export async function getCaptions(id: string, format: "vtt" | "srt" = "vtt"): Promise<string> {
  const res = await api.get(`/api/videos/${id}/captions`, {
    params: format === "srt" ? { format } : undefined,
    responseType: "text", transformResponse: (d) => d,
  });
  return String(res.data ?? "");
}

/**
 * vm_workspace: the transcript with every word and its time, for marking
 * the word being said. Asked for separately because it is several times
 * larger than the sentences the page loads with.
 */
export async function getTranscriptWords(id: string): Promise<Array<{ start: number; end: number; text: string; words?: Array<{ text: string; start: number; end: number }> }>> {
  const res = await api.get(`/api/videos/${id}`, { params: { words: 1 } });
  return res.data?.ai?.transcript ?? [];
}

/** vm_chapters: "90", "1:30" or "1:02:03" as seconds; null when it is not a time. */
export function parseClock(text: string): number | null {
  const raw = text.trim();
  if (!raw || !/^\d+(\.\d+)?(:\d{1,2}(\.\d+)?){0,2}$/.test(raw)) return null;
  const parts = raw.split(":").map(Number);
  if (parts.slice(1).some((n) => n >= 60)) return null;
  return parts.reduce((a, n) => a * 60 + n, 0);
}

/** vm_workspace: "?t=90", "?t=1:30" or "?t=1:02:03" as seconds, for a link to a moment. */
export function momentFromUrl(): number | null {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get("t");
  if (!raw) return null;
  const s = parseClock(raw);
  return s && s > 0 ? s : null;
}

// ── vm_notes: the signed in wallet's own bookmarks and notes on a video ──
export interface Note { id: string; kind: "bookmark" | "note"; atSeconds: number; text: string; createdAt: number; updatedAt: number }
export async function getNotes(videoId: string): Promise<Note[]> {
  const res = await api.get(`/api/videos/${videoId}/notes`);
  return (res.data?.notes ?? []) as Note[];
}
export async function addNote(videoId: string, note: { kind: Note["kind"]; atSeconds: number; text?: string }): Promise<Note> {
  const res = await api.post(`/api/videos/${videoId}/notes`, note);
  return res.data as Note;
}
export async function editNote(videoId: string, id: string, change: { atSeconds?: number; text?: string }): Promise<Note> {
  const res = await api.patch(`/api/videos/${videoId}/notes/${id}`, change);
  return res.data as Note;
}
export async function deleteNote(videoId: string, id: string): Promise<void> {
  await api.delete(`/api/videos/${videoId}/notes/${id}`);
}

/** vm_chapters: the owner's own chapters replace the suggested ones. Answers the chapters as saved. */
export async function saveChapters(id: string, chapters: Array<{ title: string; startSeconds: number; summary: string }>) {
  // A refusal arrives as an ApiError whose data says which chapter (data.index).
  const res = await api.put(`/api/videos/${id}/chapters`, { chapters });
  return res.data as { chapters: Array<{ title: string; startSeconds: number; summary: string }> };
}

export async function getVideoStatus(id: string) {
  const res = await api.get(`/api/videos/${id}/status`);
  return res.data as { id: string; status: string };
}

// vm_jobs: the processing stages of one video and where each stands.
export interface VideoJob {
  kind: string;
  /** e.g. "Transcription" */
  label: string;
  status: "queued" | "running" | "succeeded" | "failed";
  attempts: number;
  maxAttempts: number;
  /** unix ms of the next automatic attempt, when one is scheduled */
  nextAttemptAt: number | null;
  /** why it failed. Only sent to the video's owner. */
  error: string | null;
  /** the kind of failure, e.g. "too_long". Only sent to the video's owner. */
  errorCode?: string | null;
  /** vm_transcribe: pieces of a long transcription done out of all of them, while it runs */
  progress?: { done: number; total: number } | null;
  /** true only for the owner, and only when a retry can help */
  canRetry: boolean;
}

export async function getVideoJobs(id: string) {
  const res = await api.get(`/api/videos/${id}/jobs`);
  return res.data as { id: string; status: string; jobs: VideoJob[] };
}

/** Run one failed stage again. Finished stages are not repeated. */
export async function retryVideoJob(id: string, kind: string) {
  const res = await api.post(`/api/videos/${id}/jobs/${kind}/retry`);
  return res.data as { id: string; status: string };
}

/** Persist the video duration once it's known from the player. */
export async function setVideoDuration(id: string, seconds: number) {
  const res = await api.patch(`/api/videos/${id}/duration`, { durationSeconds: seconds });
  return res.data as { success: boolean };
}

// ── AI ──────────────────────────────────────────────────────────────────────
export async function chatWithVideo(videoId: string, question: string) {
  const res = await api.post(`/api/chat/${videoId}`, { question });
  return res.data as { answer: string; sources: Array<{ time: number; text: string }> };
}

export async function searchAllVideos(query: string, walletAddress?: string) {
  const res = await api.post("/api/chat/search/all", { query, wallet: walletAddress });
  return res.data as {
    results: Array<{
      videoId: string; title: string;
      matches: Array<{ time: number; text: string }>;
    }>;
  };
}

export async function deleteAllVideos(walletAddress: string) {
  const res = await api.delete("/api/videos/all", { params: { wallet: walletAddress } });
  return res.data as { success: boolean; deleted: number; message: string };
}

// ── Learning Paths ──────────────────────────────────────────────────────────
export interface LearningPath {
  level: "Beginner" | "Intermediate" | "Advanced";
  title: string;
  description: string;
  steps: Array<{ videoId: string; title: string; reason: string }>;
}

export interface PathsResponse {
  paths: LearningPath[];
  videoCount: number;
  minRequired?: number;
  generatedAt?: number;
  cached: boolean;
}

export async function getLearningPaths(wallet: string): Promise<PathsResponse> {
  const res = await api.get("/api/learn/paths", { params: { wallet } });
  return res.data;
}

export async function regenerateLearningPaths(wallet: string): Promise<PathsResponse> {
  const res = await api.post("/api/learn/paths/regenerate", { wallet });
  return res.data;
}

// ── Library Assistant ───────────────────────────────────────────────────────
export interface LibraryAnswer {
  answer: string;
  citations: Array<{
    videoId: string;
    videoTitle: string;
    time: number;
    quote: string;
  }>;
  videosUsed: string[];
}

export async function askLibrary(question: string, wallet: string): Promise<LibraryAnswer> {
  const res = await api.post("/api/learn/ask", { question, wallet });
  return res.data;
}

// ── Types ───────────────────────────────────────────────────────────────────
export interface VideoRecord {
  id: string;
  title: string;
  description?: string;
  createdAt: number;
  status: "uploading" | "processing" | "transcribing" | "analyzing" | "ready" | "error";
  shelby: {
    videoBlobName: string;
    accountAddress: string;
    videoTxHash: string;
    transcriptBlobName?: string;
    metaBlobName?: string;
    expiresAt?: number;
  };
  ai?: {
    transcript?: Array<{ start: number; end: number; text: string }>;
    summary?: string;
    chapters?: Array<{ title: string; startSeconds: number; summary: string }>;
    highlights?: Array<{ startSeconds: number; endSeconds: number; reason: string; text: string }>;
    tags?: string[];
    blogPost?: string;
    tweetThread?: string;
  };
  meta: { sizeBytes: number; mimeType: string; durationSeconds?: number };
  streamUrl?: string | null;
  /** vm_upload: wallet that created the video */
  ownerWallet?: string;
  /** where streamUrl points: our own storage, or Shelby */
  source?: "storage" | "shelby" | null;
  /** true once the owner has stored the file on Shelby */
  onShelby?: boolean;
  /** vm_info: the owner's details. Videos from before these existed are "unlisted". */
  category?: string | null;
  visibility?: Visibility;
  /** the owner's own tags (the AI's are in ai.tags) */
  tags?: string[];
  collection?: { id: string; name: string; position?: number } | null;
  /** true when the signed in wallet owns this video. Only sent with one video, not with the list. */
  isOwner?: boolean;
  /** vm_media: what the server read from the file. Absent until it has looked. */
  media?: MediaFacts;
  /** a small picture for cards. The address stays the same for hours, so the browser keeps it. */
  thumbUrl?: string | null;
  /** the picture shown in the player before playback. Only sent with one video. */
  posterUrl?: string | null;
}

/** vm_media: the facts of the uploaded file. */
export interface MediaFacts {
  hasVideo: boolean;
  hasAudio: boolean;
  durationSeconds?: number;
  width?: number;
  height?: number;
  fps?: number;
  videoCodec?: string;
  audioCodec?: string;
  container?: string;
  bitrateKbps?: number;
  /** can browsers play the file as it is: all of them, some of them, or none */
  playable: "yes" | "some" | "no";
}
