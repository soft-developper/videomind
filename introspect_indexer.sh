#!/usr/bin/env bash
# VideoMind — introspect the nocode alias endpoint to see its REAL schema.
# Result B returned "wrong schema" but that URL is straight from the Shelby
# SDK's own constants -- so let's see what fields it ACTUALLY exposes.

KEY=$(grep -E "^NEXT_PUBLIC_APTOS_API_KEY=" frontend/.env.local 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'" | xargs)
[ -z "$KEY" ] && KEY=$(grep -E "^APTOS_API_KEY=" backend/.env 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'" | xargs)

echo "Key: ${KEY:0:14}...${KEY: -4}"
echo ""

NOCODE="https://api.shelbynet.aptoslabs.com/nocode/v1/public/alias/shelby/shelbynet/v1/graphql"

echo "═══════════════════════════════════════════════════"
echo " 1. What query fields does the NOCODE endpoint have?"
echo "═══════════════════════════════════════════════════"
curl -s -X POST "$NOCODE" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $KEY" \
  -d '{"query":"{ __schema { queryType { fields { name } } } }"}' \
  --max-time 25 2>&1 | tr ',' '\n' | grep -o '"name":"[a-z_]*"' | sed 's/"name":"//;s/"//' | sort -u | head -60
echo ""

echo "═══════════════════════════════════════════════════"
echo " 2. Does a 'blobs' field exist there at all?"
echo "═══════════════════════════════════════════════════"
RESP=$(curl -s -X POST "$NOCODE" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $KEY" \
  -d '{"query":"{ __schema { queryType { fields { name } } } }"}' --max-time 25)
echo "$RESP" | grep -q '"name":"blobs"' && echo "  ✅ blobs EXISTS here" || echo "  ❌ blobs NOT here"
echo ""

echo "═══════════════════════════════════════════════════"
echo " 3. What FIELDS does the 'blobs' type have on the"
echo "    generic shelby.xyz indexer? (it HAS a blobs table,"
echo "    the SDK query just asks for wrong column names)"
echo "═══════════════════════════════════════════════════"
curl -s -X POST "https://api.shelbynet.shelby.xyz/v1/graphql" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $KEY" \
  -d '{"query":"{ __type(name: \"blobs\") { fields { name } } }"}' \
  --max-time 25 2>&1 | tr ',' '\n' | grep -o '"name":"[a-zA-Z_]*"' | sed 's/"name":"//;s/"//' | sort -u
echo ""

echo "═══════════════════════════════════════════════════"
echo " 4. Raw response from the gs endpoints (were blank)"
echo "═══════════════════════════════════════════════════"
echo "--- gs/v1 ---"
curl -s -o /dev/null -w "HTTP %{http_code}\n" "https://api.shelbynet.shelby.xyz/gs/v1" --max-time 15
curl -s "https://api.shelbynet.shelby.xyz/gs/v1" --max-time 15 | head -c 200
echo ""
echo "--- gs/v1/graphql ---"
curl -s -o /dev/null -w "HTTP %{http_code}\n" "https://api.shelbynet.shelby.xyz/gs/v1/graphql" --max-time 15
curl -s -X POST "https://api.shelbynet.shelby.xyz/gs/v1/graphql" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $KEY" \
  -d '{"query":"{ __schema { queryType { name } } }"}' --max-time 15 | head -c 300
echo ""
echo ""

echo "═══════════════════════════════════════════════════"
echo " 5. What does the INSTALLED SDK resolve internally?"
echo "═══════════════════════════════════════════════════"
cd frontend 2>/dev/null || true
node -e "
const fs=require('fs');
const p='node_modules/@shelby-protocol/sdk/dist/core/constants.mjs';
if(fs.existsSync(p)){
  console.log(fs.readFileSync(p,'utf8'));
} else {
  console.log('constants.mjs not found at',p);
}
" 2>&1 | head -60

echo ""
echo "Paste this ENTIRE output back."
