#!/usr/bin/env bash
# ============================================================================
# VideoMind - Shelby SDK 0.9 upgrade, Part 1b (build fix)
# ============================================================================
# Fixes the frontend build failure after Part 1:
#   TypeError: Cannot read properties of undefined (reading 'toString')
#   Error occurred prerendering page "/", "/upload", "/library", ...
#
# Cause: Part 1 renamed useAccountBlobs -> useAccountObjects in
# ExpiryBanner.tsx but kept the old `account` parameter. The new hook
# takes `owner` and calls owner.toString() on every render. ExpiryBanner
# sits in the Navbar, so every page crashed at prerender. An `as any`
# cast hid this from tsc; the cast is removed here.
#
#   frontend/src/components/layout/ExpiryBanner.tsx   (only file changed)
#
#   ./vm_shelby_sdk09b.sh            apply (needs Part 1 applied first)
#   ./vm_shelby_sdk09b.sh --revert   restore ExpiryBanner.tsx from backup
#
# Run from the repo root (dir containing backend/ and frontend/).
# ============================================================================
set -euo pipefail

EB="frontend/src/components/layout/ExpiryBanner.tsx"
MARKER="vm_shelby09b"
STAMP="$(date +%Y%m%d-%H%M%S)"
BAKDIR=".vm_shelby09b_backups"
PRE_EB="8e28ab6349fe1e3fb6b3ff85160903e3160ad3b7b2f793ccdd0fd08f2233360c"
NEW_EB="7426ff7f48f786e85640f5e6bc81e66763978242600a5f4ff093febca2f0e4fe"

say() { printf '  %s\n' "$1"; }
die() { printf 'ERROR: %s\n' "$1" >&2; exit 1; }
sha() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

[ -f "$EB" ] || die "$EB not found. Run from repo root (dir with backend/ and frontend/)."

if [ "${1:-}" = "--revert" ]; then
  [ -d "$BAKDIR" ] || die "No backup dir. Nothing to revert."
  LATEST="$(ls -1d "$BAKDIR"/*/ 2>/dev/null | sort | tail -1)"
  [ -n "$LATEST" ] || die "No backups found."
  cp "${LATEST%/}/ExpiryBanner.tsx" "$EB"
  say "Reverted ExpiryBanner.tsx from $LATEST"
  exit 0
fi

if grep -q "$MARKER" "$EB" 2>/dev/null; then
  say "Already applied ($MARKER marker present). Use --revert to undo."
  exit 0
fi

grep -q "vm_shelby09" "$EB" || die "Part 1 is not applied to $EB. Run ./vm_shelby_sdk09.sh first."
[ "$(sha "$EB")" = "$PRE_EB" ] || die "$EB is not the Part 1 version this fix was built on. Nothing changed."

TMPD="$(mktemp -d)"
trap 'rm -rf "$TMPD"' EXIT
base64 -d > "$TMPD/ExpiryBanner.tsx" <<'B64_EB' || die "ExpiryBanner.tsx: base64 decode failed."
InVzZSBjbGllbnQiOwppbXBvcnQgeyB1c2VTdGF0ZSwgdXNlRWZmZWN0IH0gZnJvbSAicmVhY3Qi
OwppbXBvcnQgeyB1c2VXYWxsZXQgfSBmcm9tICJAYXB0b3MtbGFicy93YWxsZXQtYWRhcHRlci1y
ZWFjdCI7CmltcG9ydCB7IHVzZUFjY291bnRPYmplY3RzLCB1c2VVcGxvYWRCbG9icyB9IGZyb20g
IkBzaGVsYnktcHJvdG9jb2wvcmVhY3QiOwppbXBvcnQgeyBYLCBSZWZyZXNoQ3csIENoZWNrIH0g
ZnJvbSAibHVjaWRlLXJlYWN0IjsKCmNvbnN0IFdBUk5fTUlDUk9TID0gMjQgKiAzXzYwMF8wMDBf
MDAwOwp0eXBlIEJsb2IgPSBSZWNvcmQ8c3RyaW5nLCBhbnk+Owp0eXBlIFMgPSAiaWRsZSIgfCAi
ZmV0Y2hpbmciIHwgInNpZ25pbmciIHwgImRvbmUiIHwgImVycm9yIjsKCmV4cG9ydCBmdW5jdGlv
biBFeHBpcnlCYW5uZXIoKSB7CiAgY29uc3QgeyBjb25uZWN0ZWQsIGFjY291bnQsIHNpZ25BbmRT
dWJtaXRUcmFuc2FjdGlvbiB9ID0gdXNlV2FsbGV0KCk7CiAgY29uc3Qgd2FsbGV0ID0gYWNjb3Vu
dD8uYWRkcmVzcz8udG9TdHJpbmcoKTsKICBjb25zdCBbaGlkLCBzZXRIaWRdID0gdXNlU3RhdGUo
ZmFsc2UpOwogIGNvbnN0IFtzLCBzZXRTXSA9IHVzZVN0YXRlPFM+KCJpZGxlIik7CiAgY29uc3Qg
W2Vyciwgc2V0RXJyXSA9IHVzZVN0YXRlPHN0cmluZyB8IG51bGw+KG51bGwpOwoKICB1c2VFZmZl
Y3QoKCkgPT4geyBzZXRIaWQoZmFsc2UpOyBzZXRTKCJpZGxlIik7IH0sIFt3YWxsZXRdKTsKCiAg
Ly8gc2hlbGJ5bmV0J3MgYmxvYiBpbmRleGVyIGRvZXMgbm90IHlldCBleHBvc2UgdGhlIGBibG9i
c2AgR3JhcGhRTAogIC8vIGZpZWxkIChpbmZyYSBnYXAgZnJvbSB0aGUgdGVzdG5ldCAtPiBzaGVs
YnluZXQgbWlncmF0aW9uKSwgY29uZmlybWVkCiAgLy8gYnkgdHJhY2luZyBldmVyeSBjYWxsIHNp
dGUgb2YgZ2V0QmxvYnMvZ2V0QWNjb3VudEJsb2JzIGluIHRoZSBTREsgLS0KICAvLyBvbmx5IHRo
aXMgaG9vayBjYWxscyBpdC4gVXBsb2FkcyAodXNlVXBsb2FkQmxvYnMgLT4gcmVnaXN0ZXJCbG9i
KCkpCiAgLy8gbmV2ZXIgdG91Y2ggdGhlIGluZGV4ZXIgYW5kIGFyZSBjb21wbGV0ZWx5IHVuYWZm
ZWN0ZWQuCiAgLy8KICAvLyBlbmFibGVkOiBmYWxzZSBzd2l0Y2hlcyB0aGlzIG9mZiBlbnRpcmVs
eSB1bnRpbCBTaGVsYnkncyBpbmRleGVyCiAgLy8gc3VwcG9ydHMgdGhlIHF1ZXJ5LCBzbyBpdCBu
ZXZlciBmaXJlcyBhbmQgbmV2ZXIgYXBwZWFycyBpbiB0aGUKICAvLyBjb25zb2xlIG9yIG5ldHdv
cmsgdGFiLiBGbGlwIGJhY2sgdG8gdHJ1ZSBvbmNlIGl0J3MgZml4ZWQuCiAgLy8gdm1fc2hlbGJ5
MDk6IGV4cGlyYXRpb24gcmVtb3ZlZCBmcm9tIGJsb2IgcmVnaXN0cmF0aW9uIChzZGsgPj0gMC44
LjApCiAgLy8gUmVuZXdhbCBpcyBzd2l0Y2hlZCBPRkY6IHRoZSBjb250cmFjdCBubyBsb25nZXIg
dGFrZXMgYW4gZXhwaXJ5LCBzbwogIC8vIHRoZSBvbGQgInJlLXVwbG9hZCB3aXRoIGEgZnJlc2gg
ZXhwaXJhdGlvbk1pY3JvcyIgcmVuZXcgaGFzIG5vdGhpbmcgdG8KICAvLyBtYXAgdG8uIExlYXZl
IGZhbHNlIHVudGlsIHRoZSByZW5ldyBmbG93IGlzIHJld29ya2VkIChQYXJ0IDIpLgogIGNvbnN0
IEVYUElSWV9DSEVDS19FTkFCTEVEID0gZmFsc2U7CiAgLy8gdm1fc2hlbGJ5MDliOiB1c2VBY2Nv
dW50T2JqZWN0cyB0YWtlcyBgb3duZXJgICh1c2VBY2NvdW50QmxvYnMgdG9vawogIC8vIGBhY2Nv
dW50YCkuIFRoZSBob29rIHJlYWRzIG93bmVyLnRvU3RyaW5nKCkgZm9yIGl0cyBxdWVyeSBrZXkg
b24KICAvLyBldmVyeSByZW5kZXIsIGluY2x1ZGluZyB0aGUgc2VydmVyIHByZXJlbmRlciwgc28g
aXQgbXVzdCBuZXZlciBiZQogIC8vIHVuZGVmaW5lZC4KICBjb25zdCB7IGRhdGE6IHJhdywgaXNM
b2FkaW5nIH0gPSB1c2VBY2NvdW50T2JqZWN0cyh7CiAgICBvd25lcjogd2FsbGV0ID8/ICIiLAog
ICAgZW5hYmxlZDogRVhQSVJZX0NIRUNLX0VOQUJMRUQgJiYgISF3YWxsZXQgJiYgY29ubmVjdGVk
LAogIH0pOwogIGNvbnN0IGJsb2JzID0gKEFycmF5LmlzQXJyYXkocmF3KSA/IHJhdyA6IFtdKSBh
cyBCbG9iW107CgogIGNvbnN0IHVwbG9hZCA9IHVzZVVwbG9hZEJsb2JzKHsKICAgIG9uRXJyb3I6
IChlKSA9PiB7IHNldEVycihlLm1lc3NhZ2UpOyBzZXRTKCJlcnJvciIpOyB9LAogIH0pOwoKICBp
ZiAoIWNvbm5lY3RlZCB8fCAhd2FsbGV0IHx8IGhpZCB8fCBpc0xvYWRpbmcpIHJldHVybiBudWxs
OwoKICBjb25zdCBub3cgPSBEYXRlLm5vdygpICogMTAwMDsKICBjb25zdCBleHAgPSAoYjogQmxv
YikgPT4gTnVtYmVyKGJbImV4cGlyZXNfYXQiXSA/PyBiWyJleHBpcmVzQXQiXSA/PyAwKTsKICBj
b25zdCBzb29uID0gYmxvYnMuZmlsdGVyKChiKSA9PiBleHAoYikgPiAwICYmIGV4cChiKSA8IG5v
dyArIFdBUk5fTUlDUk9TKTsKICBpZiAoc29vbi5sZW5ndGggPT09IDApIHJldHVybiBudWxsOwoK
ICBpZiAocyA9PT0gImRvbmUiKSB7CiAgICByZXR1cm4gKAogICAgICA8ZGl2IGNsYXNzTmFtZT0i
Zml4ZWQgYm90dG9tLTUgbGVmdC0xLzIgLXRyYW5zbGF0ZS14LTEvMiB6LTUwIGZsZXggaXRlbXMt
Y2VudGVyIGdhcC0yLjUgcHgtNCBoLTEwIGJnLXZvaWQgYm9yZGVyIGJvcmRlci1tYXJrZXItZGlt
Ij4KICAgICAgICA8Q2hlY2sgc2l6ZT17MTJ9IGNsYXNzTmFtZT0idGV4dC1tYXJrZXIiIC8+CiAg
ICAgICAgPHNwYW4gY2xhc3NOYW1lPSJ0ZXh0LVsxMnB4XSBmb250LXNhbnMgdGV4dC1tYXJrZXIi
PlJlbmV3ZWQgLSBnb29kIGZvciA0NyBob3Vyczwvc3Bhbj4KICAgICAgPC9kaXY+CiAgICApOwog
IH0KCiAgY29uc3QgZGVhZCA9IHNvb24uZmlsdGVyKChiKSA9PiBleHAoYikgPCBub3cpLmxlbmd0
aDsKICBjb25zdCBsaXZlID0gc29vbi5sZW5ndGggLSBkZWFkOwoKICBjb25zdCByZW5ld0FsbCA9
IGFzeW5jICgpID0+IHsKICAgIGlmICghYWNjb3VudCB8fCAhc2lnbkFuZFN1Ym1pdFRyYW5zYWN0
aW9uKSByZXR1cm47CiAgICBzZXRTKCJmZXRjaGluZyIpOyBzZXRFcnIobnVsbCk7CiAgICB0cnkg
ewogICAgICBjb25zdCBwYXlsb2FkcyA9IGF3YWl0IFByb21pc2UuYWxsKAogICAgICAgIHNvb24u
ZmlsdGVyKChiKSA9PiBleHAoYikgPiBub3cpLm1hcChhc3luYyAoYikgPT4gewogICAgICAgICAg
Y29uc3QgbmFtZSA9IFN0cmluZyhiWyJuYW1lIl0gPz8gYlsiYmxvYk5hbWUiXSA/PyAiIik7CiAg
ICAgICAgICBjb25zdCByID0gYXdhaXQgZmV0Y2goCiAgICAgICAgICAgIGBodHRwczovL2FwaS5z
aGVsYnluZXQuc2hlbGJ5Lnh5ei9zaGVsYnkvdjEvYmxvYnMvJHt3YWxsZXR9LyR7ZW5jb2RlVVJJ
Q29tcG9uZW50KG5hbWUpfWAKICAgICAgICAgICk7CiAgICAgICAgICBpZiAoIXIub2spIHRocm93
IG5ldyBFcnJvcihgQ291bGRuJ3QgZmV0Y2ggJHtuYW1lfWApOwogICAgICAgICAgcmV0dXJuIHsg
YmxvYk5hbWU6IG5hbWUsIGJsb2JEYXRhOiBuZXcgVWludDhBcnJheShhd2FpdCByLmFycmF5QnVm
ZmVyKCkpIH07CiAgICAgICAgfSkKICAgICAgKTsKCiAgICAgIHNldFMoInNpZ25pbmciKTsKICAg
ICAgYXdhaXQgbmV3IFByb21pc2U8dm9pZD4oKHJlcywgcmVqKSA9PiB7CiAgICAgICAgdXBsb2Fk
Lm11dGF0ZSgKICAgICAgICAgIHsKICAgICAgICAgICAgc2lnbmVyOiB7IGFjY291bnQ6IGFjY291
bnQuYWRkcmVzcyBhcyBhbnksIHNpZ25BbmRTdWJtaXRUcmFuc2FjdGlvbiB9LAogICAgICAgICAg
ICBibG9iczogcGF5bG9hZHMsCiAgICAgICAgICB9LAogICAgICAgICAgeyBvblN1Y2Nlc3M6ICgp
ID0+IHJlcygpLCBvbkVycm9yOiAoZSkgPT4gcmVqKGUpIH0KICAgICAgICApOwogICAgICB9KTsK
CiAgICAgIHNldFMoImRvbmUiKTsKICAgICAgc2V0VGltZW91dCgoKSA9PiBzZXRTKCJpZGxlIiks
IDUwMDApOwogICAgfSBjYXRjaCAoZTogYW55KSB7CiAgICAgIHNldEVycihlLm1lc3NhZ2UgPz8g
IlJlbmV3YWwgZmFpbGVkLiIpOyBzZXRTKCJlcnJvciIpOwogICAgfQogIH07CgogIHJldHVybiAo
CiAgICA8ZGl2IGNsYXNzTmFtZT0iZml4ZWQgYm90dG9tLTUgbGVmdC0xLzIgLXRyYW5zbGF0ZS14
LTEvMiB6LTUwIHctZnVsbCBtYXgtdy1tZCBweC00Ij4KICAgICAgPGRpdiBjbGFzc05hbWU9ImJn
LXZvaWQgYm9yZGVyIGJvcmRlci13YXJuLzQwIj4KICAgICAgICA8ZGl2IGNsYXNzTmFtZT0iZmxl
eCBpdGVtcy1zdGFydCBnYXAtMyBwLTMiPgogICAgICAgICAgPHNwYW4gY2xhc3NOYW1lPSJkb3Qg
ZG90LXdvcmsgbXQtMS41IiAvPgogICAgICAgICAgPGRpdiBjbGFzc05hbWU9ImZsZXgtMSBtaW4t
dy0wIj4KICAgICAgICAgICAgPHAgY2xhc3NOYW1lPSJ0ZXh0LVsxM3B4XSBmb250LXNhbnMgdGV4
dC1wYXBlciI+CiAgICAgICAgICAgICAge2RlYWQgPiAwCiAgICAgICAgICAgICAgICA/IGAke2Rl
YWR9IGJsb2Ike2RlYWQgIT09IDEgPyAicyIgOiAiIn0gZXhwaXJlZCBvbiBTaGVsYnlgCiAgICAg
ICAgICAgICAgICA6IGAke2xpdmV9IGJsb2Ike2xpdmUgIT09IDEgPyAicyIgOiAiIn0gZXhwaXJl
IHdpdGhpbiAyNCBob3Vyc2B9CiAgICAgICAgICAgIDwvcD4KICAgICAgICAgICAgPHAgY2xhc3NO
YW1lPSJ0YyBtdC0wLjUgbGVhZGluZy1yZWxheGVkIj4KICAgICAgICAgICAgICB7ZGVhZCA+IDAK
ICAgICAgICAgICAgICAgID8gIkV4cGlyZWQgYmxvYnMgY2FuJ3QgYmUgcGxheWVkLiBSZS11cGxv
YWQgdGhlIGZpbGUuIgogICAgICAgICAgICAgICAgOiAiT25lIHNpZ25hdHVyZSByZW5ld3MgdGhl
bSBhbGwgZm9yIGFub3RoZXIgNDcgaG91cnMuIn0KICAgICAgICAgICAgPC9wPgogICAgICAgICAg
ICB7ZXJyICYmIDxwIGNsYXNzTmFtZT0idGMgdGV4dC1lcnJvci83MCBtdC0xIj57ZXJyfTwvcD59
CiAgICAgICAgICA8L2Rpdj4KICAgICAgICAgIDxidXR0b24gb25DbGljaz17KCkgPT4gc2V0SGlk
KHRydWUpfSBjbGFzc05hbWU9InRleHQtZGltIGhvdmVyOnRleHQtcGFwZXIgc2hyaW5rLTAgbm8t
bWluIj4KICAgICAgICAgICAgPFggc2l6ZT17MTJ9IC8+CiAgICAgICAgICA8L2J1dHRvbj4KICAg
ICAgICA8L2Rpdj4KCiAgICAgICAge2xpdmUgPiAwICYmICgKICAgICAgICAgIDxkaXYgY2xhc3NO
YW1lPSJmbGV4IGl0ZW1zLWNlbnRlciBnYXAtMyBweC0zIHBiLTMiPgogICAgICAgICAgICA8YnV0
dG9uCiAgICAgICAgICAgICAgb25DbGljaz17cmVuZXdBbGx9CiAgICAgICAgICAgICAgZGlzYWJs
ZWQ9e3MgPT09ICJmZXRjaGluZyIgfHwgcyA9PT0gInNpZ25pbmcifQogICAgICAgICAgICAgIGNs
YXNzTmFtZT0iZmxleCBpdGVtcy1jZW50ZXIgZ2FwLTEuNSBoLTggcHgtMyBiZy1zaWduYWwgdGV4
dC12b2lkIHRleHQtWzEycHhdIGZvbnQtc2FucyBob3ZlcjpiZy1bI0ZGNjQ0OV0gdHJhbnNpdGlv
bi1jb2xvcnMgZGlzYWJsZWQ6b3BhY2l0eS01MCBuby1taW4iCiAgICAgICAgICAgID4KICAgICAg
ICAgICAgICB7cyA9PT0gImlkbGUiICAgICAmJiA8PjxSZWZyZXNoQ3cgc2l6ZT17MTB9IC8+IFJl
bmV3IGFsbCB7bGl2ZX08Lz59CiAgICAgICAgICAgICAge3MgPT09ICJmZXRjaGluZyIgJiYgIkZl
dGNoaW5n4oCmIn0KICAgICAgICAgICAgICB7cyA9PT0gInNpZ25pbmciICAmJiAiQ2hlY2sgd2Fs
bGV0In0KICAgICAgICAgICAgICB7cyA9PT0gImVycm9yIiAgICAmJiA8PjxSZWZyZXNoQ3cgc2l6
ZT17MTB9IC8+IFJldHJ5PC8+fQogICAgICAgICAgICA8L2J1dHRvbj4KICAgICAgICAgICAgPGJ1
dHRvbiBvbkNsaWNrPXsoKSA9PiBzZXRIaWQodHJ1ZSl9IGNsYXNzTmFtZT0idGMgaG92ZXI6dGV4
dC1wYXBlciB0cmFuc2l0aW9uLWNvbG9ycyBtbC1hdXRvIG5vLW1pbiI+CiAgICAgICAgICAgICAg
TGF0ZXIKICAgICAgICAgICAgPC9idXR0b24+CiAgICAgICAgICA8L2Rpdj4KICAgICAgICApfQog
ICAgICA8L2Rpdj4KICAgIDwvZGl2PgogICk7Cn0K
B64_EB
[ -s "$TMPD/ExpiryBanner.tsx" ] || die "ExpiryBanner.tsx: decode produced an empty file. Nothing written."
[ "$(sha "$TMPD/ExpiryBanner.tsx")" = "$NEW_EB" ] || die "ExpiryBanner.tsx: payload checksum mismatch (script corrupted in transit). Nothing written."
grep -q 'owner: wallet' "$TMPD/ExpiryBanner.tsx" || die "Payload missing the owner parameter - aborting."
say "Payload decoded and verified."

mkdir -p "$BAKDIR/$STAMP"
cp "$EB" "$BAKDIR/$STAMP/ExpiryBanner.tsx"
say "Backup saved to $BAKDIR/$STAMP/"

cp "$TMPD/ExpiryBanner.tsx" "$EB"
grep -q "$MARKER" "$EB" || { cp "$BAKDIR/$STAMP/ExpiryBanner.tsx" "$EB"; die "Write verify failed. ExpiryBanner.tsx restored."; }

say "Applied build fix (Part 1b)."
say "Verify before deploying:"
say "  cd frontend && npx tsc --noEmit && npm run build"
say "Undo: ./vm_shelby_sdk09b.sh --revert"
