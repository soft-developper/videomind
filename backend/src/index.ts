import "dotenv/config";
import express from "express";
import cors from "cors";
import { migrate } from "./lib/db.js";
import videosRouter from "./routes/videos.js";
import chatRouter from "./routes/chat.js";
import statsRouter from "./routes/stats.js";
import learnRouter from "./routes/learn.js";
import authRouter from "./routes/auth.js";
// vm_jobs: durable processing jobs
import { startRunner, type Runner } from "./lib/runner.js";
import { registerPipeline } from "./services/pipeline.js";
// vm_storage: file storage and the usage ledger
import usageRouter from "./routes/usage.js";
// vm_upload: resumable uploads straight to storage
import uploadsRouter from "./routes/uploads.js";
import { checkStorage, storageHealth } from "./lib/storage.js";
import { startHousekeeping } from "./lib/assets.js";
// vm_info: collections of videos
import collectionsRouter from "./routes/collections.js";
// vm_notes
import notesRouter from "./routes/notes.js";
// vm_progress
import progressRouter from "./routes/progress.js";
import clipsRouter from "./routes/clips.js";
import translationsRouter from "./routes/translations.js"; // vm_translate
import liveRouter from "./routes/live.js";
import profilesRouter from "./routes/profiles.js";
import { youtubeRouter, youtubeVideoRouter } from "./routes/youtube.js";
import { attachCaptions } from "./lib/livecaptions.js";
import { endDueEvents, sampleAllViewers } from "./lib/live.js";
import settingsRouter from "./routes/settings.js";
// vm_analytics: play counts without cookies, and the owner's numbers
import { viewsRouter, analyticsRouter } from "./routes/analytics.js";
// vm_admin: the admin dashboard (dashboard.vidzmind.xyz)
import adminRouter from "./routes/admin.js";
// vm_media: thumbnails and video facts need FFmpeg
import { checkMediaTools, mediaHealth } from "./lib/media.js";
// vm_credits: a wallet's credits
import creditsRouter from "./routes/credits.js";
import generateRouter from "./routes/generate.js"; // vm_generate

const app = express();
const PORT = process.env.PORT ?? 4000;

const allowedOrigins = (process.env.FRONTEND_URL ?? "http://localhost:3000")
  .split(",").map((s) => s.trim()).filter(Boolean);
// vm_admin: the admin dashboard has its own address (default https://dashboard.vidzmind.xyz).
// Added after FRONTEND_URL, so the first FRONTEND_URL entry stays the main site.
const dashboardOrigin = (process.env.DASHBOARD_URL ?? "https://dashboard.vidzmind.xyz").trim().replace(/\/+$/, "");
if (dashboardOrigin && !allowedOrigins.includes(dashboardOrigin)) allowedOrigins.push(dashboardOrigin);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: ${origin} not allowed`));
  },
  credentials: true,
}));

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// vm_signin: wallet sign in and sessions
app.use("/api/auth", authRouter);
app.use("/api/uploads", uploadsRouter);
app.use("/api/videos", videosRouter);
app.use("/api/videos", notesRouter);   // vm_notes: /api/videos/:id/notes
app.use("/api/videos", clipsRouter);   // vm_clips: /api/videos/:id/clips
app.use("/api/videos", translationsRouter); // vm_translate: /api/videos/:id/translations
app.use("/api", progressRouter);          // vm_progress: /api/videos/:id/progress, /api/progress
app.use("/api", profilesRouter);           // vm_profile: /api/profiles/:wallet, /api/me/profile, /api/me/wallet
app.use("/api/live", liveRouter);           // vm_live: live events
app.use("/api/youtube", youtubeRouter);     // vm_youtube: connect a channel
app.use("/api/videos", youtubeVideoRouter); // vm_youtube: /api/videos/:id/youtube
app.use("/api", settingsRouter);           // vm_settings: /api/me/settings, logout everywhere, delete my data
app.use("/api/videos", viewsRouter);       // vm_analytics: /api/videos/:id/views
app.use("/api", analyticsRouter);          // vm_analytics: /api/me/analytics
app.use("/api/admin", adminRouter);        // vm_admin: the admin dashboard
app.use("/api/chat", chatRouter);
app.use("/api/shelby", statsRouter);
app.use("/api/learn", learnRouter);
app.use("/api/usage", usageRouter);
app.use("/api/collections", collectionsRouter);
app.use("/api/credits", creditsRouter);       // vm_credits: balance and prices
app.use("/api/generate", generateRouter);     // vm_generate: videos made from a prompt

app.get("/api/health", (_req, res) => {
  const s = storageHealth();
  res.json({
    status: "ok", service: "VideoMind API", timestamp: new Date().toISOString(),
    // vm_storage: which storage is in use and whether its startup check passed
    storage: { driver: s.driver, durable: s.durable, ok: s.ok },
    // vm_media: the FFmpeg version found at startup, or null
    media: mediaHealth(),
  });
});

// vm_shelby09d: the 6-hourly blob renewal cron is gone. Shelby storage is
// prepaid in payment epochs at registration and the contract has no renew call.

async function main() {
  await migrate();

  // vm_storage: prove storage works before taking uploads. Wrong or
  // missing settings stop the start with a clear message. A storage that
  // cannot be reached is logged and the server still starts.
  await checkStorage();

  // vm_media: note which FFmpeg is installed. Its absence stops nothing.
  await checkMediaTools().catch(() => null);

  // vm_jobs: the job runner lives in this service by default.
  // JOBS_RUNNER=off turns it off here (see src/worker.ts).
  let runner: Runner | null = null;
  if (process.env.JOBS_RUNNER !== "off") {
    registerPipeline();
    runner = startRunner();
    startHousekeeping();
  }
  // On a deploy the platform sends SIGTERM. Hand running jobs back so the
  // next instance resumes them at once.
  const shutdown = async () => {
    if (runner) await runner.stop().catch(() => {});
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  const server = app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════╗
║       VideoMind API Server               ║
║       Running on port ${PORT}              ║
║       Shelby Testnet ✓                   ║
║       Turso DB ✓                         ║
╚══════════════════════════════════════════╝
    `);
  });
  // vm_livechat: the studio sends its sound for live captions over a WebSocket on the same port.
  attachCaptions(server);
  // vm_livesession: live events end at their end time, even when nobody is looking.
  const due = setInterval(() => { endDueEvents().catch((err) => console.error(`[live] ending due events failed: ${err?.message ?? err}`)); }, 15_000);
  due.unref();
  // vm_liveviewers: viewers are counted every 30 seconds, for charging by viewer minute.
  const count = setInterval(() => { sampleAllViewers().catch((err) => console.error(`[live] counting viewers failed: ${err?.message ?? err}`)); }, 30_000);
  count.unref();
}

main().catch((err) => { console.error("Failed to start:", err); process.exit(1); });
