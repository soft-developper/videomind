"use client";
// vm_analytics: counts plays for the video's owner, without cookies.
//
// The tab gets a random id, kept in sessionStorage (gone when the tab is
// closed). After 5 seconds of playing the tab tells the server once, then
// reports its running total of seconds played every 30 seconds, on pause,
// at the end and when the page is left. Seeking does not add time: only
// steps of normal playing are added up. The server ignores the owner's
// own plays, and then this tab stops reporting.
import { useCallback, useEffect, useRef } from "react";
import { reportView } from "./api";

const TAB_KEY = "vm.tab";
const FIRST_AT = 5;
const EVERY = 30;
let fallbackTab: string | null = null;

function newId(): string {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
function tabId(): string {
  try {
    let id = sessionStorage.getItem(TAB_KEY);
    if (!id || !/^[A-Za-z0-9_-]{8,48}$/.test(id)) { id = newId(); sessionStorage.setItem(TAB_KEY, id); }
    return id;
  } catch {
    return (fallbackTab ??= newId());
  }
}

export interface ViewCounter {
  /** Call on every timeupdate with where the video is and whether it is playing. */
  onTime: (seconds: number, duration: number, playing: boolean) => void;
  /** Call on pause and at the end. */
  flush: () => void;
}

export function useViewCounter(videoId: string | null | undefined): ViewCounter {
  const st = useRef({ last: -1, watched: 0, sent: 0, furthest: 0, duration: 0, started: false, off: false, busy: false });

  // A new video starts a new count.
  useEffect(() => {
    st.current = { last: -1, watched: 0, sent: 0, furthest: 0, duration: 0, started: false, off: false, busy: false };
  }, [videoId]);

  const send = useCallback((leaving = false) => {
    const s = st.current;
    if (!videoId || s.off || s.watched < FIRST_AT) return;
    if (s.started && s.watched - s.sent < 1) return;
    if (s.busy && !leaving) return;
    const watched = Math.round(s.watched * 10) / 10;
    const reached = s.duration > 0 ? Math.min(1, s.furthest / s.duration) : 0;
    const first = !s.started;
    s.started = true; s.sent = watched; s.busy = true;
    reportView(videoId, { tab: tabId(), watched, reached }, leaving)
      .then((r) => {
        if (r?.stop) s.off = true;
        // The first report did not arrive: send it again at the next step.
        else if (!r && first) s.started = false;
      })
      .finally(() => { s.busy = false; });
  }, [videoId]);

  const onTime = useCallback((t: number, duration: number, playing: boolean) => {
    const s = st.current;
    if (!videoId || s.off) return;
    if (isFinite(duration) && duration > 0) s.duration = duration;
    const step = t - s.last;
    // Only small forward steps while playing are time watched; a seek is not.
    if (playing && s.last >= 0 && step > 0 && step <= 1.5) {
      s.watched += step;
      if (t > s.furthest) s.furthest = t;
    }
    s.last = t;
    if (!s.started ? s.watched >= FIRST_AT : s.watched - s.sent >= EVERY) send();
  }, [videoId, send]);

  const flush = useCallback(() => send(), [send]);

  // Leaving the page, or hiding it (a phone switching apps), sends what is left.
  useEffect(() => {
    if (!videoId) return;
    const away = () => send(true);
    const hidden = () => { if (document.visibilityState === "hidden") send(true); };
    window.addEventListener("pagehide", away);
    document.addEventListener("visibilitychange", hidden);
    return () => { window.removeEventListener("pagehide", away); document.removeEventListener("visibilitychange", hidden); send(true); };
  }, [videoId, send]);

  return { onTime, flush };
}
