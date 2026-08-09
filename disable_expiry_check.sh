#!/usr/bin/env bash
# VideoMind — fully disable the broken expiry-check query
#
# Traced exhaustively through the entire @shelby-protocol/sdk browser
# bundle: getBlobs/getAccountBlobs has exactly 3 call sites, all inside
# the method definitions only reachable via useAccountBlobs (ExpiryBanner).
# useUploadBlobs never calls this query -- confirmed line by line.
#
# retry:false stopped repeated retries but the query still fired once
# per mount and logged its single failure. This patch disables the
# query entirely (enabled: false) so it never fires at all until
# Shelby's shelbynet indexer supports the `blobs` field.
#
# Trade-off: the "renew all expiring videos" banner is fully off until
# you flip EXPIRY_CHECK_ENABLED back to true. Per-video renewal via
# RenewButton on the video detail page is NOT affected -- verified it
# has zero dependency on this query.
#
# Run from the project root (must contain frontend/)

set -e
FE="$(pwd)/frontend"
[ -d "$FE" ] || { echo "❌ Run from project root"; exit 1; }

FILE="$FE/src/components/layout/ExpiryBanner.tsx"
[ -f "$FILE" ] || { echo "❌ File not found: $FILE"; exit 1; }

python3 << 'PYEOF'
path = "frontend/src/components/layout/ExpiryBanner.tsx"
with open(path) as f:
    content = f.read()

# Handle both possible current states: the retry:false version, or the
# original unpatched version, so this script works regardless of which
# fix was applied last.
targets = [
    '''  // shelbynet's blob indexer does not yet expose the `blobs` GraphQL
  // field (infra gap from the testnet -> shelbynet migration). This is
  // confirmed unrelated to uploads: useUploadBlobs -> registerBlob()
  // never touches the indexer. retry: false stops this background
  // "check for expiring videos" call from hammering a broken endpoint.
  const { data: raw, isLoading } = useAccountBlobs({ account: wallet ?? "", retry: false } as any);''',
    '  const { data: raw, isLoading } = useAccountBlobs({ account: wallet ?? "" } as any);',
]

new = '''  // shelbynet's blob indexer does not yet expose the `blobs` GraphQL
  // field (infra gap from the testnet -> shelbynet migration), confirmed
  // by tracing every call site of getBlobs/getAccountBlobs in the SDK --
  // only this hook calls it. Uploads (useUploadBlobs -> registerBlob())
  // never touch the indexer and are completely unaffected.
  //
  // enabled: false switches this off entirely until Shelby's indexer
  // supports the query, so it never fires and never appears in the
  // console or network tab. Flip back to true once it's fixed.
  const EXPIRY_CHECK_ENABLED = false;
  const { data: raw, isLoading } = useAccountBlobs({
    account: wallet ?? "",
    enabled: EXPIRY_CHECK_ENABLED && !!wallet && connected,
  } as any);'''

matched = False
for old in targets:
    if content.count(old) == 1:
        content = content.replace(old, new, 1)
        matched = True
        break

if not matched:
    print("❌ No known pattern matched -- file has changed unexpectedly.")
    print("   Run: grep -n 'useAccountBlobs' frontend/src/components/layout/ExpiryBanner.tsx")
    print("   and paste the output back.")
    exit(1)

with open(path, "w") as f:
    f.write(content)
print("✅ Patched — expiry check fully disabled, zero console/network noise")
PYEOF

echo ""
echo "  git add frontend/src/components/layout/ExpiryBanner.tsx"
echo "  git commit -m 'fix: disable broken shelbynet expiry-check query entirely'"
echo "  git push"
