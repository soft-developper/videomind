// src/worker.ts
// vm_jobs: run the job runner as its own service, with no HTTP server.
//
// Not used yet. Today the uploaded file sits on the API service's own
// disk, so the runner has to live in the same service. Once uploads go
// to shared storage, set JOBS_RUNNER=off on the API service and run this
// as a background worker (npm run worker).
import "dotenv/config";
import { migrate } from "./lib/db.js";
import { startRunner } from "./lib/runner.js";
import { registerPipeline } from "./services/pipeline.js";

async function main() {
  await migrate();
  registerPipeline();
  const runner = startRunner();
  const stop = async () => { await runner.stop(); process.exit(0); };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

main().catch((err) => { console.error("Worker failed to start:", err); process.exit(1); });
