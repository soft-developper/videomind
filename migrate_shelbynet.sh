#!/usr/bin/env bash
# VideoMind — migrate from Aptos Testnet to shelbynet
# Shelbynet is a SEPARATE, isolated network from Aptos Testnet:
#   fullnode: https://api.shelbynet.shelby.xyz/v1
#   faucet:   https://faucet.shelbynet.shelby.xyz
#   blob RPC: https://api.shelbynet.shelby.xyz/shelby
#   explorer: https://explorer.shelby.xyz/shelbynet
# Run from the project root (must contain frontend/ and backend/)

set -e
FE="$(pwd)/frontend"
BE="$(pwd)/backend"
[ -d "$FE" ] && [ -d "$BE" ] || { echo "❌ Run from project root"; exit 1; }

echo "🔀 Migrating to shelbynet..."
echo ""

# ═════════════════════════════════════════════════════════════════════════════
# 1. Shared network constants — one file, single source of truth
# ═════════════════════════════════════════════════════════════════════════════
mkdir -p "$FE/src/lib"
cat > "$FE/src/lib/network.ts" << 'EOF'
// src/lib/network.ts
// Shelbynet is a separate, isolated Aptos validator network — NOT the
// standard Aptos Testnet. Every URL below is specific to it.
// Ref: https://docs.shelby.xyz/protocol/architecture/networks

export const SHELBYNET = {
  name: "shelbynet",
  fullnode: "https://api.shelbynet.shelby.xyz/v1",
  faucet: "https://faucet.shelbynet.shelby.xyz",
  indexer: "https://api.shelbynet.shelby.xyz/v1/graphql",
  blobGateway: "https://api.shelbynet.shelby.xyz/shelby",
  explorer: "https://explorer.shelby.xyz/shelbynet",
} as const;
EOF
echo "✅ frontend/src/lib/network.ts"

cat > "$BE/src/lib/network.ts" << 'EOF'
// src/lib/network.ts
export const SHELBYNET = {
  name: "shelbynet",
  fullnode: "https://api.shelbynet.shelby.xyz/v1",
  faucet: "https://faucet.shelbynet.shelby.xyz",
  indexer: "https://api.shelbynet.shelby.xyz/v1/graphql",
  blobGateway: "https://api.shelbynet.shelby.xyz/shelby",
  explorer: "https://explorer.shelby.xyz/shelbynet",
} as const;
EOF
echo "✅ backend/src/lib/network.ts"

# ═════════════════════════════════════════════════════════════════════════════
# 2. Backend — shelbyClient.ts: Network.CUSTOM + shelbynet fullnode
# ═════════════════════════════════════════════════════════════════════════════
cat > "$BE/src/lib/shelbyClient.ts" << 'EOF'
// src/lib/shelbyClient.ts
import { ShelbyNodeClient } from "@shelby-protocol/sdk/node";
import { Ed25519Account, Ed25519PrivateKey, Network } from "@aptos-labs/ts-sdk";
import "dotenv/config";
import { SHELBYNET } from "./network.js";

const MAX_EXPIRY_HOURS = 47;
const MICROS_PER_HOUR = 3_600_000_000;

export function expirationMicros(hours = MAX_EXPIRY_HOURS): number {
  return Date.now() * 1000 + hours * MICROS_PER_HOUR;
}

let _account: Ed25519Account | null = null;
export function getShelbyAccount(): Ed25519Account {
  if (_account) return _account;
  const rawKey = process.env.APTOS_PRIVATE_KEY;
  if (!rawKey) throw new Error("APTOS_PRIVATE_KEY not set in .env");
  _account = new Ed25519Account({ privateKey: new Ed25519PrivateKey(rawKey) });
  return _account;
}

let _client: ShelbyNodeClient | null = null;
export function getShelbyClient(): ShelbyNodeClient {
  if (_client) return _client;
  const apiKey = process.env.APTOS_API_KEY;
  if (!apiKey) throw new Error("APTOS_API_KEY not set in .env");

  // Shelbynet is not one of Aptos's built-in named networks (mainnet/testnet/
  // devnet) — it must be passed as a custom network with an explicit fullnode.
  _client = new ShelbyNodeClient({
    network: Network.CUSTOM,
    fullnode: SHELBYNET.fullnode,
    apiKey,
  } as any);
  return _client;
}

export async function uploadToShelby(
  blobData: Buffer,
  blobName: string
): Promise<{ blobName: string; accountAddress: string; txHash: string }> {
  const client = getShelbyClient();
  const signer = getShelbyAccount();

  const result = await client.upload({
    signer,
    blobData,
    blobName,
    expirationMicros: expirationMicros(),
  }) as { transaction?: { hash: string } } | void;

  const txHash =
    result && typeof result === "object" && result.transaction
      ? result.transaction.hash
      : `upload-${Date.now()}`;

  return { blobName, accountAddress: signer.accountAddress.toString(), txHash };
}

export async function downloadFromShelby(blobName: string, ownerAddress: string): Promise<Buffer> {
  const client = getShelbyClient();
  const blob = await client.download({ account: ownerAddress, blobName });
  const chunks: Buffer[] = [];
  for await (const chunk of blob.readable) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/**
 * Direct HTTP URL to stream a blob from shelbynet.
 * Domain is api.shelbynet.shelby.xyz, NOT api.testnet.shelby.xyz.
 */
export function shelbyBlobUrl(blobName: string, ownerAddress: string): string {
  const encodedPath = blobName.split("/").map(encodeURIComponent).join("/");
  return `${SHELBYNET.blobGateway}/v1/blobs/${ownerAddress}/${encodedPath}`;
}
EOF
echo "✅ backend/src/lib/shelbyClient.ts  — Network.CUSTOM, shelbynet fullnode"

# ═════════════════════════════════════════════════════════════════════════════
# 3. Frontend — browser Shelby client
# ═════════════════════════════════════════════════════════════════════════════
cat > "$FE/src/lib/shelby.ts" << 'EOF'
// src/lib/shelby.ts
import { ShelbyClient } from "@shelby-protocol/sdk/browser";
import { SHELBYNET } from "./network";

export const shelbyClient = new ShelbyClient({
  network: "shelbynet" as any,
  fullnode: SHELBYNET.fullnode,
  apiKey: process.env.NEXT_PUBLIC_APTOS_API_KEY,
} as any);

export function expirationMicros(): number {
  return Date.now() * 1000 + 47 * 3_600_000_000;
}
EOF
echo "✅ frontend/src/lib/shelby.ts"

# ═════════════════════════════════════════════════════════════════════════════
# 4. Frontend — AppProviders: wallet adapter points at shelbynet
# ═════════════════════════════════════════════════════════════════════════════
cat > "$FE/src/components/layout/AppProviders.tsx" << 'EOF'
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AptosWalletAdapterProvider } from "@aptos-labs/wallet-adapter-react";
import { ShelbyClientProvider } from "@shelby-protocol/react";
import { useState } from "react";
import { shelbyClient } from "@/lib/shelby";
import { SHELBYNET } from "@/lib/network";

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 10_000 } },
  }));

  return (
    <QueryClientProvider client={queryClient}>
      <AptosWalletAdapterProvider
        autoConnect
        dappConfig={{
          // Shelbynet is a custom Aptos network — not testnet/mainnet/devnet.
          // Petra must have this same network added under Settings → Network
          // → Add Network, or switched to it if already present.
          network: "custom" as any,
          fullnode: SHELBYNET.fullnode,
          faucet: SHELBYNET.faucet,
          aptosApiKeys: {
            shelbynet: process.env.NEXT_PUBLIC_APTOS_API_KEY,
          } as any,
        }}
        onError={(error) => console.error("[Wallet]", error)}
      >
        <ShelbyClientProvider client={shelbyClient}>
          {children}
        </ShelbyClientProvider>
      </AptosWalletAdapterProvider>
    </QueryClientProvider>
  );
}
EOF
echo "✅ frontend/src/components/layout/AppProviders.tsx  — wallet points at shelbynet"

# ═════════════════════════════════════════════════════════════════════════════
# 5. Explorer links: /testnet/ → /shelbynet/, everywhere
# ═════════════════════════════════════════════════════════════════════════════
FILES_WITH_EXPLORER_LINKS=(
  "$FE/src/app/video/[id]/page.tsx"
  "$FE/src/app/v/[id]/page.tsx"
  "$FE/src/app/about/page.tsx"
  "$FE/src/components/video/VideoCard.tsx"
)

for f in "${FILES_WITH_EXPLORER_LINKS[@]}"; do
  if [ -f "$f" ]; then
    sed -i.bak 's#explorer\.shelby\.xyz/testnet#explorer.shelby.xyz/shelbynet#g' "$f"
    rm -f "$f.bak"
    echo "✅ $(basename "$f")  — explorer links → /shelbynet/"
  fi
done

# ═════════════════════════════════════════════════════════════════════════════
# 6. ExpiryBanner + RenewButton: blob fetch URL domain
# ═════════════════════════════════════════════════════════════════════════════
for f in "$FE/src/components/layout/ExpiryBanner.tsx"; do
  if [ -f "$f" ]; then
    sed -i.bak 's#api\.testnet\.shelby\.xyz/shelby/v1/blobs#api.shelbynet.shelby.xyz/shelby/v1/blobs#g' "$f"
    rm -f "$f.bak"
    echo "✅ $(basename "$f")  — blob fetch domain → shelbynet"
  fi
done

# ═════════════════════════════════════════════════════════════════════════════
# 7. Navbar + WalletButton: "Shelby Testnet" label → "Shelbynet"
# ═════════════════════════════════════════════════════════════════════════════
for f in "$FE/src/components/layout/Navbar.tsx" "$FE/src/app/v/[id]/page.tsx"; do
  if [ -f "$f" ]; then
    sed -i.bak 's/Shelby testnet/Shelbynet/g; s/Shelby Testnet/Shelbynet/g' "$f"
    rm -f "$f.bak"
    echo "✅ $(basename "$f")  — label → Shelbynet"
  fi
done

# ═════════════════════════════════════════════════════════════════════════════
# 8. .env.example files — updated comments
# ═════════════════════════════════════════════════════════════════════════════
cat > "$BE/.env.example" << 'EOF'
# ─── Shelbynet (NOT Aptos Testnet — a separate network) ────
# Fullnode:  https://api.shelbynet.shelby.xyz/v1
# Faucet:    https://faucet.shelbynet.shelby.xyz
# Explorer:  https://explorer.shelby.xyz/shelbynet
#
# Fund this account via the shelbynet faucet above, not the Aptos
# testnet faucet — they are different networks with separate balances.
APTOS_PRIVATE_KEY=ed25519-priv-0x...
APTOS_ACCOUNT_ADDRESS=0x...
APTOS_API_KEY=aptoslabs_...

# ─── Turso Database ────────────────────────────────────────
TURSO_DATABASE_URL=libsql://your-db-name-orgname.turso.io
TURSO_AUTH_TOKEN=your-turso-auth-token

# ─── AI APIs ──────────────────────────────────────────────
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# ─── Server ───────────────────────────────────────────────
PORT=4000
FRONTEND_URL=http://localhost:3000
EOF
echo "✅ backend/.env.example"

cat > "$FE/.env.example" << 'EOF'
NEXT_PUBLIC_API_URL=http://localhost:4000

# Same API key as backend — used for shelbynet, not Aptos testnet
NEXT_PUBLIC_APTOS_API_KEY=aptoslabs_...
EOF
echo "✅ frontend/.env.example"

echo ""
echo "════════════════════════════════════════════"
echo "✅ CODE MIGRATED TO SHELBYNET"
echo "════════════════════════════════════════════"
echo ""
echo "⚠️  MANUAL STEPS STILL REQUIRED (cannot be scripted):"
echo ""
echo "  1. Re-init your Shelby CLI on shelbynet:"
echo "       shelby init"
echo "       (select shelbynet when prompted for network)"
echo ""
echo "  2. Fund your backend account on shelbynet specifically:"
echo "       Faucet: https://faucet.shelbynet.shelby.xyz"
echo "       (your testnet balance does NOT carry over — separate network)"
echo ""
echo "  3. In Petra wallet: Settings → Network → Add Network"
echo "       Name:     Shelbynet"
echo "       Fullnode: https://api.shelbynet.shelby.xyz/v1"
echo "       Faucet:   https://faucet.shelbynet.shelby.xyz"
echo "     Then switch Petra to this network before uploading."
echo ""
echo "  4. Fund your Petra wallet on shelbynet (separate from testnet funds)."
echo ""
echo "  5. Old videos uploaded on testnet will NOT resolve on shelbynet —"
echo "     the blob gateway domain changed. Re-upload test videos after migrating."
echo ""
echo "  git add . && git commit -m 'migrate: Aptos Testnet → shelbynet' && git push"
