import "dotenv/config";

// Video blobs are wallet-owned (uploaded by Petra on the frontend).
// The backend has no authority to renew them.
// Renewal is handled by the ExpiryBanner component on the frontend.
export async function renewExpiringBlobs() {
  console.log("[Renew] Video blobs are wallet-owned — renewal handled by frontend.");
  console.log("[Renew] Done. Renewed 0 blob(s).");
}

renewExpiringBlobs().catch(console.error);
