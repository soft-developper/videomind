import axios, { type AxiosError } from "axios";
// vm_signin: every request carries the session token once signed in
import { getSession, setSession } from "./session";
// vm_lang: errors are shown in the reader's language (see errorText.ts)
import { localize } from "./errorText";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
/** vm_generate: an address the API gave, made absolute (local storage answers with a path). */
export const apiAddress = (u: string) => new URL(u, BASE).toString();

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
    return Promise.reject(new ApiError(localize(message), statusCode ?? 0, err.response?.data?.code, err.response?.data));
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
    throw new ApiError(localize(r?.data?.error ?? e?.message ?? "Request failed."), r?.status ?? 0, r?.data?.code, r?.data);
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
export const anchorVideo = (id: string, b: { accountAddress: string; txHash: string; blobName?: string }) =>
  call<{ id: string; onShelby: boolean }>(() => raw.post(`/api/videos/${id}/anchor`, b));

// ── vm_anchors: each store of a video on Shelby, as the chain confirmed it ──
export type AnchorState = "checking" | "anchored" | "lapsed" | "missing" | "unverified";
export interface AnchorInfo {
  id: string; state: AnchorState; network: string; wallet: string; blobName: string; objectName: string;
  blobUid: string | null; commitment: string | null; sizeBytes: number | null;
  /** milliseconds */ paidUntil: number | null; committedAt: number | null;
  sameAsFirst: boolean | null; createdAt: number; checkedAt: number | null;
  /** owner only */ error: string | null;
}
export interface Anchors { current: AnchorInfo | null; history: AnchorInfo[]; canStoreAgain: boolean }
/** The name the next store uses. Refused (409 already_stored) while the last store is fine. */
export const startAnchor = (id: string) => call<{ blobName: string }>(() => raw.post(`/api/videos/${id}/anchor/start`));
export const getAnchors = (id: string) => call<Anchors>(() => raw.get(`/api/videos/${id}/anchors`));
export const checkAnchorsNow = (id: string) => call<Anchors>(() => raw.post(`/api/videos/${id}/anchors/check`));

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
/** vm_courses: change a course's name or description */
export const updateCollection = (id: string, change: { name?: string; description?: string | null }) => call<Collection>(() => raw.patch(`/api/collections/${id}`, change));
/** vm_courses: the lessons of a course in a new order (every video in it, each once) */
export const reorderCourse = (id: string, videoIds: string[]) => call<{ videoIds: string[] }>(() => raw.put(`/api/collections/${id}/order`, { videoIds }));
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
export async function getCaptions(id: string, format: "vtt" | "srt" = "vtt", lang?: string | null): Promise<string> {
  const res = await api.get(`/api/videos/${id}/captions`, {
    // vm_translate: lang gives a finished translation's captions
    params: format === "srt" || lang ? { ...(format === "srt" ? { format } : {}), ...(lang ? { lang } : {}) } : undefined,
    responseType: "text", transformResponse: (d) => d,
  });
  return String(res.data ?? "");
}

// ── vm_translate: the transcript in other languages (Part 18) ───────────────
export type TextLang = "en" | "es" | "fr" | "ar" | "pt";
export interface TranslationItem {
  lang: TextLang; status: "queued" | "translating" | "done" | "failed"; done: number; total: number;
  /** the owner only */
  error?: string | null; errorCode?: string | null; updatedAt?: number;
}
export interface TranslationList {
  /** the language spoken in the video (a two letter code, any language), when known */
  spoken: string | null;
  offered: TextLang[];
  items: TranslationItem[];
  /** the owner only */
  canTranslate?: boolean; minutes?: number;
}
export interface TranslatedText {
  lang: TextLang;
  transcript: Array<{ start: number; end: number; text: string }>;
  /** null while the owner's edited chapters are being translated again */
  summary: string | null;
  chapters: Array<{ title: string; startSeconds: number; summary: string }> | null;
  highlights: Array<{ startSeconds: number; endSeconds: number; reason: string; text: string }> | null;
}
export const getTranslations = (id: string) => call<TranslationList>(() => raw.get(`/api/videos/${id}/translations`));
export const getTranslatedText = (id: string, lang: string) => call<TranslatedText>(() => raw.get(`/api/videos/${id}/translations/${lang}`));
export const startTranslation = (id: string, lang: TextLang) => call<TranslationItem>(() => raw.post(`/api/videos/${id}/translations`, { lang }));
export const removeTranslation = (id: string, lang: TextLang) => call<{ success: true }>(() => raw.delete(`/api/videos/${id}/translations/${lang}`));

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

/**
 * vm_workspace: "?t=90", "?t=1:30" or "?t=1:02:03" as seconds, for a link to a moment.
 * vm_search_page: pass the page's own search params (useSearchParams). After a link inside
 * the app, window.location can still hold the page that was left when the new one first renders.
 */
export function momentFromUrl(raw?: string | null): number | null {
  if (raw === undefined) raw = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("t");
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

// ── vm_progress: where this wallet stopped in each video ──
export interface WatchProgress { videoId: string; positionSeconds: number; durationSeconds: number | null; updatedAt: number }
export async function getProgress(videoId: string): Promise<{ progress: WatchProgress | null; resumeAt: number | null }> {
  const res = await api.get(`/api/videos/${videoId}/progress`);
  return res.data;
}
/**
 * Save where the viewer is. `leaving` sends it with keepalive, so it still
 * arrives when the page is being closed.
 */
export async function saveProgress(videoId: string, positionSeconds: number, durationSeconds?: number, leaving = false): Promise<void> {
  const s = getSession();
  if (!s) return;
  const body = JSON.stringify({ positionSeconds, durationSeconds: durationSeconds && isFinite(durationSeconds) ? durationSeconds : undefined });
  if (leaving) {
    fetch(`${BASE}/api/videos/${videoId}/progress`, { method: "PUT", keepalive: true, headers: { "content-type": "application/json", authorization: `Bearer ${s.token}` }, body }).catch(() => {});
    return;
  }
  await api.put(`/api/videos/${videoId}/progress`, JSON.parse(body));
}
export async function clearProgress(videoId: string): Promise<void> {
  await api.delete(`/api/videos/${videoId}/progress`);
}
export interface ContinueItem { videoId: string; title: string; positionSeconds: number; durationSeconds: number | null; updatedAt: number; thumbUrl: string | null }
export interface MyProgress { continue: ContinueItem[]; watched: Record<string, { positionSeconds: number; durationSeconds: number | null; finished: boolean }> }
export async function getMyProgress(): Promise<MyProgress> {
  const res = await api.get("/api/progress");
  const d = res.data as MyProgress;
  for (const c of d.continue) if (c.thumbUrl) c.thumbUrl = absoluteUrl(c.thumbUrl);
  return d;
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
  return res.data as { id: string; status: string; jobs: VideoJob[]; generation?: Generated | null };
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

/** vm_search_page: one moment a search found, and the video it is in. */
export interface SearchMoment { time: number; end: number; text: string; score: number }
export interface SearchResult { videoId: string; title: string; score: number; category?: string | null; thumbUrl?: string | null; matches: SearchMoment[] }

/** Search every sentence of the signed in wallet's ready videos. */
export async function searchAllVideos(query: string, filter: { categories?: string[]; collectionId?: string } = {}) {
  const res = await api.post("/api/chat/search/all", { query, ...filter });
  const d = res.data as { results: SearchResult[]; notIndexed: number };
  for (const r of d.results) if (r.thumbUrl) r.thumbUrl = absoluteUrl(r.thumbUrl);
  return d;
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
  /** vm_charge: paths cost credits, so they are made only when asked for */
  needsBuild?: boolean;
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
  status: "uploading" | "generating" | "processing" | "transcribing" | "analyzing" | "ready" | "error";
  /** vm_content: taken down by VideoMind. Only the owner can still open it. */
  removed?: { at: number; reason: string } | null;
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
  /** vm_shelbyhome: why a video kept on Shelby only cannot play right now */
  shelbyGone?: "missing" | "lapsed" | "unconfirmed" | null;
  /** vm_storagecharge: the owner's storage is unpaid, so a video kept only on VideoMind does not play. */
  storagePaused?: boolean;
  /** vm_generate: made from a prompt. The prompt and the failure are for the owner only. */
  generated?: Generated | null;
  /** true once the owner has stored the file on Shelby */
  onShelby?: boolean;
  /** vm_info: the owner's details. Videos from before these existed are "unlisted". */
  category?: string | null;
  visibility?: Visibility;
  /** the owner's own tags (the AI's are in ai.tags) */
  tags?: string[];
  collection?: { id: string; name: string; position?: number } | null;
  /** vm_courses: this video's place in its course, among the lessons the viewer may open */
  course?: { id: string; name: string; lesson: number; lessons: number; prev: { id: string; title: string } | null; next: { id: string; title: string } | null } | null;
  /** true when the signed in wallet owns this video. Only sent with one video, not with the list. */
  isOwner?: boolean;
  /** vm_profile: the name on the owner's public page, if they set one */
  ownerName?: string | null;
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

// ── vm_profile: public pages, your profile, your wallet ─────────────────────
export interface ProfileCard {
  id: string; title: string; description: string | null; category: string | null;
  durationSeconds: number | null; createdAt: number; thumbUrl: string | null; chapters: number;
  collection: { id: string; name: string; position?: number } | null;
}
export interface PublicProfile {
  wallet: string; name: string | null; bio: string | null;
  videos: ProfileCard[];
  courses: Array<{ id: string; name: string; description: string | null; lessons: number; firstVideoId: string; thumbUrl: string | null }>;
}
export interface MyProfile { wallet: string; name: string | null; bio: string | null }
export type WalletState = AnchorState | "never";
export interface WalletOverview {
  wallet: string;
  summary: { videos: number; verified: number; checking: number; never: number; attention: number; storedBytesNow: number };
  videos: Array<{
    id: string; title: string; visibility: Visibility; thumbUrl: string | null; sizeBytes: number | null;
    state: WalletState; paidUntil: number | null; stores: number; endingSoon: boolean; attention: boolean; canStoreAgain: boolean;
  }>;
  usage: { days: number; since: number; totals: Array<{ feature: string; metric: string; unit: string; total: number; events: number }> };
}
export const getPublicProfile = (wallet: string) => call<PublicProfile>(() => raw.get(`/api/profiles/${encodeURIComponent(wallet)}`));
export const getMyProfile = () => call<MyProfile>(() => raw.get("/api/me/profile"));
export const saveMyProfile = (p: { name: string | null; bio: string | null }) => call<MyProfile>(() => raw.put("/api/me/profile", p));
export const getMyWallet = () => call<WalletOverview>(() => raw.get("/api/me/wallet"));

// ── vm_credits: the wallet's credits, in micro dollars (1 dollar = 1,000,000) ──
export type CreditKind = "welcome" | "grant" | "remove" | "topup" | "charge" | "refund";
export type CreditAction = "process_video" | "ask" | "search" | "learn_paths" | "learn_ask" | "live_captions" | "storage" | "generate_video" | "translate" | "live" | "generate_direct";
export type CreditUnit = "minute" | "answer" | "search" | "generation" | "gb_month" | "second";
export interface CreditEntry { id: string; at: number; kind: CreditKind; amountMicros: number; action: string | null; quantity: number | null; videoId: string | null; refunded: boolean; txHash: string | null }
export interface MyCredits {
  wallet: string; balanceMicros: number; heldMicros: number; availableMicros: number; charging: boolean;
  entries: CreditEntry[];
  prices: Array<{ id: CreditAction; unit: CreditUnit; microsPerUnit: number }>;
  /** vm_storagecharge: what this wallet keeps on VideoMind's storage and owes for it (Part 16e). */
  storage?: StorageStatus;
  /** vm_spendcap: the monthly spending limit (null: none) and this month's spending (Part 20d). */
  cap?: SpendingCap;
}
export interface SpendingCap { monthlyMicros: number | null; spentMonthMicros: number; heldMicros: number; reached: boolean }
export const setSpendingCap = (usd: string | null) => call<{ cap: SpendingCap }>(() => raw.put("/api/credits/cap", { usd }));
export interface StorageStatus {
  bytes: number; freeBytes: number; microsPerGbMonth: number; dailyMicros: number;
  owedMicros: number; owedSince: number | null; pausesAt: number | null; paused: boolean; graceDays: number;
}
export const getMyCredits = () => call<MyCredits>(() => raw.get("/api/credits/me"));
// vm_charge: the price of each action, for anyone
// vm_priceshapes: processMinMinutes, the minutes charged at least per processed video
export const getCreditPrices = () => call<{ charging: boolean; prices: MyCredits["prices"]; processMinMinutes?: number }>(() => raw.get("/api/credits/prices"));
// vm_topup: adding credits with ShelbyUSD
export interface TopupInfo {
  enabled: boolean; network: string; asset: string; symbol: string; decimals: number;
  treasury: string | null; minUsd: number; maxUsd: number; walletUnits: string | null;
}
export interface TopupResult { added: boolean; alreadyAdded: boolean; amountMicros: number; txHash: string; balanceMicros: number; availableMicros: number }
export const getTopupInfo = () => call<TopupInfo>(() => raw.get("/api/credits/topup"));
export const claimTopup = (hash: string) => call<TopupResult>(() => raw.post("/api/credits/topup", { hash }));

// ── vm_clips: clips cut from a video, for its owner ─────────────────────────
export type ClipKind = "cut" | "social";
export type ClipFrame = "original" | "vertical" | "square" | "landscape";
export interface ClipInfo {
  id: string; kind: ClipKind; frame: ClipFrame; captions: boolean; startSeconds: number; endSeconds: number;
  title: string; status: "queued" | "making" | "ready" | "failed"; note: string | null; error: string | null;
  sizeBytes: number | null; fileName: string | null; createdAt: number; updatedAt: number;
}
export interface ClipList { clips: ClipInfo[]; limits: { cutSeconds: number; socialSeconds: number }; canMake: boolean; captionsDrawn: boolean }
export const getClips = (videoId: string) => call<ClipList>(() => raw.get(`/api/videos/${videoId}/clips`));
export const makeClip = (videoId: string, c: { kind: ClipKind; frame?: ClipFrame; captions?: boolean; startSeconds: number; endSeconds: number; title?: string }) =>
  call<{ clip: ClipInfo }>(() => raw.post(`/api/videos/${videoId}/clips`, c));
export const retryClip = (videoId: string, clipId: string) => call<{ clip: ClipInfo }>(() => raw.post(`/api/videos/${videoId}/clips/${clipId}/retry`));
export const deleteClip = (videoId: string, clipId: string) => call<{ deleted: string }>(() => raw.delete(`/api/videos/${videoId}/clips/${clipId}`));
/** A short lived address for the file. A relative one (local storage) is made absolute here. */
export async function clipDownload(videoId: string, clipId: string): Promise<{ url: string; fileName: string | null }> {
  const r = await call<{ url: string; fileName: string | null }>(() => raw.get(`/api/videos/${videoId}/clips/${clipId}/download`));
  return { ...r, url: absoluteUrl(r.url) };
}
export const clipCaptions = (videoId: string, clipId: string) =>
  call<string>(() => raw.get(`/api/videos/${videoId}/clips/${clipId}/captions`, { responseType: "text", transformResponse: (d) => d }));

// ── vm_live: live events ─────────────────────────────────────────────────────
export type LiveStatus = "scheduled" | "live" | "ended";
export interface LiveEventInfo {
  id: string; title: string; status: LiveStatus; wallet: string; hostName: string | null;
  startedAt: number | null; endedAt: number | null; videoId: string | null; createdAt: number;
  restreaming?: boolean; peakViewers?: number;
  // vm_livechat
  chatMode: ChatMode; captions: boolean;
  captionsAvailable?: boolean; captionSeconds?: number; captionLimitMinutes?: number;
  // vm_livesession: the end time for everyone; the length and what can still be added for the host
  endsAt: number | null; lengthMin: number | null; extendMin: number | null; extendChoices?: number[];
  // vm_liveviewers
  viewerLimit: number | null; viewerMinutes?: number;
}
export interface LiveConfigInfo { enabled: boolean; maxViewers: number; sessionMinutes: number[]; extendMinutes: number[]; maxSessionMinutes: number; viewerChoices?: number[] }
export const getLiveConfig = () => call<LiveConfigInfo>(() => raw.get("/api/live/config"));
export const getMyLiveEvents = () => call<{ events: LiveEventInfo[]; enabled: boolean }>(() => raw.get("/api/live/mine"));
export const createLiveEvent = (title: string) => call<{ event: LiveEventInfo }>(() => raw.post("/api/live", { title }));
export const getLiveEvent = (id: string) => call<{ event: LiveEventInfo }>(() => raw.get(`/api/live/${id}`));
export const liveHostToken = (id: string, viewers?: number) => call<{ url: string; token: string }>(() => raw.post(`/api/live/${id}/host-token`, viewers ? { viewers } : {}));
export const liveViewerToken = (id: string) => call<{ url: string; token: string; stage?: boolean }>(() => raw.post(`/api/live/${id}/viewer-token`));
// vm_stage (Part 21b1): viewers on stage
export type StageState = "raised" | "invited" | "speaking";
export interface StageEntry { wallet: string; name: string; note: string | null; state: StageState; raisedAt: number; updatedAt: number }
export interface MyStage { state: StageState | "none"; note: string | null; invitedAt: number | null; blocked: boolean; max: number; inviteMs: number }
export const getMyStage = (id: string) => call<MyStage>(() => raw.get(`/api/live/${id}/stage/me`));
export const raiseHand = (id: string, identity: string, note?: string) => call<{ state: StageState; note: string | null }>(() => raw.post(`/api/live/${id}/stage/hand`, { identity, note }));
export const leaveStage = (id: string) => call<{ state: "none" }>(() => raw.delete(`/api/live/${id}/stage/hand`));
export const acceptStage = (id: string) => call<{ state: StageState }>(() => raw.post(`/api/live/${id}/stage/accept`));
export const getStage = (id: string) => call<{ hands: StageEntry[]; invited: StageEntry[]; speakers: StageEntry[]; max: number; inviteMs: number }>(() => raw.get(`/api/live/${id}/stage`));
export const inviteToStage = (id: string, wallet: string) => call<{ invited: StageEntry }>(() => raw.post(`/api/live/${id}/stage/${encodeURIComponent(wallet)}/invite`));
export const muteOnStage = (id: string, wallet: string, kind: "audio" | "video") => call<{ ok: boolean }>(() => raw.post(`/api/live/${id}/stage/${encodeURIComponent(wallet)}/mute`, { kind }));
export const removeFromStage = (id: string, wallet: string) => call<{ removed: boolean }>(() => raw.post(`/api/live/${id}/stage/${encodeURIComponent(wallet)}/remove`));
export const startLive = (id: string, restream: string[], minutes: number) => call<{ event: LiveEventInfo; restreamError: string | null }>(() => raw.post(`/api/live/${id}/start`, { restream, minutes }));
/** vm_livesession: add time once while live. */
/** vm_reactions: send a reaction into a live event (no wallet needed). */
export const sendLiveReaction = (id: string, kind: string) => call<{ ok: boolean }>(() => raw.post(`/api/live/${id}/react`, { kind }));
export const extendLive = (id: string, minutes: number) => call<{ event: LiveEventInfo }>(() => raw.post(`/api/live/${id}/extend`, { minutes }));
export const endLive = (id: string) => call<{ event: LiveEventInfo }>(() => raw.post(`/api/live/${id}/end`));
export const liveStats = (id: string) => call<{ viewers: number; peakViewers: number; status: LiveStatus; endsAt: number | null; viewerLimit?: number | null; viewerMinutes?: number }>(() => raw.get(`/api/live/${id}/stats`));
export const linkLiveRecording = (id: string, videoId: string) => call<{ event: LiveEventInfo }>(() => raw.post(`/api/live/${id}/recording`, { videoId }));

// ── vm_youtube: publishing to the owner's YouTube channel ────────────────────
export type YouTubePrivacy = "private" | "unlisted" | "public";
export interface YouTubeStatus { enabled: boolean; connected: boolean; email: string | null; connectedAt?: number | null }
export interface PublicationInfo {
  id: string; clipId: string | null; title: string; privacy: YouTubePrivacy; status: "queued" | "uploading" | "done" | "failed";
  sentBytes: number; totalBytes: number | null; error: string | null; url: string | null; studioUrl: string | null;
  createdAt: number; updatedAt: number;
}
export interface PublicationList {
  enabled: boolean; publications: PublicationInfo[];
  suggested: { title: string; description: string; tags: string[] };
  limits: { perDay: number; usedToday: number };
}
export interface PublishRequest { clipId?: string | null; title: string; description: string; tags: string[]; privacy: YouTubePrivacy; madeForKids: boolean }
export const getYouTubeStatus = () => call<YouTubeStatus>(() => raw.get("/api/youtube/status"));
export const connectYouTube = (returnTo: string) => call<{ url: string }>(() => raw.post("/api/youtube/connect", { returnTo }));
export const disconnectYouTube = () => call<{ ok: boolean }>(() => raw.post("/api/youtube/disconnect"));
export const getPublications = (videoId: string) => call<PublicationList>(() => raw.get(`/api/videos/${videoId}/youtube`));
export const publishToYouTube = (videoId: string, p: PublishRequest) => call<{ publication: PublicationInfo }>(() => raw.post(`/api/videos/${videoId}/youtube`, p));
export const retryPublication = (videoId: string, pubId: string) => call<{ publication: PublicationInfo }>(() => raw.post(`/api/videos/${videoId}/youtube/${pubId}/retry`));

// ── vm_livechat: live captions and chat ──────────────────────────────────────
export type ChatMode = "anyone" | "wallets" | "off";
export interface ChatMessageInfo { id: string; name: string; host: boolean; wallet: boolean; text: string; at: number; from: string }
export interface ChatPassInfo { token: string; name: string; host: boolean; from: string }
export const updateLiveSettings = (id: string, s: { chatMode?: ChatMode; captions?: boolean }) =>
  call<{ event: LiveEventInfo }>(() => raw.patch(`/api/live/${id}/settings`, s));
export const joinLiveChat = (id: string, name?: string) => call<ChatPassInfo>(() => raw.post(`/api/live/${id}/chat/join`, name ? { name } : {}));
export const getLiveChat = (id: string) => call<{ messages: ChatMessageInfo[]; chatMode: ChatMode; status: LiveStatus }>(() => raw.get(`/api/live/${id}/chat`));
export const sendLiveChat = (id: string, token: string, text: string) => call<{ message: ChatMessageInfo }>(() => raw.post(`/api/live/${id}/chat`, { token, text }));
export const deleteLiveChat = (id: string, msgId: string) => call<{ deleted: string[] }>(() => raw.delete(`/api/live/${id}/chat/${msgId}`));
export const blockLiveChat = (id: string, msgId: string) => call<{ removed: number }>(() => raw.post(`/api/live/${id}/chat/${msgId}/block`));
export const getLiveCaptions = (id: string) => call<{ lines: Array<{ at: number; text: string }> }>(() => raw.get(`/api/live/${id}/captions`));
/** The WebSocket address for sending the studio's sound, with its one use ticket. */
export async function liveCaptionsSocket(id: string): Promise<string> {
  const r = await call<{ ticket: string; path: string }>(() => raw.post(`/api/live/${id}/captions/ticket`));
  return `${absoluteUrl(r.path).replace(/^http/, "ws")}?ticket=${encodeURIComponent(r.ticket)}`;
}

// ── vm_settings: the signed in wallet's settings ─────────────────────────────
// vm_lang: the wallet's interface language travels with its settings.
import type { Locale } from "@/i18n/config";
export interface MySettings { uploadVisibility: "private" | "unlisted" | "public" | null; uploadCategory: string | null; language: Locale | null }
export const getMySettings = () => call<{ wallet: string; sessionExpiresAt: number; activeSessions: number; settings: MySettings }>(() => raw.get("/api/me/settings"));
export const saveMySettings = (s: Partial<{ uploadVisibility: string | null; uploadCategory: string | null; language: Locale | null }>) => call<{ settings: MySettings }>(() => raw.put("/api/me/settings", s));
export const logoutEverywhere = () => call<{ ended: number }>(() => raw.post("/api/me/logout-everywhere"));
export const deleteMyData = () => call<{ deleted: Record<string, number> }>(() => raw.post("/api/me/delete", { confirm: "DELETE" }, { timeout: 300_000 }));

// ── vm_analytics: play counts and the owner's numbers ────────────────────────
/**
 * Report this tab's plays of a video. Answers { stop: true } when the server
 * will not count this tab (the owner, a video it cannot see, or the daily
 * cap), and null when the report did not arrive.
 */
export async function reportView(videoId: string, body: { tab: string; watched: number; reached: number }, leaving = false): Promise<{ stop: boolean } | null> {
  const s = getSession();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (s) headers.authorization = `Bearer ${s.token}`;
  try {
    const r = await fetch(`${BASE}/api/videos/${encodeURIComponent(videoId)}/views`, { method: "POST", keepalive: leaving, headers, body: JSON.stringify(body) });
    if (r.status === 400 || r.status === 404) return { stop: true };
    if (!r.ok) return null;
    const d = await r.json().catch(() => ({}));
    return { stop: d.reason === "owner" || d.reason === "caller_limit" };
  } catch { return null; }
}
export type AnalyticsRange = 7 | 28 | 90 | 365;
export interface AnalyticsTotals { views: number; watchSeconds: number; ended: number }
export interface AnalyticsVideo {
  id: string; title: string; status: string; visibility: "private" | "unlisted" | "public"; createdAt: number; durationSeconds: number | null;
  views: number; watchSeconds: number; ended: number; allTimeViews: number; signedInViewers: number; youtube: number; clips: number;
}
export interface AnalyticsLive {
  id: string; title: string; status: string; startedAt: number | null; endedAt: number | null; durationSeconds: number | null;
  peakViewers: number; chatMessages: number; captionSeconds: number; videoId: string | null;
}
export interface Analytics {
  days: AnalyticsRange; from: string; to: string; videoId: string | null;
  totals: AnalyticsTotals; previous: AnalyticsTotals;
  daily: Array<{ day: string; views: number; watchSeconds: number }>;
  videos: AnalyticsVideo[]; live: AnalyticsLive[];
}
export const getAnalytics = (days: AnalyticsRange, videoId?: string | null) =>
  call<Analytics>(() => raw.get("/api/me/analytics", { params: { days, ...(videoId ? { video: videoId } : {}) } }));

// ── vm_generate: videos made from a prompt (Part 17b2) ─────────────────────
export interface Generated { model: string; seconds: number; aspect: string; status: "queued" | "running" | "succeeded" | "failed"; prompt: string | null; errorCode: string | null; createdAt: number;
  /** vm_generate: how many shots, and how many are made */
  shots?: number; shotsDone?: number }
export interface GenerateInfo { allowed: boolean; budgetReached: boolean; models: Array<{ id: string; label: string; minSeconds: number; maxSeconds: number; resolution: string }>; maxShots?: number; maxTotalSeconds?: number }
export interface ShotInput { prompt: string; seconds: number }
export const getGenerateInfo = () => call<GenerateInfo>(() => raw.get("/api/generate"));
export const startGeneration = (b: { prompt: string; modelId: string; seconds: number; aspect: "16:9" | "9:16"; title?: string; visibility: "private" | "unlisted" | "public"; shots?: ShotInput[] }) =>
  call<{ videoId: string; generationId: string; costMicros: number }>(() => raw.post("/api/generate", b));
export interface Direction { modelId: string; seconds: number; aspect: "16:9" | "9:16"; prompt: string; title: string; why: string; problem: string | null }
export const directGeneration = (b: { idea: string; aspect?: string; seconds?: number; modelId?: string }) => call<Direction>(() => raw.post("/api/generate/direct", b));
export interface StoryDirection { modelId: string; aspect: "16:9" | "9:16"; title: string; why: string; problem: string | null; shots: ShotInput[] }
export const directStory = (b: { idea: string; aspect?: string; modelId?: string; shots?: number }) => call<StoryDirection>(() => raw.post("/api/generate/direct", { ...b, mode: "story" }));
