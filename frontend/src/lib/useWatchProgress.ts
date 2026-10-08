"use client";
// vm_progress: remembers where the signed in viewer is in a video. Saved
// every 10 seconds of playing, on pause, at the end, and when the page is
// left. Nothing is saved for a visitor who has not signed in.
import { useCallback, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getProgress, saveProgress, clearProgress } from "./api";

const EVERY = 10;

export function useWatchProgress(videoId: string, wallet: string | undefined, ready: boolean) {
  const qc = useQueryClient();
  // Always asked fresh when the page opens: a place remembered from an
  // earlier visit in this tab would be out of date.
  const { data, isFetchedAfterMount } = useQuery({
    queryKey: ["progress", videoId, wallet ?? null],
    queryFn: () => getProgress(videoId),
    enabled: !!wallet && ready,
    staleTime: 0, gcTime: 0, refetchOnWindowFocus: false, retry: false,
  });
  const last = useRef<{ t: number; at: number } | null>(null);
  const latest = useRef<{ t: number; d: number } | null>(null);

  const report = useCallback((t: number, d: number, reason: "tick" | "pause" | "end") => {
    if (!wallet || !ready || !isFinite(t)) return;
    latest.current = { t, d };
    const now = Date.now();
    const moved = !last.current || Math.abs(t - last.current.t) >= EVERY;
    const due = !last.current || now - last.current.at >= EVERY * 1000;
    if (reason === "tick" && !(moved && due)) return;
    const at = reason === "end" ? d : t;
    last.current = { t: at, at: now };
    saveProgress(videoId, at, d).then(() => qc.invalidateQueries({ queryKey: ["my-progress"] })).catch(() => {});
  }, [videoId, wallet, ready, qc]);

  // Leaving the page (closing the tab, or another page in the app) saves the last position.
  useEffect(() => {
    const leave = () => {
      const l = latest.current;
      if (l && wallet && ready && (!last.current || Math.abs(l.t - last.current.t) >= 1)) {
        saveProgress(videoId, l.t, l.d, true);
        last.current = { t: l.t, at: Date.now() };
      }
    };
    window.addEventListener("pagehide", leave);
    return () => { window.removeEventListener("pagehide", leave); leave(); };
  }, [videoId, wallet, ready]);

  const startOver = useCallback(() => {
    last.current = null;
    clearProgress(videoId).then(() => qc.invalidateQueries({ queryKey: ["my-progress"] })).catch(() => {});
  }, [videoId, qc]);

  return { resumeAt: isFetchedAfterMount ? (data?.resumeAt ?? null) : null, report, startOver };
}
