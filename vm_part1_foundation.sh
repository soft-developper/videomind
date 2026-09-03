#!/usr/bin/env bash
# ============================================================================
# VideoMind Redesign - Part 1: Foundation (shared primitives + open spacing)
# ============================================================================
# Additive only. Appends a marked block to frontend/src/app/globals.css.
# Nothing existing is modified or removed. Safe to re-run (idempotent).
#
#   ./vm_part1_foundation.sh          apply
#   ./vm_part1_foundation.sh --revert remove the block, restore from backup
#
# Run from the repo root (the dir containing frontend/).
# ============================================================================
set -euo pipefail

MARKER="VM_PART1_FOUNDATION"
TARGET="frontend/src/app/globals.css"
STAMP="$(date +%Y%m%d-%H%M%S)"

say()  { printf '  %s\n' "$1"; }
die()  { printf 'ERROR: %s\n' "$1" >&2; exit 1; }

[ -f "$TARGET" ] || die "$TARGET not found. Run this from the repo root (the folder that contains frontend/)."

# ---- revert -----------------------------------------------------------------
if [ "${1:-}" = "--revert" ]; then
  if ! grep -q "$MARKER" "$TARGET"; then
    say "Part 1 block not present in $TARGET. Nothing to revert."; exit 0
  fi
  cp "$TARGET" "$TARGET.bak-$STAMP"
  # Delete from the Part 1 banner comment start through end of file.
  python3 - "$TARGET" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
key="PART 1 \u00b7 FOUNDATION"
i=s.find("/* ")
# find the banner line that introduces the Part 1 block
idx=s.find("PART 1")
if idx!=-1:
    start=s.rfind("/*", 0, idx)
    s=s[:start].rstrip()+"\n"
    open(p,"w").write(s)
    print("  Reverted: Part 1 block removed.")
else:
    print("  Marker text not found; no change.")
PY
  say "Backup saved: $TARGET.bak-$STAMP"
  exit 0
fi

# ---- apply ------------------------------------------------------------------
if grep -q "$MARKER" "$TARGET"; then
  say "Part 1 already applied (marker $MARKER present). Skipping. Use --revert to undo."
  exit 0
fi

cp "$TARGET" "$TARGET.bak-$STAMP"
say "Backup saved: $TARGET.bak-$STAMP"

PAYLOAD_B64="Ci8qIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkAogICBQQVJUIDEgwrcgRk9VTkRBVElPTiDigJQgc2hhcmVkIHByaW1pdGl2ZXMgKyBvcGVuIHNwYWNpbmcKICAgQWRkaXRpdmUgb25seS4gTm90aGluZyBhYm92ZSB0aGlzIGxpbmUgaXMgbW9kaWZpZWQuCiAgIE1hcmtlciBndWFyZDogVk1fUEFSVDFfRk9VTkRBVElPTgogICDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZAgKi8KCi8qIOKUgOKUgOKUgCBTcGFjaW5nIHJoeXRobSDilIDilIDilIAgb3BlbiwgbW9ja3VwLW1hdGNoZWQuIFNjcmVlbnMgdXNlIHRoZXNlIHZhcnMgc28gdGhlCiAgIHdob2xlIGFwcCBicmVhdGhlcyBmcm9tIG9uZSBwbGFjZSBpbnN0ZWFkIG9mIHBlci1zY3JlZW4gbWFnaWMgbnVtYmVycy4gKi8KOnJvb3QgewogIC0tc3BhY2Utc2VjdGlvbjogNXJlbTsgICAvKiBiZXR3ZWVuIG1ham9yIHBhZ2Ugc2VjdGlvbnMgKHdhcyB+NHJlbSBhZC1ob2MpICovCiAgLS1zcGFjZS1ibG9jazogICAycmVtOyAgIC8qIGJldHdlZW4gYmxvY2tzIHdpdGhpbiBhIHNlY3Rpb24gKi8KICAtLXNwYWNlLXBhbmVsOiAgIDEuNXJlbTsgLyogaW50ZXJuYWwgcGFuZWwgcGFkZGluZyAod2FzIDAuNzVyZW0taXNoKSAqLwogIC0tc3BhY2UtdGlnaHQ6ICAgMXJlbTsKfQoKLyog4pSA4pSA4pSAIFNlY3Rpb24gc2hlbGwg4pSA4pSA4pSAIGNvbnNpc3RlbnQgbWF4IHdpZHRoICsgZ2VuZXJvdXMgZ3V0dGVycyBldmVyeXdoZXJlLiAqLwouc2VjdGlvbiB7CiAgbWF4LXdpZHRoOiAxNDAwcHg7CiAgbWFyZ2luLWlubGluZTogYXV0bzsKICBwYWRkaW5nLWlubGluZTogMS41cmVtOwp9CkBtZWRpYSAobWluLXdpZHRoOiA2NDBweCkgeyAuc2VjdGlvbiB7IHBhZGRpbmctaW5saW5lOiAycmVtOyB9IH0KCi8qIOKUgOKUgOKUgCBQYW5lbCBwYWRkaW5nIOKUgOKUgOKUgCBhbiBvcHQtaW4gcm9vbWllciBpbnRlcmlvciBmb3IgZmxhdCBwYW5lbHMuICovCi5wYW5lbC1wYWQgeyBwYWRkaW5nOiB2YXIoLS1zcGFjZS1wYW5lbCk7IH0KCi8qIOKUgOKUgOKUgCBQYW5lbCBoZWFkZXIg4pSA4pSA4pSAIHRoZSBtb2NrdXAgZ2l2ZXMgZXZlcnkgcGFuZWwgYSB0aXRsZWQgaGVhZGVyIHdpdGggYQogICBoYWlybGluZSB1bmRlciBpdC4gQ3VycmVudGx5IGhhbmQtcm9sbGVkIHBlciBzY3JlZW4uIE9uZSBjbGFzcyBpbnN0ZWFkLiAqLwoucGFuZWwtaGVhZCB7CiAgZGlzcGxheTogZmxleDsKICBhbGlnbi1pdGVtczogY2VudGVyOwogIGp1c3RpZnktY29udGVudDogc3BhY2UtYmV0d2VlbjsKICBnYXA6IDAuNzVyZW07CiAgcGFkZGluZy1ib3R0b206IDAuODc1cmVtOwogIG1hcmdpbi1ib3R0b206IDEuMjVyZW07CiAgYm9yZGVyLWJvdHRvbTogMXB4IHNvbGlkIHZhcigtLXJ1bGUpOwp9Ci5wYW5lbC1oZWFkLXRpdGxlIHsKICBmb250LWZhbWlseTogdmFyKC0tZm9udC1pbnRlci10aWdodCksIHNhbnMtc2VyaWY7CiAgZm9udC1zaXplOiAxM3B4OwogIGZvbnQtd2VpZ2h0OiA1MDA7CiAgbGV0dGVyLXNwYWNpbmc6IC0wLjAxZW07CiAgY29sb3I6IHZhcigtLXBhcGVyKTsKfQoKLyog4pSA4pSA4pSAIEJhZGdlIC8gcGlsbCDilIDilIDilIAgdGhlICJ2ZXJpZmllZCBvbiBzaGVsYnkiIGNoaXAsIHN0YW5kYXJkaXNlZC4KICAgTWVhbmluZyBzdGF5cyBpbiB0aGUgY29sb3VyOiBtYXJrZXIgPSBpbnRlbGxpZ2VuY2UvdmVyaWZpZWQuICovCi5iYWRnZSB7CiAgZGlzcGxheTogaW5saW5lLWZsZXg7CiAgYWxpZ24taXRlbXM6IGNlbnRlcjsKICBnYXA6IDVweDsKICBmb250LWZhbWlseTogdmFyKC0tZm9udC1tb25vKSwgdWktbW9ub3NwYWNlLCBtb25vc3BhY2U7CiAgZm9udC1zaXplOiAxMHB4OwogIGxldHRlci1zcGFjaW5nOiAwLjA4ZW07CiAgdGV4dC10cmFuc2Zvcm06IHVwcGVyY2FzZTsKICBwYWRkaW5nOiA0cHggOXB4OwogIGJvcmRlcjogMXB4IHNvbGlkIHZhcigtLXJ1bGUpOwogIGNvbG9yOiB2YXIoLS1wYXBlci0yKTsKfQouYmFkZ2UtbWFya2VyIHsgYm9yZGVyLWNvbG9yOiB2YXIoLS1tYXJrZXItZGltKTsgY29sb3I6IHZhcigtLW1hcmtlcik7IH0KLmJhZGdlLXNpZ25hbCB7IGJvcmRlci1jb2xvcjogdmFyKC0tc2lnbmFsLWRpbSk7IGNvbG9yOiB2YXIoLS1zaWduYWwpOyB9CgovKiDilIDilIDilIAgU3RhdCDilIDilIDilIAgbWV0cmljIHJlYWRvdXRzIChsaWJyYXJ5IGNvdW50cywgYmxvYiB0b3RhbHMpIHNob3duIGFkLWhvYy4gKi8KLnN0YXQtdmFsdWUgewogIGZvbnQtZmFtaWx5OiB2YXIoLS1mb250LW1vbm8pLCB1aS1tb25vc3BhY2UsIG1vbm9zcGFjZTsKICBmb250LXZhcmlhbnQtbnVtZXJpYzogdGFidWxhci1udW1zOwogIGZvbnQtc2l6ZTogMjRweDsKICBmb250LXdlaWdodDogNTAwOwogIGNvbG9yOiB2YXIoLS1wYXBlcik7CiAgbGluZS1oZWlnaHQ6IDE7Cn0KLnN0YXQtbGFiZWwgewogIGZvbnQtZmFtaWx5OiB2YXIoLS1mb250LW1vbm8pLCB1aS1tb25vc3BhY2UsIG1vbm9zcGFjZTsKICBmb250LXNpemU6IDEwcHg7CiAgbGV0dGVyLXNwYWNpbmc6IDAuMTRlbTsKICB0ZXh0LXRyYW5zZm9ybTogdXBwZXJjYXNlOwogIGNvbG9yOiB2YXIoLS1kaW0tMik7CiAgbWFyZ2luLXRvcDogNnB4Owp9Cg=="

TMP="$(mktemp)"
printf '%s' "$PAYLOAD_B64" | base64 -d > "$TMP" || die "base64 decode failed."

# verify decoded payload carries the marker before we touch the target
grep -q "$MARKER" "$TMP" || die "decoded payload missing marker - aborting, target untouched."

cat "$TMP" >> "$TARGET"
rm -f "$TMP"

# verify the append landed
grep -q "$MARKER" "$TARGET" || die "append verification failed - restore from $TARGET.bak-$STAMP"

say "Applied Part 1 foundation to $TARGET"
say "Next: cd frontend && npm run build   (verify locally before deploying)"
