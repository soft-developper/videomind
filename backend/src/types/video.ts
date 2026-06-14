// src/types/video.ts
export interface VideoRecord {
  id: string;
  title: string;
  description?: string;
  createdAt: number; // unix ms
  status: VideoStatus;
  shelby: {
    videoBlobName: string;
    transcriptBlobName?: string;
    metaBlobName?: string;
    thumbnailBlobName?: string;
    accountAddress: string;
    videoTxHash: string;
    expiresAt?: number; // micros
  };
  ai?: VideoAIData;
  meta: {
    sizeBytes: number;
    mimeType: string;
    durationSeconds?: number;
  };
}

export type VideoStatus =
  | "uploading"
  | "processing"
  | "transcribing"
  | "analyzing"
  | "ready"
  | "error";

export interface VideoAIData {
  transcript?: TranscriptSegment[];
  summary?: string;
  chapters?: Chapter[];
  highlights?: Highlight[];
  tags?: string[];
  blogPost?: string;
  tweetThread?: string;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface Chapter {
  title: string;
  startSeconds: number;
  summary: string;
}

export interface Highlight {
  startSeconds: number;
  endSeconds: number;
  reason: string;
  text: string;
}
