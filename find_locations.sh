#!/usr/bin/env bash
# VideoMind — find the REAL registered location names on shelbynet.
# "us-east-1" was rejected with "No location is registered under this name",
# so the contract has a specific set of names. Find them empirically.

KEY=$(grep -E "^NEXT_PUBLIC_APTOS_API_KEY=" frontend/.env.local 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'" | xargs)
[ -z "$KEY" ] && KEY=$(grep -E "^APTOS_API_KEY=" backend/.env 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'" | xargs)
[ -z "$KEY" ] && { echo "❌ No API key found"; exit 1; }

GQL="https://api.shelbynet.shelby.xyz/v1/graphql"
NODE="https://api.shelbynet.shelby.xyz/v1"
DEPLOYER="0x85fdb9a176ab8ef1d9d9c1b60d60b3924f0800ac1de1cc2085fb0b8bb4988e6a"

q() {
  curl -s -X POST "$GQL" -H "Content-Type: application/json" \
    -H "Authorization: Bearer $KEY" -d "$1" --max-time 20
}

echo "═══════════════════════════════════════════════════"
echo " 1. What root query fields mention location/placement?"
echo "═══════════════════════════════════════════════════"
q '{"query":"{ __schema { queryType { fields { name } } } }"}' \
  | tr ',' '\n' | grep -o '"name":"[a-z_]*"' | sed 's/"name":"//;s/"//' \
  | grep -iE "location|placement|storage|provider" | sort -u
echo ""

echo "═══════════════════════════════════════════════════"
echo " 2. Fields on the placement_groups type"
echo "═══════════════════════════════════════════════════"
q '{"query":"{ __type(name: \"placement_groups\") { fields { name } } }"}' \
  | tr ',' '\n' | grep -o '"name":"[a-zA-Z_]*"' | sed 's/"name":"//;s/"//' | sort -u
echo ""

echo "═══════════════════════════════════════════════════"
echo " 3. ACTUAL placement group rows (real location values)"
echo "═══════════════════════════════════════════════════"
q '{"query":"{ placement_groups(limit: 20) { address location } }"}' | head -c 900
echo ""
echo ""
echo "  (if the above errored, trying without the location column:)"
q '{"query":"{ placement_groups(limit: 10) { address } }"}' | head -c 500
echo ""
echo ""

echo "═══════════════════════════════════════════════════"
echo " 4. What placement_group values do EXISTING blobs use?"
echo "    (proves what real, working uploads used)"
echo "═══════════════════════════════════════════════════"
q '{"query":"{ blobs(limit: 15, where: {is_deleted: {_eq: \"0\"}}) { object_name placement_group owner } }"}' | head -c 1200
echo ""
echo ""

echo "═══════════════════════════════════════════════════"
echo " 5. Storage providers and their locations"
echo "═══════════════════════════════════════════════════"
q '{"query":"{ storage_providers(limit: 20) { address location } }"}' | head -c 900
echo ""
echo ""

echo "═══════════════════════════════════════════════════"
echo " 6. On-chain: the contract's location registry"
echo "═══════════════════════════════════════════════════"
echo "▶ Resources on the Shelby deployer account:"
curl -s -H "Authorization: Bearer $KEY" \
  "$NODE/accounts/$DEPLOYER/resources" --max-time 25 \
  | tr ',' '\n' | grep -o '"type":"[^"]*"' | sed 's/"type":"//;s/"//' \
  | grep -iE "location|placement" | sort -u | head -20
echo ""
echo "▶ Modules deployed (looking for a location module):"
curl -s -H "Authorization: Bearer $KEY" \
  "$NODE/accounts/$DEPLOYER/modules?limit=100" --max-time 30 \
  | grep -o '"name":"[a-z_]*"' | sed 's/"name":"//;s/"//' | sort -u | head -30
echo ""

echo "═══════════════════════════════════════════════════"
echo " Look at sections 4 and 5 -- whatever real location"
echo " string appears there is what we must use."
echo " Paste this ENTIRE output back."
echo "═══════════════════════════════════════════════════"
