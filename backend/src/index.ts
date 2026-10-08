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
// vm_media: thumbnails and video facts need FFmpeg
import { checkMediaTools, mediaHealth } from "./lib/media.js";

const app = express();
const PORT = process.env.PORT ?? 4000;

const allowedOrigins = (process.env.FRONTEND_URL ?? "http://localhost:3000")
  .split(",").map((s) => s.trim()).filter(Boolean);

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
app.use("/api/chat", chatRouter);
app.use("/api/shelby", statsRouter);
app.use("/api/learn", learnRouter);
app.use("/api/usage", usageRouter);
app.use("/api/collections", collectionsRouter);

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

  app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════╗
║       VideoMind API Server               ║
║       Running on port ${PORT}              ║
║       Shelby Testnet ✓                   ║
║       Turso DB ✓                         ║
╚══════════════════════════════════════════╝
    `);
  });
}

main().catch((err) => { console.error("Failed to start:", err); process.exit(1); });
