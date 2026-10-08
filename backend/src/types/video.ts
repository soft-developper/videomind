// src/types/video.ts
export interface VideoRecord {
  id: string;
  title: string;
  description?: string;
  createdAt: number; // unix ms
  status: VideoStatus;
  /** vm_signin: wallet that reserved the upload (canonical 0x + 64 hex). */
  ownerWallet?: string;
  /** vm_info: what the owner says about the video. See src/lib/videoInfo.ts */
  category?: string | null;
  /** who may open the video. Videos from before this field existed are "unlisted". */
  visibility?: "private" | "unlisted" | "public";
  /** the owner's own tags, in the order they were typed (not the AI's, which are in ai.tags) */
  tags?: string[];
  /** position is the video's place in the collection's order */
  collection?: { id: string; name: string; position?: number } | null;
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
