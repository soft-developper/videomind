#!/usr/bin/env bash
# VideoMind — set the CORRECT Shelby location: "shelbynet-1"
#
# PROVEN from the on-chain contract, not guessed:
#
#   view 0x85fd...8e6a::location::activated_location_names()
#     -> [["shelbynet-1"]]
#
#   LocationRegistry holds exactly one location object:
#     0x1a2105f226c62cd0cd95f4bb0e183a457bb4180e3b1bc6b7c8ee5ca3b20f369b
#
#   And a REAL successful upload's placement group
#   (0x378e...a9e9) has:
#     "location": { "inner": "0x1a2105f2...369b" }
#   -- the exact same object. Fully consistent.
#
# "us-east-1" (which I took from a string in the SDK source) is NOT
# registered on shelbynet, hence "No location is registered under this name".
#
# Verified: tsc --noEmit exits 0.
#
# Run from the project root

set -e
FE="$(pwd)/frontend"
[ -d "$FE" ] || { echo "❌ Run from project root"; exit 1; }

cat > "$FE/src/lib/shelby.ts" << 'EOF'
// src/lib/shelby.ts
//
// SHELBY_LOCATION must be a name registered in the on-chain
// LocationRegistry. Read directly from the contract:
//
//   view 0x85fd...8e6a::location::activated_location_names()
//     -> [["shelbynet-1"]]
//
// That is currently the ONLY activated location on shelbynet. Verified
// against a real successful upload, whose placement group resolves to
// the same location object (0x1a2105f2...369b) held by the registry.
//
// locationHint is required -- the ShelbyClient constructor stores it as
// defaultOptions.locationHint, and the Move contract rejects any write
// that supplies neither a location nor an account preference.
import { ShelbyClient } from "@shelby-protocol/sdk/browser";
import { Network } from "@aptos-labs/ts-sdk";

export const SHELBY_LOCATION = "shelbynet-1";

export const shelbyClient = new ShelbyClient({
  network: Network.SHELBYNET,
  apiKey: process.env.NEXT_PUBLIC_APTOS_API_KEY,
  locationHint: SHELBY_LOCATION,
});

export function expirationMicros(): number {
  // 47h, under shelbynet's 48h cap
  return Date.now() * 1000 + 47 * 60 * 60 * 1000 * 1000;
}
EOF
echo "✅ frontend/src/lib/shelby.ts — location set to shelbynet-1"

# Replace any lingering us-east-1 anywhere else
for f in $(grep -rl "us-east-1" "$FE/src" 2>/dev/null); do
  sed -i.bak 's/us-east-1/shelbynet-1/g' "$f"
  rm -f "$f.bak"
  echo "✅ $(basename "$f") — us-east-1 -> shelbynet-1"
done

echo ""
echo "════════════════════════════════════════════════════"
echo " Location proven from chain: shelbynet-1"
echo ""
echo "   cd frontend && npm run build"
echo "   cd .. && git add . && git commit -m 'fix: use registered location shelbynet-1' && git push"
echo "════════════════════════════════════════════════════"
