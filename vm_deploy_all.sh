#!/usr/bin/env bash
# ============================================================================
# VideoMind Redesign - Full deploy
# Applies Parts 1-5, builds locally, and ONLY IF the build passes,
# commits and pushes to main (triggering Vercel).
#
#   Run from the repo root (~/videomind - the folder with frontend/ and .git).
#
#   ./vm_deploy_all.sh              apply + build + commit + push
#   ./vm_deploy_all.sh --no-push    apply + build + commit, but DO NOT push
#   ./vm_deploy_all.sh --dry        apply + build only (no git at all)
#
# Safety: if the build fails, nothing is committed or pushed. The five part
# scripts each back up what they touch and each supports --revert.
# ============================================================================
set -euo pipefail

BRANCH="main"
MODE="${1:-push}"

PARTS=(vm_part1_foundation vm_part2_landing vm_part3_workspace vm_part4_upload vm_part5_secondary)

say()  { printf '\n=== %s ===\n' "$1"; }
info() { printf '  %s\n' "$1"; }
die()  { printf '\nERROR: %s\n' "$1" >&2; exit 1; }

# ---- preflight --------------------------------------------------------------
[ -d frontend ] || die "No frontend/ here. Run from the repo root (~/videomind)."
[ -d .git ]     || die "No .git here. Run from the repo root (~/videomind)."

for p in "${PARTS[@]}"; do
  [ -f "$p.sh" ] || die "Missing $p.sh in $(pwd). Download all five part scripts here first."
done

# normalise line endings + make executable (WSL/Windows safety)
for p in "${PARTS[@]}"; do
  sed -i 's/\r$//' "$p.sh"
  chmod +x "$p.sh"
done

# ---- apply parts in order ---------------------------------------------------
say "Applying redesign parts 1-5"
for p in "${PARTS[@]}"; do
  info "-> $p.sh"
  "./$p.sh"
done

# ---- build (the gate) -------------------------------------------------------
say "Building frontend (this is the gate - no push if it fails)"
pushd frontend >/dev/null
if ! npm run build; then
  popd >/dev/null
  die "BUILD FAILED. Nothing committed or pushed. Your working tree still has the changes so you can inspect them, or revert each part with: ./vm_partN_*.sh --revert"
fi
popd >/dev/null
info "Build passed."

# ---- dry stop ---------------------------------------------------------------
if [ "$MODE" = "--dry" ]; then
  say "Dry run complete"
  info "Changes applied and build verified. No git actions taken."
  info "When ready: ./vm_deploy_all.sh   (to commit + push)"
  exit 0
fi

# ---- git commit -------------------------------------------------------------
say "Committing"
CUR="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "$BRANCH")"
if [ "$CUR" != "$BRANCH" ]; then
  info "You are on '$CUR', not '$BRANCH'."
  die "Switch to $BRANCH first (git checkout $BRANCH) then re-run, or push $CUR manually."
fi

git add -A
if git diff --cached --quiet; then
  info "Nothing to commit (already committed?). Skipping commit."
else
  git commit -m "UI redesign: Edit Bay polish, landing/library split, workspace + upload spacing

Parts 1-5: shared style foundation, pure landing page with library moved
to /library, video workspace polish + back-link fixes, upload page spacing
(UploadZone logic untouched), about link fix + share page spacing.
No lib/, hooks, wallet, upload, or indexer logic changed."
  info "Committed."
fi

# ---- dont-push stop ---------------------------------------------------------
if [ "$MODE" = "--no-push" ]; then
  say "Committed but NOT pushed (--no-push)"
  info "When ready: git push origin $BRANCH"
  exit 0
fi

# ---- push -------------------------------------------------------------------
say "Pushing to origin/$BRANCH"
git push origin "$BRANCH"
info "Pushed. Vercel will pick up the frontend automatically."
info "Watch the deploy at https://vercel.com (your VideoMind project)."

say "Done"
info "No NEXT_PUBLIC_* env vars changed, so no Vercel env update needed."
info "First prod check: do one full upload - it exercises wallet + Shelby + pipeline"
info "and gives you a ready video to verify the workspace redesign against."
