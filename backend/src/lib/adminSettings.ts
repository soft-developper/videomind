// src/lib/adminSettings.ts
// vm_admin_settings: the limits the server is running with, for the
// dashboard's Settings page. Read only: each one is changed by its setting
// on Render (LIMIT_* and the others named here), then a restart.
import { limitRules } from "./guard.js";
import { askBudgetPerVideo } from "./usage.js";
import { LIMITS as CLIP_LIMITS } from "./clips.js";
import { eventsPerDay } from "./live.js";
import { maxPerEvent } from "./livechat.js";
import { maxUploadBytes } from "./uploads.js";
import { perCallerDay } from "./views.js";
import { perWallet as youtubePerWallet, perProject as youtubePerProject } from "../routes/youtube.js";
import { MIN_PASSWORD, MAX_FAILS, LOCK_MINUTES, IDLE_MS, ABSOLUTE_MS } from "./admin.js";

const per = (ms: number) => (ms % 3600_000 === 0 ? `${ms / 3600_000} hour${ms === 3600_000 ? "" : "s"}` : `${Math.round(ms / 60_000)} minutes`);

export function limitsOverview() {
  return {
    rates: limitRules()
      .map((o) => ({ name: o.name, label: o.name.startsWith("admin_") ? `dashboard ${o.label}` : o.label, perCaller: { max: o.perClient.max, per: per(o.perClient.windowMs) }, everyone: { max: o.global.max, per: per(o.global.windowMs) } }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    caps: [
      { label: "Largest upload", value: `${Math.round(maxUploadBytes() / 1024 ** 3 * 10) / 10} GB`, setting: "UPLOAD_MAX_BYTES" },
      { label: "Answers to visitors per shared video, per day", value: String(askBudgetPerVideo()), setting: "ASK_BUDGET_PER_VIDEO_DAY" },
      { label: "Views counted per caller per video, per day", value: String(perCallerDay()), setting: "VIEWS_PER_CALLER_DAY" },
      { label: "Clips for social media per wallet, per day", value: String(CLIP_LIMITS.socialPerDay), setting: "CLIP_SOCIAL_PER_DAY" },
      { label: "Longest cut clip", value: `${CLIP_LIMITS.cut} seconds`, setting: "CLIP_CUT_MAX_SECONDS" },
      { label: "Longest social clip", value: `${CLIP_LIMITS.social} seconds`, setting: "CLIP_SOCIAL_MAX_SECONDS" },
      { label: "Live events per wallet, per day", value: String(eventsPerDay()), setting: "LIVE_EVENTS_PER_DAY" },
      { label: "Chat messages allowed per live event", value: String(maxPerEvent()), setting: "LIVE_CHAT_MAX_PER_EVENT" },
      { label: "YouTube uploads per wallet, per day", value: String(youtubePerWallet()), setting: "YOUTUBE_UPLOADS_PER_DAY" },
      { label: "YouTube uploads for the whole site, per day", value: String(youtubePerProject()), setting: "YOUTUBE_UPLOADS_PROJECT_DAY" },
    ],
    dashboard: [
      { label: "Shortest password", value: `${MIN_PASSWORD} characters` },
      { label: "Wrong answers before a lock", value: `${MAX_FAILS} in 15 minutes` },
      { label: "Lock", value: `${LOCK_MINUTES} minutes` },
      { label: "Session ends after", value: `${per(IDLE_MS)} without use, ${per(ABSOLUTE_MS)} in all` },
      { label: "Invitation link", value: "48 hours, works once" },
      { label: "Password reset link", value: "30 minutes, works once" },
    ],
  };
}
