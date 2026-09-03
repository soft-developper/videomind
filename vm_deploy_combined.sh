#!/usr/bin/env bash
# ============================================================================
# VideoMind - Combined deploy (UI redesign + wallet fix + parallel upload)
# ============================================================================
# Applies all changes, verifies BOTH packages compile, and only then commits
# and pushes once to main (triggers Render + Vercel together).
#
#   Run from the repo root (~/videomind - contains backend/, frontend/, .git).
#
#   ./vm_deploy_combined.sh              apply + verify + commit + push
#   ./vm_deploy_combined.sh --no-push    apply + verify + commit (no push)
#   ./vm_deploy_combined.sh --dry        apply + verify only (no git)
#
# Safety: if EITHER the backend tsc check or the frontend build fails,
# nothing is committed or pushed. Each part script has its own --revert.
# ============================================================================
set -euo pipefail

BRANCH="main"
MODE="${1:-push}"

# UI parts + wallet fix + parallel upload, in dependency order.
SCRIPTS=(
  vm_part1_foundation
  vm_part2_landing
  vm_part3_workspace
  vm_part4_upload
  vm_part5_secondary
  vm_landing_wallet
  vm_upload_parallel
)

say()  { printf '\n=== %s ===\n' "$1"; }
info() { printf '  %s\n' "$1"; }
die()  { printf '\nERROR: %s\n' "$1" >&2; exit 1; }

# ---- preflight --------------------------------------------------------------
[ -d frontend ] || die "No frontend/ here. Run from repo root (~/videomind)."
[ -d backend ]  || die "No backend/ here. Run from repo root (~/videomind)."
[ -d .git ]     || die "No .git here. Run from repo root (~/videomind)."

for s in "${SCRIPTS[@]}"; do
  [ -f "$s.sh" ] || die "Missing $s.sh in $(pwd). Download all seven scripts here first."
done

# normalise line endings + make executable (WSL/Windows safety)
for s in "${SCRIPTS[@]}"; do
  sed -i 's/\r$//' "$s.sh"
  chmod +x "$s.sh"
done

# ---- apply in order ---------------------------------------------------------
say "Applying all changes"
for s in "${SCRIPTS[@]}"; do
  info "-> $s.sh"
  "./$s.sh"
done

# ---- verify BOTH packages (the gate) ----------------------------------------
say "Verifying backend (tsc) - gate 1 of 2"
pushd backend >/dev/null
if ! npx tsc --noEmit; then
  popd >/dev/null
  die "BACKEND tsc FAILED. Nothing committed or pushed. Inspect, or revert each part with ./vm_*.sh --revert"
fi
popd >/dev/null
info "Backend tsc passed."

say "Verifying frontend (build) - gate 2 of 2"
pushd frontend >/dev/null
if ! npm run build; then
  popd >/dev/null
  die "FRONTEND build FAILED. Nothing committed or pushed. Inspect, or revert each part with ./vm_*.sh --revert"
fi
popd >/dev/null
info "Frontend build passed."

# ---- dry stop ---------------------------------------------------------------
if [ "$MODE" = "--dry" ]; then
  say "Dry run complete"
  info "Everything applied and both packages verified. No git actions taken."
  info "When ready: ./vm_deploy_combined.sh"
  exit 0
fi

# ---- commit -----------------------------------------------------------------
say "Committing"
CUR="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "$BRANCH")"
[ "$CUR" = "$BRANCH" ] || die "You are on '$CUR', not '$BRANCH'. Switch with: git checkout $BRANCH"

git add -A
if git diff --cached --quiet; then
  info "Nothing to commit (already committed?). Skipping."
else
  git commit -m "UI redesign + real wallet on landing + parallel upload

Frontend: Edit Bay polish, landing/library split, workspace + upload
spacing, landing proof panel shows the real connected wallet.
Backend + frontend: parallel upload (reserve id, then backend file
upload and Shelby wallet upload run concurrently; confirm waits on both).
Whisper/AI pipeline unchanged; all Shelby specifics preserved."
  info "Committed."
fi

# ---- no-push stop -----------------------------------------------------------
if [ "$MODE" = "--no-push" ]; then
  say "Committed but NOT pushed (--no-push)"
  info "When ready: git push origin $BRANCH"
  exit 0
fi

# ---- push -------------------------------------------------------------------
say "Pushing to origin/$BRANCH"
git push origin "$BRANCH"
info "Pushed. Render (backend) and Vercel (frontend) will both redeploy."

say "IMPORTANT - watch the dashboards"
info "One push triggers BOTH. There is a brief window where the frontend may"
info "go live before the backend. During it, uploads will 404 on /reserve."
info "-> Do NOT test an upload until Render shows the backend is LIVE (green)."
info "Then test one full upload to confirm the parallel flow + get a ready video."
