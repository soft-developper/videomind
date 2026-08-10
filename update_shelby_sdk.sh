#!/usr/bin/env bash
# VideoMind — update the Shelby SDK to match the live shelbynet schema
#
# ROOT CAUSE, finally proven by schema introspection:
#
# The live shelbynet blob indexer (api.shelbynet.shelby.xyz/v1/graphql)
# exposes these columns on `blobs`:
#     object_name, owner, blob_commitment, created_at, expires_at,
#     num_chunksets, is_deleted, is_committed, is_persisted, size,
#     slice_address, placement_group, updated_at, uid, encoding, ...
#
# Your installed SDK queries for:
#     blob_name    <- RENAMED to object_name
#     is_written   <- RENAMED to is_committed
#
# So the endpoint was right all along -- the SDK is simply OUT OF DATE.
# @shelby-protocol/react latest is 4.1.0; the project has 2.0.1.
# Two major versions behind, and schema renames land in major bumps.
#
# (The nocode alias URL in the old SDK's constants only serves
#  `processor_status` now -- it's effectively a dead stub.)
#
# Run from the project root

set -e
FE="$(pwd)/frontend"
BE="$(pwd)/backend"
[ -d "$FE" ] || { echo "❌ Run from project root"; exit 1; }

echo "📦 Updating Shelby SDK to latest..."
echo ""

echo "── Current versions ──"
cd "$FE"
npm ls @shelby-protocol/react @shelby-protocol/sdk 2>/dev/null | grep shelby || true
echo ""

echo "── Installing latest ──"
npm install @shelby-protocol/react@latest @shelby-protocol/sdk@latest

echo ""
echo "── New versions ──"
npm ls @shelby-protocol/react @shelby-protocol/sdk 2>/dev/null | grep shelby || true
echo ""

# Backend too, if it uses the SDK
if [ -d "$BE" ] && grep -q "@shelby-protocol/sdk" "$BE/package.json" 2>/dev/null; then
  echo "── Backend ──"
  cd "$BE"
  npm install @shelby-protocol/sdk@latest
  npm ls @shelby-protocol/sdk 2>/dev/null | grep shelby || true
  cd "$FE"
fi

echo ""
echo "── Verifying the new SDK's query matches the live schema ──"
node -e "
const fs = require('fs');
const candidates = [
  'node_modules/@shelby-protocol/sdk/dist/browser/index.mjs',
  'node_modules/@shelby-protocol/sdk/dist/browser/index.js',
];
for (const p of candidates) {
  if (!fs.existsSync(p)) continue;
  const src = fs.readFileSync(p, 'utf8');
  const m = src.match(/query getBlobs[\s\S]{0,600}?\}/);
  if (m) {
    console.log(m[0].slice(0, 500));
    console.log('');
    if (m[0].includes('object_name')) {
      console.log('  ✅ New SDK queries object_name -- MATCHES live schema');
    } else if (m[0].includes('blob_name')) {
      console.log('  ⚠️  Still queries blob_name -- schema mismatch persists.');
      console.log('     Report this to Shelby Discord #dev.');
    }
    break;
  }
}
" 2>&1

echo ""
echo "════════════════════════════════════════════════════"
echo " Next:"
echo "   npm run build     # confirm it compiles"
echo "   git add . && git commit -m 'chore: update Shelby SDK to latest' && git push"
echo "════════════════════════════════════════════════════"
