#!/usr/bin/env bash
# ============================================================================
# VideoMind rebuild, Part 11: check the live setup (read only)
# ============================================================================
# Changes nothing anywhere. Run it before the switch against the new API
# address, and again after it against the site.
#
#   bash scripts/check_live.sh [API] [SITE] [R2_BUCKET_URL]
#
#   API            default https://api.vidzmind.xyz
#   SITE           default https://vidzmind.xyz
#   R2_BUCKET_URL  optional, https://<account id>.r2.cloudflarestorage.com/<bucket>
#                  to check the bucket lets the site upload (CORS)
#
# Needs curl. Prints PASS or FAIL per check and a total.
# ============================================================================
set -uo pipefail

API="${1:-https://api.vidzmind.xyz}"; API="${API%/}"
SITE="${2:-https://vidzmind.xyz}"; SITE="${SITE%/}"
R2="${3:-}"; R2="${R2%/}"
PASS=0; FAIL=0
ok()  { printf '  PASS  %s\n' "$1"; PASS=$((PASS+1)); }
bad() { printf '  FAIL  %s\n' "$1"; [ -n "${2:-}" ] && printf '        %s\n' "$2"; FAIL=$((FAIL+1)); }
code() { curl -s -o /dev/null -w '%{http_code}' -m 20 "$@"; }

echo "API  $API"
echo "SITE $SITE"
echo

# 1. The backend is up, with durable storage.
H="$(curl -s -m 30 "$API/api/health" || true)"
if printf '%s' "$H" | grep -q '"durable":true'; then ok "backend answers /api/health with durable storage"
else bad "backend health" "got: $(printf '%s' "$H" | head -c 300)"; fi
if printf '%s' "$H" | grep -q '"ffmpeg"'; then ok "health reports FFmpeg"; else bad "health does not mention FFmpeg" ; fi

# 2. The backend lets the site call it (CORS uses FRONTEND_URL).
ACAO="$(curl -s -m 20 -o /dev/null -D - -X OPTIONS "$API/api/auth/nonce" -H "Origin: $SITE" -H "Access-Control-Request-Method: GET" | tr -d '\r' | awk -F': ' 'tolower($1)=="access-control-allow-origin"{print $2}')"
if [ "$ACAO" = "$SITE" ]; then ok "the backend allows $SITE (FRONTEND_URL)"
else bad "the backend does not allow $SITE" "add $SITE to FRONTEND_URL on Render (got '${ACAO:-nothing}')"; fi

# 3. Sign in starts.
N="$(curl -s -m 20 "$API/api/auth/nonce" || true)"
if printf '%s' "$N" | grep -q '"nonce"'; then ok "sign in hands out a nonce"; else bad "sign in nonce" "got: $(printf '%s' "$N" | head -c 200)"; fi

# 4. Live, YouTube and live captions routes are there.
L="$(curl -s -m 20 "$API/api/live/config" || true)"
if printf '%s' "$L" | grep -q '"enabled":true'; then ok "live is switched on (LiveKit keys set)"; else bad "live is off" "set LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET (got: $(printf '%s' "$L" | head -c 120))"; fi
C="$(code "$API/api/youtube/status")"
if [ "$C" = "401" ]; then ok "YouTube routes answer (401 without sign in)"; else bad "YouTube status answered $C, expected 401"; fi
W="$(code --http1.1 -H "Connection: Upgrade" -H "Upgrade: websocket" -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" -H "Origin: $SITE" "$API/api/live/00000000-0000-4000-8000-000000000000/captions?ticket=check")"
if [ "$W" = "401" ]; then ok "the captions WebSocket is reachable (refuses a bad ticket with 401)"; elif [ "$W" = "403" ]; then bad "captions WebSocket refused $SITE (403)" "add $SITE to FRONTEND_URL on Render"
else bad "captions WebSocket answered $W, expected 401"; fi

# 5. The site's pages load, and its code points at this API.
for p in / /live /search /record; do
  C="$(code -L "$SITE$p")"
  if [ "$C" = "200" ]; then ok "site page $p loads"; else bad "site page $p answered $C"; fi
done
HTML="$(curl -s -L -m 30 "$SITE/" || true)"
HOST="${API#https://}"; HOST="${HOST#http://}"
FOUND=0
for js in $(printf '%s' "$HTML" | grep -o '/_next/static/[^"]*\.js' | sort -u | head -40); do
  if curl -s -m 20 "$SITE$js" | grep -q "$HOST"; then FOUND=1; break; fi
done
if [ "$FOUND" = "1" ]; then ok "the site was built with NEXT_PUBLIC_API_URL = $API"
else bad "the site's code does not mention $HOST" "set NEXT_PUBLIC_API_URL for Production in Vercel, then redeploy"; fi

# 6. Optional: the bucket lets the site upload.
if [ -n "$R2" ]; then
  RA="$(curl -s -m 20 -o /dev/null -D - -X OPTIONS "$R2/check" -H "Origin: $SITE" -H "Access-Control-Request-Method: PUT" | tr -d '\r' | awk -F': ' 'tolower($1)=="access-control-allow-origin"{print $2}')"
  if [ "$RA" = "$SITE" ] || [ "$RA" = "*" ]; then ok "R2 allows uploads from $SITE"
  else bad "R2 does not allow uploads from $SITE" "add $SITE to the bucket's CORS AllowedOrigins (got '${RA:-nothing}')"; fi
fi

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" = "0" ]
