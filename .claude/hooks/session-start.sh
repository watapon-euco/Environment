#!/bin/bash
# SessionStart hook: mirror dotfiles/ into ~/.claude/ at the start of every
# Claude Code session in this repository. Only runs in the remote (web) env
# where the container's ~/.claude/ may have been reset; local users sync
# manually by running setup.sh.

set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

bash "$CLAUDE_PROJECT_DIR/setup.sh"
