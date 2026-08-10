#!/usr/bin/env bash
# VideoMind — point the Shelby client at Shelby's OWN blob indexer
#
# ROOT CAUSE (proven by live diagnostics against shelbynet):
#
#   @aptos-labs/ts-sdk resolves Network.SHELBYNET's indexer to:
#     https://api.shelbynet.shelby.xyz/v1/graphql
#   ...which is the GENERIC APTOS chain indexer. It happens to have a
#   table literally named `blobs`, but with a totally different schema --
#   querying it for blob_name returns:
#     "field 'blob_name' not found in type: 'blobs'"
#
#   @shelby-protocol/sdk's own constants contain the CORRECT one:
#     https://api.shelbynet.aptoslabs.com/nocode/v1/public/alias/shelby/shelbynet/v1/graphql
#   ...which is Shelby's dedicated BLOB indexer with the real schema.
#
# Passing `indexer` explicitly stops the SDK falling back to the generic
# Aptos indexer.
#
# Run from the project root

set -e
FE="$(pwd)/frontend"
BE="$(pwd)/backend"
[ -d "$FE" ] && [ -d "$BE" ] || { echo "❌ Run from project root"; exit 1; }

echo "🔧 Pointing Shelby clients at Shelby's own blob indexer..."
echo ""

# ═════════════════════════════════════════════════════════════════════════
# 1. frontend/src/lib/network.ts — add the real Shelby indexer URL
# ═════════════════════════════════════════════════════════════════════════
cat > "$FE/src/lib/network.ts" << 'EOF'
// src/lib/network.ts
//
// IMPORTANT — there are TWO different indexers in play on shelbynet:
//
//   1. Generic Aptos chain indexer (what @aptos-labs/ts-sdk resolves
//      Network.SHELBYNET to by default):
//        https://api.shelbynet.shelby.xyz/v1/graphql
//      This has a `blobs` table, but it is NOT Shelby's blob index --
//      different schema entirely. Querying it for blob_name fails with
//      "field 'blob_name' not found in type: 'blobs'".
//
//   2. Shelby's DEDICATED blob indexer (from @shelby-protocol/sdk's own
//      constants) -- this is the one with the real blob schema:
//        https://api.shelbynet.aptoslabs.com/nocode/v1/public/alias/shelby/shelbynet/v1/graphql
//
// We pass #2 explicitly so the SDK never falls back to #1.
import { Network } from "@aptos-labs/ts-sdk";

export const SHELBYNET_NETWORK = Network.SHELBYNET;

export const SHELBYNET_URLS = {
  fullnode: "https://api.shelbynet.shelby.xyz/v1",
  shelbyRpc: "https://api.shelbynet.shelby.xyz/shelby",
  faucet: "https://faucet.shelbynet.shelby.xyz",
  explorer: "https://explorer.shelby.xyz/shelbynet",

  // Shelby's dedicated blob indexer -- NOT the generic Aptos one.
  blobIndexer:
    "https://api.shelbynet.aptoslabs.com/nocode/v1/public/alias/shelby/shelbynet/v1/graphql",
} as const;

export const SHELBYNET_EXPLORER = SHELBYNET_URLS.explorer;
EOF
echo "✅ frontend/src/lib/network.ts"

# ═════════════════════════════════════════════════════════════════════════
# 2. frontend/src/lib/shelby.ts — pass the indexer explicitly
# ═════════════════════════════════════════════════════════════════════════
cat > "$FE/src/lib/shelby.ts" << 'EOF'
// src/lib/shelby.ts
import { ShelbyClient } from "@shelby-protocol/sdk/browser";
import { Network } from "@aptos-labs/ts-sdk";
import { SHELBYNET_URLS } from "./network";

export const shelbyClient = new ShelbyClient({
  network: Network.SHELBYNET,
  apiKey: process.env.NEXT_PUBLIC_APTOS_API_KEY,
  // Explicitly target Shelby's own blob indexer. Without this the SDK
  // falls back to the generic Aptos chain indexer, whose `blobs` table
  // has a different schema and fails with
  // "field 'blob_name' not found in type: 'blobs'".
  indexer: {
    baseUrl: SHELBYNET_URLS.blobIndexer,
    apiKey: process.env.NEXT_PUBLIC_APTOS_API_KEY,
  },
} as any);

export function expirationMicros(): number {
  return Date.now() * 1000 + 47 * 3_600_000_000;
}
EOF
echo "✅ frontend/src/lib/shelby.ts"

# ═════════════════════════════════════════════════════════════════════════
# 3. backend/src/lib/network.ts
# ═════════════════════════════════════════════════════════════════════════
cat > "$BE/src/lib/network.ts" << 'EOF'
// src/lib/network.ts
import { Network } from "@aptos-labs/ts-sdk";

export const SHELBYNET_NETWORK = Network.SHELBYNET;
export const SHELBYNET_EXPLORER = "https://explorer.shelby.xyz/shelbynet";

// Shelby RPC (blob read/write gateway)
export const SHELBYNET_BLOB_GATEWAY = "https://api.shelbynet.shelby.xyz/shelby";

// Shelby's DEDICATED blob indexer -- not the generic Aptos chain indexer.
export const SHELBYNET_BLOB_INDEXER =
  "https://api.shelbynet.aptoslabs.com/nocode/v1/public/alias/shelby/shelbynet/v1/graphql";
EOF
echo "✅ backend/src/lib/network.ts"

# ═════════════════════════════════════════════════════════════════════════
# 4. backend/src/lib/shelbyClient.ts — pass indexer explicitly
# ═════════════════════════════════════════════════════════════════════════
python3 << 'PYEOF'
path = "backend/src/lib/shelbyClient.ts"
with open(path) as f:
    content = f.read()

old = '''  _client = new ShelbyNodeClient({
    network: Network.SHELBYNET,
    apiKey,
  });'''

new = '''  _client = new ShelbyNodeClient({
    network: Network.SHELBYNET,
    apiKey,
    // Explicitly target Shelby's own blob indexer -- without this the
    // SDK falls back to the generic Aptos chain indexer, whose `blobs`
    // table has a completely different schema.
    indexer: {
      baseUrl: SHELBYNET_BLOB_INDEXER,
      apiKey,
    },
  } as any);'''

if content.count(old) == 1:
    content = content.replace(old, new, 1)
    # ensure the import exists
    if "SHELBYNET_BLOB_INDEXER" not in content.split("\n")[0:20][0] and 'SHELBYNET_BLOB_INDEXER } from "./network.js"' not in content:
        content = content.replace(
            'import { SHELBYNET_BLOB_GATEWAY } from "./network.js";',
            'import { SHELBYNET_BLOB_GATEWAY, SHELBYNET_BLOB_INDEXER } from "./network.js";',
            1
        )
    with open(path, "w") as f:
        f.write(content)
    print("✅ backend/src/lib/shelbyClient.ts")
else:
    print(f"⚠️  backend/src/lib/shelbyClient.ts — pattern not found (count={content.count(old)})")
    print("   You may need to add the indexer option manually.")
PYEOF

# ═════════════════════════════════════════════════════════════════════════
# 5. Re-enable the ExpiryBanner query (it should work now)
# ═════════════════════════════════════════════════════════════════════════
python3 << 'PYEOF'
path = "frontend/src/components/layout/ExpiryBanner.tsx"
with open(path) as f:
    content = f.read()

if "EXPIRY_CHECK_ENABLED = false" in content:
    content = content.replace(
        "const EXPIRY_CHECK_ENABLED = false;",
        "const EXPIRY_CHECK_ENABLED = true;",
        1
    )
    with open(path, "w") as f:
        f.write(content)
    print("✅ ExpiryBanner.tsx — expiry check re-enabled")
else:
    print("   ExpiryBanner.tsx — no disabled flag found, leaving as is")
PYEOF

echo ""
echo "════════════════════════════════════════════════════"
echo "✅ INDEXER URL FIXED"
echo "════════════════════════════════════════════════════"
echo ""
echo "⚠️  YOU MUST ALSO FUND YOUR ACCOUNTS ON SHELBYNET."
echo "   The diagnostic showed ZERO balance -- no transaction can"
echo "   succeed without funds, which fully explains no wallet popup."
echo ""
echo "   Faucet: https://faucet.shelbynet.shelby.xyz"
echo ""
echo "   Fund BOTH:"
echo "     1. Backend account (from backend/.env APTOS_ACCOUNT_ADDRESS)"
echo "     2. Your Petra wallet address (the one that signs uploads)"
echo ""
echo "  git add ."
echo "  git commit -m 'fix: use Shelby dedicated blob indexer, not generic Aptos indexer'"
echo "  git push"
