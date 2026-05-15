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

SETTINGS="${DST}/settings.json"
if [ -f "${SETTINGS}" ]; then
  if command -v jq >/dev/null 2>&1; then
    tmp="$(mktemp)"
    jq '.env = (.env // {}) | .env.AUTOCOMPACT_PCT_OVERRIDE = "70"' "${SETTINGS}" > "${tmp}" && mv "${tmp}" "${SETTINGS}"
    echo "Merged  AUTOCOMPACT_PCT_OVERRIDE=70 into ${SETTINGS}"
  else
    echo "Warn:   jq not found; manually ensure ${SETTINGS} contains:"
    echo "        \"env\": { \"AUTOCOMPACT_PCT_OVERRIDE\": \"70\" }"
  fi
else
  cat > "${SETTINGS}" <<'JSON'
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "env": {
    "AUTOCOMPACT_PCT_OVERRIDE": "70"
  }
}
JSON
  echo "Created ${SETTINGS}"
fi

echo "Done."
