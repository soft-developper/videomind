#!/usr/bin/env bash
# VideoMind — round 2 diagnostic
# The `blobs` field EXISTS at api.shelbynet.shelby.xyz/v1/graphql, so the
# app must be hitting a DIFFERENT indexer URL. This finds which one.

echo "════════════════════════════════════════════════════"
echo " ROUND 2 — find the real indexer URL the SDK uses"
echo "════════════════════════════════════════════════════"
echo ""

API_KEY=$(grep -E "^APTOS_API_KEY=" backend/.env 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'" | xargs)
ADDR=$(grep -E "^APTOS_ACCOUNT_ADDRESS=" backend/.env 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'" | xargs)

# ── 1. Run the EXACT query your app sends, against the working URL ─────
echo "─── 1. Your app's exact getBlobs query -> api.shelbynet.shelby.xyz ───"
curl -s -X POST https://api.shelbynet.shelby.xyz/v1/graphql \
  -H "Content-Type: application/json" \
  ${API_KEY:+-H "Authorization: Bearer $API_KEY"} \
  -d '{"query":"query getBlobs($where: blobs_bool_exp) { blobs(where: $where) { owner blob_name expires_at is_deleted size } }","variables":{"where":{"is_deleted":{"_eq":"0"}}}}' \
  --max-time 20 | head -c 800
echo ""
echo ""

# ── 2. What URL does the SDK ACTUALLY resolve to? ──────────────────────
echo "─── 2. What indexer URL does the installed SDK use? ───"
cd frontend 2>/dev/null || cd .
node -e "
try {
  const { Network, NetworkToIndexerAPI, NetworkToNodeAPI } = require('@aptos-labs/ts-sdk');
  console.log('  Network.SHELBYNET     =', JSON.stringify(Network.SHELBYNET));
  console.log('  Indexer for SHELBYNET =', NetworkToIndexerAPI[Network.SHELBYNET]);
  console.log('  Fullnode for SHELBYNET=', NetworkToNodeAPI[Network.SHELBYNET]);
} catch (e) {
  console.log('  Could not load ts-sdk from this dir:', e.message);
}
" 2>&1
echo ""

# ── 3. What does @shelby-protocol/sdk think the RPC base is? ──────────
echo "─── 3. Shelby SDK's own network constants ───"
node -e "
const fs = require('fs');
const candidates = [
  'node_modules/@shelby-protocol/sdk/dist/core/constants.mjs',
  'node_modules/@shelby-protocol/sdk/dist/core/constants.js',
];
let found = false;
for (const p of candidates) {
  if (fs.existsSync(p)) {
    found = true;
    const src = fs.readFileSync(p, 'utf8');
    const urls = src.match(/https:\/\/[^\"',\`\s)]+/g) || [];
    console.log('  From ' + p + ':');
    [...new Set(urls)].forEach(u => console.log('    ' + u));
  }
}
if (!found) {
  const { execSync } = require('child_process');
  try {
    const out = execSync(\"grep -rho 'https://[^\\\"'\\\"'\\\"',\\\`) ]*shelby[^\\\"'\\\"'\\\"',\\\`) ]*' node_modules/@shelby-protocol/sdk/dist/ 2>/dev/null | sort -u\").toString();
    console.log(out || '    (none found)');
  } catch (e) { console.log('    could not scan'); }
}
" 2>&1
echo ""

# ── 4. Account balance on shelbynet ───────────────────────────────────
if [ -n "$ADDR" ]; then
  echo "─── 4. Backend account BALANCE on shelbynet ───"
  curl -s ${API_KEY:+-H "Authorization: Bearer $API_KEY"} \
    "https://api.shelbynet.shelby.xyz/v1/accounts/$ADDR/resources" --max-time 20 \
    | grep -o '"0x1::coin::CoinStore[^}]*}' | head -c 400
  echo ""
  echo "  (empty above = NO funds on shelbynet)"
  echo ""
fi

echo "════════════════════════════════════════════════════"
echo " Paste this entire output back."
echo "════════════════════════════════════════════════════"
