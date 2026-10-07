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
app.use("/api/videos", videosRouter);
app.use("/api/chat", chatRouter);
app.use("/api/shelby", statsRouter);
app.use("/api/learn", learnRouter);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "VideoMind API", timestamp: new Date().toISOString() });
});

// vm_shelby09d: the 6-hourly blob renewal cron is gone. Shelby storage is
// prepaid in payment epochs at registration and the contract has no renew call.

async function main() {
  await migrate();

  // vm_jobs: the job runner lives in this service until uploads move to
  // shared storage. JOBS_RUNNER=off turns it off here (see src/worker.ts).
  let runner: Runner | null = null;
  if (process.env.JOBS_RUNNER !== "off") {
    registerPipeline();
    runner = startRunner();
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
