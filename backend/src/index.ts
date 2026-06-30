import "dotenv/config";
import express from "express";
import cors from "cors";
import { migrate } from "./lib/db.js";
import { renewExpiringBlobs } from "./cron/renewBlobs.js";
import videosRouter from "./routes/videos.js";
import chatRouter from "./routes/chat.js";
import statsRouter from "./routes/stats.js";
import cron from "node-cron";

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

app.use("/api/videos", videosRouter);
app.use("/api/chat", chatRouter);
app.use("/api/shelby", statsRouter);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "VideoMind API", timestamp: new Date().toISOString() });
});

cron.schedule("0 */6 * * *", () => {
  console.log("[Cron] Blob renewal check — wallet-owned blobs renewed via frontend.");
  renewExpiringBlobs().catch(console.error);
});

async function main() {
  await migrate();
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
