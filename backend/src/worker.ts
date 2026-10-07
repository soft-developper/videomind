// src/worker.ts
// vm_jobs: run the job runner as its own service, with no HTTP server.
//
// Not used yet. It needs S3 storage (see src/lib/storage.ts), because
// with the local driver the uploaded file sits on the API service's own
// disk. With S3 storage in place, set JOBS_RUNNER=off on the API service
// and run this as a background worker (npm run worker).
import "dotenv/config";
import { migrate } from "./lib/db.js";
import { startRunner } from "./lib/runner.js";
import { registerPipeline } from "./services/pipeline.js";
import { checkStorage } from "./lib/storage.js";
import { startHousekeeping } from "./lib/assets.js";

async function main() {
  await migrate();
  await checkStorage();
  registerPipeline();
  const runner = startRunner();
  startHousekeeping();
  const stop = async () => { await runner.stop(); process.exit(0); };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

main().catch((err) => { console.error("Worker failed to start:", err); process.exit(1); });
