#!/usr/bin/env bash
# ============================================================================
# VideoMind Redesign - Part 4: Upload page spacing
# ============================================================================
# Presentation only. Applies the section primitive + open spacing to the
# upload PAGE WRAPPER. Does NOT touch UploadZone.tsx (all wallet/Shelby
# upload logic: arrayBuffer, Network.SHELBYNET, locationHint, prepare/confirm).
# Requires Part 1 applied.
#
#   ./vm_part4_upload.sh          apply
#   ./vm_part4_upload.sh --revert restore from backup
# ============================================================================
set -euo pipefail
UP="frontend/src/app/upload/page.tsx"
GLOBALS="frontend/src/app/globals.css"
STAMP="$(date +%Y%m%d-%H%M%S)"
BAKDIR="frontend/.vm_part4_backups"
say() { printf '  %s\n' "$1"; }
die() { printf 'ERROR: %s\n' "$1" >&2; exit 1; }
[ -f "$UP" ] || die "$UP not found. Run from repo root (folder containing frontend/)."

if [ "${1:-}" = "--revert" ]; then
  [ -d "$BAKDIR" ] || die "No backup dir. Nothing to revert."
  LATEST="$(ls -1d $BAKDIR/*/ 2>/dev/null | sort | tail -1)"
  [ -n "$LATEST" ] || die "No backups found."
  cp "$LATEST/page.tsx" "$UP"
  say "Reverted upload page from $LATEST"
  exit 0
fi

grep -q "VM_PART1_FOUNDATION" "$GLOBALS" 2>/dev/null || die "Part 1 not applied. Run ./vm_part1_foundation.sh first."
if grep -q 'className="section' "$UP" 2>/dev/null; then
  say "Part 4 already applied (upload page uses section). Use --revert to undo."; exit 0
fi

mkdir -p "$BAKDIR/$STAMP"; cp "$UP" "$BAKDIR/$STAMP/page.tsx"
say "Backup saved to $BAKDIR/$STAMP/"

TMP="$(mktemp)"; printf '%s' "aW1wb3J0IHsgTmF2YmFyIH0gZnJvbSAiQC9jb21wb25lbnRzL2xheW91dC9OYXZiYXIiOwppbXBvcnQgeyBVcGxvYWRab25lIH0gZnJvbSAiQC9jb21wb25lbnRzL3VwbG9hZC9VcGxvYWRab25lIjsKCmNvbnN0IFNURVBTID0gWwogIHsgbjogIlN0b3JlIiwgICAgICBkOiAiWW91ciB3YWxsZXQgc2lnbnMgdGhlIGJsb2IuIEl0IGxhbmRzIG9uIFNoZWxieSBQcm90b2NvbCwgb3duZWQgYnkgeW91LiIgfSwKICB7IG46ICJSZWFkIiwgICAgICAgZDogIldoaXNwZXIgdHJhbnNjcmliZXMgZXZlcnkgd29yZCB3aXRoIGEgdGltZWNvZGUgYXR0YWNoZWQuIiB9LAogIHsgbjogIk1hcCIsICAgICAgICBkOiAiQ2xhdWRlIGZpbmRzIHRoZSBjdXRzLCBmbGFncyB3aGF0IG1hdHRlcnMsIGFuZCB3cml0ZXMgdGhlIHN1bW1hcnkuIiB9LAogIHsgbjogIkFzayIsICAgICAgICBkOiAiUXVlc3Rpb24gdGhlIHZpZGVvIGluIHBsYWluIGxhbmd1YWdlLiBFdmVyeSBhbnN3ZXIgY2l0ZXMgYSB0aW1lY29kZS4iIH0sCl07CgpleHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBVcGxvYWRQYWdlKCkgewogIHJldHVybiAoCiAgICA8ZGl2IGNsYXNzTmFtZT0ibWluLWgtc2NyZWVuIGJnLXZvaWQiPgogICAgICA8TmF2YmFyIC8+CiAgICAgIDxtYWluIGNsYXNzTmFtZT0icHQtMTQiPgogICAgICAgIDxkaXYgY2xhc3NOYW1lPSJib3JkZXItYiBib3JkZXItcnVsZSI+CiAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT0ic2VjdGlvbiBweS0xMCI+CiAgICAgICAgICAgIDxwIGNsYXNzTmFtZT0iZXllYnJvdyBtYi00Ij5VcGxvYWQ8L3A+CiAgICAgICAgICAgIDxoMSBjbGFzc05hbWU9ImZvbnQtZGlzcGxheSB0ZXh0LVszMnB4XSBzbTp0ZXh0LVs0MnB4XSBsZWFkaW5nLVsxLjA1XSB0ZXh0LXBhcGVyIG1heC13LXhsIj4KICAgICAgICAgICAgICBIYW5kIGl0IGEgcmVjb3JkaW5nLgogICAgICAgICAgICAgIDxiciAvPgogICAgICAgICAgICAgIDxzcGFuIGNsYXNzTmFtZT0iaXRhbGljIHRleHQtc2lnbmFsIj5HZXQgYmFjayBhIG1hcC48L3NwYW4+CiAgICAgICAgICAgIDwvaDE+CiAgICAgICAgICA8L2Rpdj4KICAgICAgICA8L2Rpdj4KCiAgICAgICAgPGRpdiBjbGFzc05hbWU9InNlY3Rpb24gcHktOCI+CiAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT0iZ3JpZCBsZzpncmlkLWNvbHMtWzFmcl8zNDBweF0gZ2FwLTEyIGl0ZW1zLXN0YXJ0Ij4KICAgICAgICAgICAgPFVwbG9hZFpvbmUgLz4KCiAgICAgICAgICAgIDxhc2lkZSBjbGFzc05hbWU9InNwYWNlLXktMCI+CiAgICAgICAgICAgICAgPHAgY2xhc3NOYW1lPSJleWVicm93IG1iLTQiPldoYXQgaGFwcGVucyBuZXh0PC9wPgoKICAgICAgICAgICAgICB7LyogVGhpcyBJUyBhIHNlcXVlbmNlIOKAlCBvcmRlciBjYXJyaWVzIHJlYWwgaW5mb3JtYXRpb24gaGVyZS4gKi99CiAgICAgICAgICAgICAge1NURVBTLm1hcCgocywgaSkgPT4gKAogICAgICAgICAgICAgICAgPGRpdiBrZXk9e3Mubn0gY2xhc3NOYW1lPSJmbGV4IGdhcC00IHB5LTQgYm9yZGVyLXQgYm9yZGVyLXJ1bGUgbGFzdDpib3JkZXItYiI+CiAgICAgICAgICAgICAgICAgIDxzcGFuIGNsYXNzTmFtZT0idGMgdGFidWxhci1udW1zIHNocmluay0wIHB0LTAuNSI+CiAgICAgICAgICAgICAgICAgICAge1N0cmluZyhpICsgMSkucGFkU3RhcnQoMiwgIjAiKX0KICAgICAgICAgICAgICAgICAgPC9zcGFuPgogICAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT0ibWluLXctMCI+CiAgICAgICAgICAgICAgICAgICAgPHAgY2xhc3NOYW1lPSJmb250LWRpc3BsYXkgdGV4dC1bMTdweF0gdGV4dC1wYXBlciBsZWFkaW5nLW5vbmUiPgogICAgICAgICAgICAgICAgICAgICAge3Mubn0KICAgICAgICAgICAgICAgICAgICA8L3A+CiAgICAgICAgICAgICAgICAgICAgPHAgY2xhc3NOYW1lPSJ0ZXh0LVsxMnB4XSBmb250LXNhbnMgdGV4dC1kaW0gbXQtMS41IGxlYWRpbmctcmVsYXhlZCI+CiAgICAgICAgICAgICAgICAgICAgICB7cy5kfQogICAgICAgICAgICAgICAgICAgIDwvcD4KICAgICAgICAgICAgICAgICAgPC9kaXY+CiAgICAgICAgICAgICAgICA8L2Rpdj4KICAgICAgICAgICAgICApKX0KCiAgICAgICAgICAgICAgPGRpdiBjbGFzc05hbWU9Im10LTYgcHQtNCBib3JkZXItdCBib3JkZXItcnVsZSI+CiAgICAgICAgICAgICAgICA8cCBjbGFzc05hbWU9InRjIGxlYWRpbmctcmVsYXhlZCI+CiAgICAgICAgICAgICAgICAgIFNoZWxieSB0ZXN0bmV0IGV4cGlyZXMgYmxvYnMgYWZ0ZXIgNDggaG91cnMuIFZpZGVvTWluZCBmbGFncwogICAgICAgICAgICAgICAgICBleHBpcmluZyB2aWRlb3Mgd2hlbiB5b3UgY29ubmVjdCDigJQgb25lIHNpZ25hdHVyZSByZW5ld3MgdGhlbSBhbGwuCiAgICAgICAgICAgICAgICA8L3A+CiAgICAgICAgICAgICAgPC9kaXY+CiAgICAgICAgICAgIDwvYXNpZGU+CiAgICAgICAgICA8L2Rpdj4KICAgICAgICA8L2Rpdj4KICAgICAgPC9tYWluPgogICAgPC9kaXY+CiAgKTsKfQo=" | base64 -d > "$TMP" || die "base64 decode failed."
grep -q "UploadZone" "$TMP" || die "payload verify failed (missing UploadZone). Nothing written."
grep -q 'className="section' "$TMP" || die "payload verify failed (missing section). Nothing written."
cp "$TMP" "$UP"; rm -f "$TMP"
grep -q "UploadZone" "$UP" || die "write verify failed - restore from $BAKDIR/$STAMP"

say "Applied Part 4: upload page spacing. UploadZone logic untouched."
say "Next: cd frontend && npm run build"
