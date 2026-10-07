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
    return Promise.reject(new Error(message));
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

export const createUpload = (b: { filename: string; size: number; contentType: string; title: string; description: string }) =>
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

// ── Video queries ───────────────────────────────────────────────────────────
export async function getVideos(walletAddress?: string): Promise<VideoRecord[]> {
  if (!walletAddress) return [];
  const res = await api.get("/api/videos", { params: { wallet: walletAddress } });
  return res.data.videos as VideoRecord[];
}

export async function getVideo(id: string) {
  const res = await api.get(`/api/videos/${id}`);
  const v = res.data as VideoRecord & { streamUrl: string | null };
  if (v.streamUrl) v.streamUrl = absoluteUrl(v.streamUrl);
  return v;
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
  /** the kind of failure, e.g. "too_large". Only sent to the video's owner. */
  errorCode?: string | null;
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
}
