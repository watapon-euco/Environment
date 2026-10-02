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

# Skills are loaded only when invoked, so long checklists live here instead of
# CLAUDE.md. Each skill is a folder; copy it whole (SKILL.md plus helpers).
# Only skills that exist in dotfiles/ are touched; other skills in
# ~/.claude/skills/ (plugins, synced) are left alone.
if [ -d "${SRC}/skills" ]; then
  mkdir -p "${DST}/skills"
  for d in "${SRC}/skills"/*/; do
    [ -d "${d}" ] || continue
    name="$(basename "${d}")"
    mkdir -p "${DST}/skills/${name}"
    cp -rf "${d}." "${DST}/skills/${name}/"
  done
  echo "Synced  ${DST}/skills/  ($(ls "${SRC}/skills" | wc -l) skills)"
fi

# Merge settings.json with Node (needed for the hooks anyway; jq isn't on
# Windows). Cloud sessions run context-guard from each repo's
# .claude/settings.json (see apply-to-existing.sh), so it is registered at
# user level only on local machines.
SETTINGS="${DST}/settings.json"
node - "${SETTINGS}" "${CLAUDE_CODE_REMOTE:-}" <<'JS'
const fs = require('fs');
const [file, remote] = process.argv.slice(2);
const s = fs.existsSync(file)
  ? JSON.parse(fs.readFileSync(file, 'utf8'))
  : { $schema: 'https://json.schemastore.org/claude-code-settings.json' };

// Keys that earlier versions of this script set.
if (s.env) {
  delete s.env.AUTOCOMPACT_PCT_OVERRIDE;
  delete s.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE;
  if (Object.keys(s.env).length === 0) delete s.env;
}
delete s.language;

const guard = (mode) => `node "$HOME/.claude/hooks/context-guard.js" ${mode}`;
const isGuard = (group) =>
  (group.hooks || []).some((h) => String(h.command || '').includes('context-guard.js'));
const wanted = {
  Stop: { hooks: [{ type: 'command', command: guard('stop') }] },
  SessionStart: { matcher: 'compact', hooks: [{ type: 'command', command: guard('compact') }] },
};
s.hooks = s.hooks || {};
for (const [event, group] of Object.entries(wanted)) {
  const kept = (s.hooks[event] || []).filter((g) => !isGuard(g));
  s.hooks[event] = remote === 'true' ? kept : [...kept, group];
  if (s.hooks[event].length === 0) delete s.hooks[event];
}
if (Object.keys(s.hooks).length === 0) delete s.hooks;

fs.writeFileSync(file, JSON.stringify(s, null, 2) + '\n');
JS
echo "Updated ${SETTINGS}"

echo "Done."
