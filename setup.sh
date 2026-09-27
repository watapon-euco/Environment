#!/usr/bin/env bash
# Mirror dotfiles/ into ~/.claude/ so the configs apply to all Claude Code
# sessions for this user. Idempotent — safe to re-run.
#
# Usage:
#   bash setup.sh

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="${REPO_DIR}/dotfiles"
DST="${HOME}/.claude"

if [ ! -d "${SRC}" ]; then
  echo "Error: ${SRC} not found" >&2
  exit 1
fi

mkdir -p "${DST}/agents"

cp -f "${SRC}/CLAUDE.md" "${DST}/CLAUDE.md"
echo "Synced  ${DST}/CLAUDE.md"

for f in "${SRC}/agents"/*.md; do
  cp -f "${f}" "${DST}/agents/$(basename "${f}")"
done
echo "Synced  ${DST}/agents/  ($(ls "${SRC}/agents" | wc -l) agents)"

mkdir -p "${DST}/hooks"
for f in "${SRC}/hooks"/*.js; do
  cp -f "${f}" "${DST}/hooks/$(basename "${f}")"
done
echo "Synced  ${DST}/hooks/  ($(ls "${SRC}/hooks" | wc -l) hooks)"

SETTINGS="${DST}/settings.json"
if [ -f "${SETTINGS}" ]; then
  if command -v jq >/dev/null 2>&1; then
    tmp="$(mktemp)"
    # AUTOCOMPACT_PCT_OVERRIDE (no CLAUDE_ prefix) was never a recognized name.
    # Compaction now goes back to Claude Code's default; context-guard replaces it.
    jq '
      def dropGuard(arr):
        (arr // []) | map(select(((.hooks // []) | any(.command // "" | contains("context-guard.js"))) | not));

      .env = ((.env // {}) | del(.AUTOCOMPACT_PCT_OVERRIDE) | del(.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE))
      | if (.env | length) == 0 then del(.env) else . end
      | .language = "japanese"
      | .hooks.Stop = (dropGuard(.hooks.Stop) + [{"hooks":[{"type":"command","command":"node \"$HOME/.claude/hooks/context-guard.js\" stop"}]}])
      | .hooks.SessionStart = (dropGuard(.hooks.SessionStart) + [{"matcher":"compact","hooks":[{"type":"command","command":"node \"$HOME/.claude/hooks/context-guard.js\" compact"}]}])
    ' "${SETTINGS}" > "${tmp}" && mv "${tmp}" "${SETTINGS}"
    echo "Merged  language=japanese and context-guard hooks (Stop, SessionStart) into ${SETTINGS}"
  else
    echo "Warn:   jq not found; manually ensure ${SETTINGS} contains:"
    echo "        \"language\": \"japanese\","
    echo "        no *AUTOCOMPACT_PCT_OVERRIDE entry under \"env\" (delete it if present), and:"
    echo '        "hooks": {'
    echo '          "Stop": [{"hooks":[{"type":"command","command":"node \"$HOME/.claude/hooks/context-guard.js\" stop"}]}],'
    echo '          "SessionStart": [{"matcher":"compact","hooks":[{"type":"command","command":"node \"$HOME/.claude/hooks/context-guard.js\" compact"}]}]'
    echo '        }'
  fi
else
  cat > "${SETTINGS}" <<'JSON'
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "language": "japanese",
  "hooks": {
    "Stop": [
      { "hooks": [ { "type": "command", "command": "node \"$HOME/.claude/hooks/context-guard.js\" stop" } ] }
    ],
    "SessionStart": [
      { "matcher": "compact", "hooks": [ { "type": "command", "command": "node \"$HOME/.claude/hooks/context-guard.js\" compact" } ] }
    ]
  }
}
JSON
  echo "Created ${SETTINGS}"
fi

echo "Done."
