#!/usr/bin/env bash
# Apply the Claude Code remote-sync hook to existing repositories.
#
# Adds .claude/settings.json + .claude/hooks/session-start.sh to one or more
# existing git repositories, commits, and pushes. After this, Claude sessions
# started in the cloud (e.g. the GitHub connector) will auto-sync ~/.claude/
# from watapon-euco/Environment on each session start.
#
# Usage:
#   bash apply-to-existing.sh                       # apply to current directory
#   bash apply-to-existing.sh /path/to/repo ...     # apply to one or many repos
#
# Flags:
#   --no-push    Stage and commit, but don't push.
#
# Safe to re-run: if the files already exist with the same content, the script
# reports "no changes" and exits cleanly.

set -euo pipefail

DO_PUSH=1
TARGETS=()
for arg in "$@"; do
  case "$arg" in
    --no-push) DO_PUSH=0 ;;
    -h|--help)
      sed -n '2,17p' "$0"
      exit 0
      ;;
    *) TARGETS+=("$arg") ;;
  esac
done

if [ ${#TARGETS[@]} -eq 0 ]; then
  TARGETS=("$(pwd)")
fi

read -r -d '' SETTINGS_CONTENT <<'JSON' || true
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash $CLAUDE_PROJECT_DIR/.claude/hooks/session-start.sh"
          }
        ]
      }
    ]
  }
}
JSON

read -r -d '' HOOK_CONTENT <<'SH' || true
#!/bin/bash
# SessionStart hook: bootstrap and keep ~/.claude/ in sync with
# watapon-euco/Environment.
#
# Detection: a marker file (~/.claude/.env-dotfiles-managed) records that
# this machine is managed by us. Once it exists, every session re-pulls
# dotfiles/ and re-applies it, so config updates made in the source repo
# always reach already-provisioned containers instead of going stale after
# the first sync. Before the marker exists, an already-present
# ~/.claude/CLAUDE.md is assumed to be a real user's own config and is left
# untouched — first-contact bootstrap only runs when neither is present.

set -uo pipefail

MARKER="$HOME/.claude/.env-dotfiles-managed"

if [ ! -f "$MARKER" ] && [ -f "$HOME/.claude/CLAUDE.md" ]; then
  exit 0
fi

DOTFILES_REPO="https://github.com/watapon-euco/Environment"
CLONE_DIR="/tmp/_env-dotfiles"

# Always track main explicitly — a bare clone follows the repo's default
# branch on GitHub, which has pointed at stale work branches before.
if [ -d "$CLONE_DIR/.git" ]; then
  git -C "$CLONE_DIR" fetch --quiet origin main \
    && git -C "$CLONE_DIR" checkout --quiet -B main origin/main || true
else
  rm -rf "$CLONE_DIR"
  if ! git clone --depth 1 --branch main --quiet "$DOTFILES_REPO" "$CLONE_DIR"; then
    echo "environment sync: clone failed; continuing without shared config" >&2
    exit 0
  fi
fi

bash "$CLONE_DIR/setup.sh"
touch "$MARKER"
SH

apply_one() {
  local repo="$1"
  echo ""
  echo "==> $repo"

  if [ ! -d "$repo/.git" ]; then
    echo "    Skipped: not a git repository"
    return 0
  fi

  (
    cd "$repo"

    mkdir -p .claude/hooks
    printf '%s\n' "$SETTINGS_CONTENT" > .claude/settings.json
    printf '%s\n' "$HOOK_CONTENT"     > .claude/hooks/session-start.sh

    # Keep .sh files LF on Windows checkouts.
    if [ ! -f .gitattributes ] || ! grep -q '\*\.sh text eol=lf' .gitattributes; then
      printf '*.sh text eol=lf\n' >> .gitattributes
      git add .gitattributes
    fi

    git add .claude/settings.json .claude/hooks/session-start.sh

    if git diff --cached --quiet; then
      echo "    No changes to commit."
      exit 0
    fi

    git commit -m "Add Claude Code remote-sync hook (from watapon-euco/Environment)"

    if [ "$DO_PUSH" -eq 1 ]; then
      if git remote get-url origin >/dev/null 2>&1; then
        local branch
        branch="$(git symbolic-ref --short HEAD)"
        echo "    Pushing $branch -> origin..."
        git push origin "$branch"
      else
        echo "    No 'origin' remote — commit done, push skipped."
      fi
    else
      echo "    Commit done. Push skipped (--no-push)."
    fi
  )
}

for t in "${TARGETS[@]}"; do
  if [ -d "$t" ]; then
    apply_one "$(cd "$t" && pwd)"
  else
    echo "==> $t"
    echo "    Skipped: directory does not exist"
  fi
done

echo ""
echo "Done."
