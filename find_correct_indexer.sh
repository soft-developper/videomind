#!/usr/bin/env bash
# VideoMind — empirically find which indexer URL actually serves the
# Shelby blob schema. No theorising: test every candidate with the real
# query the SDK sends, using your real API key.

KEY=$(grep -E "^NEXT_PUBLIC_APTOS_API_KEY=" frontend/.env.local 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'" | xargs)
[ -z "$KEY" ] && KEY=$(grep -E "^APTOS_API_KEY=" backend/.env 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'" | xargs)

if [ -z "$KEY" ]; then
  echo "❌ No API key found in frontend/.env.local or backend/.env"
  exit 1
fi
echo "Using key: ${KEY:0:14}...${KEY: -4}"
echo ""

# The exact query the SDK sends
Q='{"query":"query getBlobs($where: blobs_bool_exp) { blobs(where: $where) { owner blob_commitment blob_name created_at expires_at num_chunksets is_deleted is_written placement_group size updated_at slice_address } }","variables":{"where":{"is_deleted":{"_eq":"0"}}}}'

test_url() {
  local label="$1"
  local url="$2"
  local auth="$3"

  echo "─────────────────────────────────────────────────"
  echo "▶ $label"
  echo "  $url"
  [ "$auth" = "yes" ] && echo "  (with Bearer token)" || echo "  (no auth)"

  if [ "$auth" = "yes" ]; then
    RESP=$(curl -s -X POST "$url" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $KEY" \
      -d "$Q" --max-time 20 2>&1)
  else
    RESP=$(curl -s -X POST "$url" \
      -H "Content-Type: application/json" \
      -d "$Q" --max-time 20 2>&1)
  fi

  if echo "$RESP" | grep -q '"data"'; then
    echo "  ✅✅✅ WORKS -- this URL serves the Shelby blob schema!"
    echo "  $(echo "$RESP" | head -c 250)"
  elif echo "$RESP" | grep -q "not found in type"; then
    echo "  ❌ wrong schema (this is the generic Aptos indexer)"
  elif echo "$RESP" | grep -qi "unauthor\|401"; then
    echo "  🔑 auth rejected"
  else
    echo "  ⚠️  $(echo "$RESP" | head -c 200)"
  fi
  echo ""
}

echo "═══════════════════════════════════════════════════"
echo " Testing every candidate indexer URL"
echo "═══════════════════════════════════════════════════"
echo ""

test_url "A. Generic Aptos indexer (shelby.xyz)" \
  "https://api.shelbynet.shelby.xyz/v1/graphql" "yes"

test_url "B. Shelby nocode alias (from SDK constants)" \
  "https://api.shelbynet.aptoslabs.com/nocode/v1/public/alias/shelby/shelbynet/v1/graphql" "yes"

test_url "C. Shelby nocode alias -- NO auth" \
  "https://api.shelbynet.aptoslabs.com/nocode/v1/public/alias/shelby/shelbynet/v1/graphql" "no"

test_url "D. gs endpoint (from SDK constants)" \
  "https://api.shelbynet.shelby.xyz/gs/v1" "yes"

test_url "E. gs graphql variant" \
  "https://api.shelbynet.shelby.xyz/gs/v1/graphql" "yes"

test_url "F. aptoslabs generic indexer" \
  "https://api.shelbynet.aptoslabs.com/v1/graphql" "yes"

echo "═══════════════════════════════════════════════════"
echo " Whichever shows ✅ is the URL we must use."
echo " Paste this whole output back."
echo "═══════════════════════════════════════════════════"
