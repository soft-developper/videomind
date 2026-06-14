import axios, { type AxiosError } from "axios";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export const api = axios.create({ baseURL: BASE, timeout: 120_000 });

// ── Global error interceptor ─────────────────────────────────────────────────
api.interceptors.response.use(
  (res) => res,
  (err: AxiosError<{ error?: string }>) => {
    const serverMsg = err.response?.data?.error;
    const statusCode = err.response?.status;
    let message: string;
    if (serverMsg) {
      message = serverMsg;
    } else if (err.code === "ECONNABORTED" || err.message.includes("timeout")) {
      message = "Request timed out. The server may be busy — please try again.";
    } else if (!err.response) {
      message = "Cannot reach the VideoMind server. Is the backend running?";
    } else if (statusCode === 413) {
      message = "File is too large. Maximum size is 2 GB.";
    } else if (statusCode === 415) {
      message = "Unsupported file type. Please upload MP4, WebM, MOV, AVI, or MKV.";
    } else if (statusCode === 500) {
      message = "Server error. Check the backend logs for details.";
    } else {
      message = err.message ?? "An unexpected error occurred.";
    }
    return Promise.reject(new Error(message));
  }
);

// ── Video endpoints ──────────────────────────────────────────────────────────

export async function prepareVideo(
  file: File,
  title: string,
  description: string,
  onProgress?: (pct: number) => void
): Promise<{ id: string; videoBlobName: string; base64Data: string; mimeType: string }> {
  const form = new FormData();
  form.append("video", file);
  form.append("title", title);
  form.append("description", description);
  const res = await api.post("/api/videos/prepare", form, {
    headers: { "Content-Type": "multipart/form-data" },
    onUploadProgress: (e) => {
      if (e.total) onProgress?.(Math.round((e.loaded / e.total) * 100));
    },
  });
  return res.data;
}

export async function confirmVideo(payload: {
  id: string; accountAddress: string; txHash: string; videoBlobName: string;
}): Promise<{ id: string; status: string }> {
  const res = await api.post("/api/videos/confirm", payload);
  return res.data;
}

/** Fetch videos for a specific wallet. Returns [] when no wallet connected. */
export async function getVideos(walletAddress?: string): Promise<VideoRecord[]> {
  if (!walletAddress) return [];
  const res = await api.get("/api/videos", { params: { wallet: walletAddress } });
  return res.data.videos as VideoRecord[];
}

export async function getVideo(id: string) {
  const res = await api.get(`/api/videos/${id}`);
  return res.data as VideoRecord & { streamUrl: string | null };
}

export async function getVideoStatus(id: string) {
  const res = await api.get(`/api/videos/${id}/status`);
  return res.data as { id: string; status: string };
}

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

/** Delete all videos for a wallet (cleanup). */
export async function deleteAllVideos(walletAddress: string) {
  const res = await api.delete("/api/videos/all", { params: { wallet: walletAddress } });
  return res.data as { success: boolean; deleted: number; message: string };
}

// ── Types ────────────────────────────────────────────────────────────────────
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
}
