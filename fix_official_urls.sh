#!/usr/bin/env bash
# VideoMind — correct all shelbynet URLs to match the OFFICIAL live docs
#
# Confirmed just now from docs.shelby.xyz/protocol/architecture/networks:
#   Aptos Full Node: https://api.shelbynet.shelby.xyz/v1
#   Indexer:         https://api.shelbynet.shelby.xyz/v1/graphql
#   Shelby RPC:      https://api.shelbynet.shelby.xyz/shelby
#
# Our code had "shelby.shelbynet.shelby.xyz" (wrong subdomain prefix) in
# three places, extracted earlier from an npm package's bundled constants
# that had drifted from the current infra. The docs explicitly warn
# shelbynet "will be wiped roughly once a week, or faster" -- so these
# are now hardcoded from the live docs as the source of truth.
#
# IMPORTANT -- this does NOT fix "no wallet popup" on its own. That is
# almost certainly a Petra wallet configuration issue: Petra has no
# built-in knowledge of shelbynet (unlike testnet), so it must be added
# as a custom network inside Petra manually:
#
#   Petra -> Settings -> Network -> Add Network
#     Name:      Shelbynet
#     Full node: https://api.shelbynet.shelby.xyz/v1
#     Faucet:    https://faucet.shelbynet.shelby.xyz
#   Then switch Petra to this network before uploading.
#
# Run from the project root (must contain frontend/ and backend/)

set -e
FE="$(pwd)/frontend"
BE="$(pwd)/backend"
[ -d "$FE" ] && [ -d "$BE" ] || { echo "❌ Run from project root"; exit 1; }

echo "🔧 Correcting shelbynet URLs to match official docs..."
echo ""

# ═════════════════════════════════════════════════════════════════════════
# 1. frontend/src/lib/network.ts — full rewrite with official URLs
# ═════════════════════════════════════════════════════════════════════════
cat > "$FE/src/lib/network.ts" << 'EOF'
// src/lib/network.ts
//
// Official shelbynet URLs — confirmed live from docs.shelby.xyz on the
// Networks reference page (docs.shelby.xyz/protocol/architecture/networks).
// Shelby explicitly documents that shelbynet infra "will be wiped roughly
// once a week, or faster" -- these are hardcoded from the live docs as
// the source of truth rather than trusted purely from whatever an npm
// package bundled, which can drift between shelbynet redeployments.
//
// Network.SHELBYNET is also a first-class named network in
// @aptos-labs/ts-sdk (MAINNET | TESTNET | DEVNET | SHELBYNET | NETNA |
// LOCAL | CUSTOM) -- pass that enum directly to dappConfig, never
// Network.CUSTOM (that crashes the wallet adapter's bundled AptosConnect
// plugin with "Error: Network not supported").
import { Network } from "@aptos-labs/ts-sdk";

export const SHELBYNET_NETWORK = Network.SHELBYNET;

export const SHELBYNET_URLS = {
  fullnode: "https://api.shelbynet.shelby.xyz/v1",
  indexer: "https://api.shelbynet.shelby.xyz/v1/graphql",
  shelbyRpc: "https://api.shelbynet.shelby.xyz/shelby",
  faucet: "https://faucet.shelbynet.shelby.xyz",
  explorer: "https://explorer.shelby.xyz/shelbynet",
} as const;

export const SHELBYNET_EXPLORER = SHELBYNET_URLS.explorer;
EOF
echo "✅ frontend/src/lib/network.ts"

# ═════════════════════════════════════════════════════════════════════════
# 2. backend/src/lib/network.ts — official blob gateway domain
# ═════════════════════════════════════════════════════════════════════════
FILE_BN="$BE/src/lib/network.ts"
if [ -f "$FILE_BN" ]; then
  python3 << PYEOF
path = "backend/src/lib/network.ts"
with open(path) as f:
    content = f.read()

old = 'export const SHELBYNET_BLOB_GATEWAY = "https://shelby.shelbynet.shelby.xyz/shelby";'
new = '''// Confirmed live from docs.shelby.xyz/protocol/architecture/networks
export const SHELBYNET_BLOB_GATEWAY = "https://api.shelbynet.shelby.xyz/shelby";'''

if old in content:
    content = content.replace(old, new, 1)
    with open(path, "w") as f:
        f.write(content)
    print("   patched")
else:
    print("   (already correct or pattern differs — check manually if needed)")
PYEOF
fi
echo "✅ backend/src/lib/network.ts"

# ═════════════════════════════════════════════════════════════════════════
# 3. backend/src/lib/shelbyClient.ts — fix stale comment
# ═════════════════════════════════════════════════════════════════════════
FILE_SC="$BE/src/lib/shelbyClient.ts"
if [ -f "$FILE_SC" ]; then
  python3 << PYEOF
path = "backend/src/lib/shelbyClient.ts"
with open(path) as f:
    content = f.read()

old = '''/**
 * Direct HTTP URL to stream a blob from shelbynet.
 * Verified against @shelby-protocol/sdk's own NetworkToShelbyRPCBaseUrl
 * constant — the domain is shelby.shelbynet.shelby.xyz, NOT
 * api.shelbynet.shelby.xyz.
 */'''

new = '''/**
 * Direct HTTP URL to stream a blob from shelbynet.
 * Confirmed live from docs.shelby.xyz/protocol/architecture/networks:
 * Shelby RPC = https://api.shelbynet.shelby.xyz/shelby
 */'''

if old in content:
    content = content.replace(old, new, 1)
    with open(path, "w") as f:
        f.write(content)
    print("   patched")
else:
    print("   (already correct or pattern differs)")
PYEOF
fi
echo "✅ backend/src/lib/shelbyClient.ts"

# ═════════════════════════════════════════════════════════════════════════
# 4. frontend/src/components/layout/ExpiryBanner.tsx — fix blob fetch domain
# ═════════════════════════════════════════════════════════════════════════
FILE_EB="$FE/src/components/layout/ExpiryBanner.tsx"
if [ -f "$FILE_EB" ]; then
  sed -i.bak 's#shelby\.shelbynet\.shelby\.xyz#api.shelbynet.shelby.xyz#g' "$FILE_EB"
  rm -f "$FILE_EB.bak"
  echo "✅ ExpiryBanner.tsx — blob fetch domain corrected"
fi

# ═════════════════════════════════════════════════════════════════════════
# 5. Sweep the whole repo to confirm nothing wrong remains
# ═════════════════════════════════════════════════════════════════════════
echo ""
echo "=== Final sweep ==="
if grep -rn "shelby\.shelbynet\.shelby\.xyz" --include="*.ts" --include="*.tsx" "$FE" "$BE" 2>/dev/null; then
  echo "⚠️  Some references remain — check the lines above manually."
else
  echo "✅ Clean — no incorrect domains remain anywhere in the codebase."
fi

echo ""
echo "════════════════════════════════════════════════════"
echo "✅ URLS CORRECTED TO MATCH OFFICIAL DOCS"
echo "════════════════════════════════════════════════════"
echo ""
echo "⚠️  IMPORTANT — this alone will NOT fix the 'no wallet popup' issue."
echo "   That requires manually adding shelbynet as a custom network"
echo "   INSIDE PETRA WALLET ITSELF (not something fixable in our code):"
echo ""
echo "   Petra -> Settings -> Network -> Add Network"
echo "     Name:      Shelbynet"
echo "     Full node: https://api.shelbynet.shelby.xyz/v1"
echo "     Faucet:    https://faucet.shelbynet.shelby.xyz"
echo ""
echo "   Then switch Petra to this network before testing upload again."
echo ""
echo "  git add ."
echo "  git commit -m 'fix: correct shelbynet URLs to match official docs'"
echo "  git push"
