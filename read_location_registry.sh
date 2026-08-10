#!/usr/bin/env bash
# VideoMind — read the ACTUAL registered location names from the
# on-chain LocationRegistry.
#
# Section 6 of the last run revealed:
#   Resource: 0x85fd...8e6a::location::LocationRegistry
#   Function: activated_location_names
#
# Read them directly instead of guessing.

KEY=$(grep -E "^NEXT_PUBLIC_APTOS_API_KEY=" frontend/.env.local 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'" | xargs)
[ -z "$KEY" ] && KEY=$(grep -E "^APTOS_API_KEY=" backend/.env 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'" | xargs)
[ -z "$KEY" ] && { echo "❌ No API key found"; exit 1; }

NODE="https://api.shelbynet.shelby.xyz/v1"
DEPLOYER="0x85fdb9a176ab8ef1d9d9c1b60d60b3924f0800ac1de1cc2085fb0b8bb4988e6a"

echo "═══════════════════════════════════════════════════"
echo " 1. Raw LocationRegistry resource"
echo "═══════════════════════════════════════════════════"
curl -s -H "Authorization: Bearer $KEY" \
  "$NODE/accounts/$DEPLOYER/resource/${DEPLOYER}::location::LocationRegistry" \
  --max-time 25 | head -c 2000
echo ""
echo ""

echo "═══════════════════════════════════════════════════"
echo " 2. VIEW FUNCTION: activated_location_names"
echo "    (this is the definitive list)"
echo "═══════════════════════════════════════════════════"
curl -s -X POST "$NODE/view" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $KEY" \
  -d "{\"function\":\"${DEPLOYER}::location::activated_location_names\",\"type_arguments\":[],\"arguments\":[]}" \
  --max-time 25 | head -c 1500
echo ""
echo ""

echo "═══════════════════════════════════════════════════"
echo " 3. Fallback: all location-module view functions"
echo "═══════════════════════════════════════════════════"
curl -s -H "Authorization: Bearer $KEY" \
  "$NODE/accounts/$DEPLOYER/module/location" --max-time 25 \
  | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    fns = d.get('abi', {}).get('exposed_functions', [])
    views = [f for f in fns if f.get('is_view')]
    print('  View functions in the location module:')
    for f in views:
        params = ', '.join(f.get('params', []))
        print(f\"    - {f['name']}({params})\")
    if not views:
        print('    (none found)')
except Exception as e:
    print('  could not parse:', e)
" 2>&1
echo ""

echo "═══════════════════════════════════════════════════"
echo " 4. Decode a working blob's placement group -> location"
echo "    (0x378e...a9e9 came from a REAL successful upload)"
echo "═══════════════════════════════════════════════════"
PG="0x378e4499dc5ef517bcd9b1924a3eb94a94979c4d8ad4ff33c928462804c3a9e9"
curl -s -H "Authorization: Bearer $KEY" \
  "$NODE/accounts/$PG/resources" --max-time 25 \
  | head -c 1500
echo ""
echo ""

echo "Paste this ENTIRE output back."
