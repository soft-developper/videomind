#!/usr/bin/env bash
# VideoMind — shelbynet live diagnostic
# Tests every endpoint from the official docs to find what's actually broken.
# Run this from YOUR machine (not the browser) and paste the full output back.

echo "════════════════════════════════════════════════════"
echo " SHELBYNET DIAGNOSTIC"
echo " Testing official URLs from docs.shelby.xyz"
echo "════════════════════════════════════════════════════"
echo ""

# Read the API key from backend/.env if present
if [ -f backend/.env ]; then
  API_KEY=$(grep -E "^APTOS_API_KEY=" backend/.env | cut -d= -f2- | tr -d '"' | tr -d "'" | xargs)
else
  API_KEY=""
fi

if [ -z "$API_KEY" ]; then
  echo "⚠️  No APTOS_API_KEY found in backend/.env"
  echo "   Some tests will run unauthenticated."
  echo ""
else
  echo "✅ Found API key: ${API_KEY:0:14}...${API_KEY: -4}"
  echo ""
fi

# ── 1. Is the fullnode alive at all? ────────────────────────────────────
echo "─── 1. Aptos Full Node (no auth) ───────────────────"
curl -s -o /tmp/sn1.txt -w "HTTP %{http_code}  |  %{time_total}s\n" \
  https://api.shelbynet.shelby.xyz/v1 --max-time 20
echo "Response:"
head -c 500 /tmp/sn1.txt 2>/dev/null; echo ""
echo ""

# ── 2. Fullnode WITH the API key ────────────────────────────────────────
if [ -n "$API_KEY" ]; then
  echo "─── 2. Aptos Full Node (with API key) ──────────────"
  curl -s -o /tmp/sn2.txt -w "HTTP %{http_code}  |  %{time_total}s\n" \
    -H "Authorization: Bearer $API_KEY" \
    https://api.shelbynet.shelby.xyz/v1 --max-time 20
  echo "Response:"
  head -c 500 /tmp/sn2.txt 2>/dev/null; echo ""
  echo ""
fi

# ── 3. Chain ID — proves which network is actually answering ────────────
echo "─── 3. Chain ID (docs say shelbynet chainId = 59) ──"
if [ -n "$API_KEY" ]; then
  curl -s -H "Authorization: Bearer $API_KEY" \
    https://api.shelbynet.shelby.xyz/v1 --max-time 20 2>/dev/null \
    | grep -o '"chain_id":[0-9]*' || echo "   (could not read chain_id)"
else
  curl -s https://api.shelbynet.shelby.xyz/v1 --max-time 20 2>/dev/null \
    | grep -o '"chain_id":[0-9]*' || echo "   (could not read chain_id)"
fi
echo ""

# ── 4. Shelby RPC endpoint ──────────────────────────────────────────────
echo "─── 4. Shelby RPC ──────────────────────────────────"
curl -s -o /tmp/sn4.txt -w "HTTP %{http_code}  |  %{time_total}s\n" \
  https://api.shelbynet.shelby.xyz/shelby --max-time 20
echo "Response:"
head -c 300 /tmp/sn4.txt 2>/dev/null; echo ""
echo ""

# ── 5. Indexer GraphQL — the one throwing 'blobs not found' ────────────
echo "─── 5. Indexer GraphQL (introspect for 'blobs') ────"
curl -s -o /tmp/sn5.txt -w "HTTP %{http_code}\n" \
  -X POST https://api.shelbynet.shelby.xyz/v1/graphql \
  -H "Content-Type: application/json" \
  ${API_KEY:+-H "Authorization: Bearer $API_KEY"} \
  -d '{"query":"{ __schema { queryType { fields { name } } } }"}' \
  --max-time 20
echo "Does a 'blobs' field exist in the schema?"
grep -o '"name":"blobs"' /tmp/sn5.txt 2>/dev/null \
  && echo "   ✅ YES — 'blobs' field EXISTS" \
  || echo "   ❌ NO — 'blobs' field is MISSING from the indexer schema"
echo ""
echo "First few available query fields:"
head -c 600 /tmp/sn5.txt 2>/dev/null; echo ""
echo ""

# ── 6. Faucet ───────────────────────────────────────────────────────────
echo "─── 6. Faucet ──────────────────────────────────────"
curl -s -o /dev/null -w "HTTP %{http_code}  |  %{time_total}s\n" \
  https://faucet.shelbynet.shelby.xyz --max-time 20
echo ""

# ── 7. Your account's balance on shelbynet ──────────────────────────────
if [ -f backend/.env ]; then
  ADDR=$(grep -E "^APTOS_ACCOUNT_ADDRESS=" backend/.env | cut -d= -f2- | tr -d '"' | tr -d "'" | xargs)
  if [ -n "$ADDR" ]; then
    echo "─── 7. Backend account on shelbynet ────────────────"
    echo "Address: $ADDR"
    curl -s -o /tmp/sn7.txt -w "HTTP %{http_code}\n" \
      ${API_KEY:+-H "Authorization: Bearer $API_KEY"} \
      "https://api.shelbynet.shelby.xyz/v1/accounts/$ADDR" --max-time 20
    head -c 300 /tmp/sn7.txt 2>/dev/null; echo ""
    echo ""
  fi
fi

echo "════════════════════════════════════════════════════"
echo " WHAT THE RESULTS MEAN"
echo "════════════════════════════════════════════════════"
echo ""
echo "  Test 1/2 HTTP 200  -> shelbynet is UP"
echo "  Test 1/2 HTTP 401  -> your API key isn't valid for shelbynet"
echo "  Test 1/2 HTTP 404/000/timeout -> shelbynet may be DOWN or"
echo "                        mid-wipe (docs say it's wiped ~weekly)"
echo ""
echo "  Test 3 chain_id:59 -> confirmed talking to shelbynet"
echo "  Test 3 other value -> talking to the WRONG network"
echo ""
echo "  Test 5 'blobs' MISSING -> confirms the indexer schema gap"
echo "                            (explains the getBlobs error)"
echo ""
echo "  Test 7 HTTP 404 -> your backend account does NOT exist on"
echo "                     shelbynet yet; it needs funding from the"
echo "                     shelbynet faucet (testnet funds don't carry over)"
echo ""
echo "Paste this ENTIRE output back."
