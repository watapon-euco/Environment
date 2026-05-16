#!/bin/bash
# SessionStart hook for repositories created from the claude-starter template.
# Clones the public dotfiles repo (watapon-euco/Environment) and runs its
# setup.sh to populate ~/.claude/ in the ephemeral web container. Local
# environments skip this since ~/.claude/ persists naturally.

set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

DOTFILES_REPO="https://github.com/watapon-euco/Environment"
CLONE_DIR="/tmp/_env-dotfiles"

if [ -d "$CLONE_DIR/.git" ]; then
  git -C "$CLONE_DIR" pull --ff-only --quiet || true
else
  rm -rf "$CLONE_DIR"
  git clone --depth 1 --quiet "$DOTFILES_REPO" "$CLONE_DIR"
fi

bash "$CLONE_DIR/setup.sh"
