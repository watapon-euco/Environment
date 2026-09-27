#!/usr/bin/env node
// context-guard.js — Claude Code hook that watches context-window usage from
// the transcript tail and prompts a checkpoint before auto-compaction summarizes
// the conversation away. Registered twice:
//   Stop hook:        node context-guard.js stop
//   SessionStart hook (matcher "compact"): node context-guard.js compact
// Hook input JSON is read from stdin in both modes. This script must never
// break a session: any error results in exit 0 with no stdout.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function getIntEnv(name) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return undefined;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function readStdinJSON() {
  const raw = fs.readFileSync(0, 'utf8');
  return JSON.parse(raw);
}

function sanitizeSessionId(sessionId) {
  return String(sessionId || '').replace(/[^A-Za-z0-9_-]/g, '');
}

function readTail(filePath, maxBytes) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const start = size > maxBytes ? size - maxBytes : 0;
    const length = size - start;
    const buf = Buffer.alloc(length);
    fs.readSync(fd, buf, 0, length, start);
    let text = buf.toString('utf8');
    if (start > 0) {
      const nl = text.indexOf('\n');
      text = nl === -1 ? '' : text.slice(nl + 1);
    }
    return text;
  } finally {
    fs.closeSync(fd);
  }
}

function findLastUsageEntry(transcriptPath) {
  const text = readTail(transcriptPath, 1024 * 1024);
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (
      obj &&
      obj.type === 'assistant' &&
      !obj.isSidechain &&
      obj.message &&
      obj.message.usage &&
      obj.message.model !== '<synthetic>'
    ) {
      return obj;
    }
  }
  return null;
}

function readState(stateFile) {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    return typeof parsed.level === 'number' ? parsed.level : -Infinity;
  } catch {
    return -Infinity;
  }
}

function formatLocal(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function runStop(input, base) {
  if (input.stop_hook_active === true) return null;

  const sid = sanitizeSessionId(input.session_id);
  if (!sid) return null;

  const entry = findLastUsageEntry(input.transcript_path);
  if (!entry) return null;

  const usage = entry.message.usage;
  const used =
    (usage.input_tokens || 0) +
    (usage.cache_creation_input_tokens || 0) +
    (usage.cache_read_input_tokens || 0) +
    (usage.output_tokens || 0);

  const model = entry.message.model || '';
  const windowOverride = getIntEnv('CONTEXT_GUARD_WINDOW');
  const window =
    windowOverride ||
    (process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT === '1' || /haiku/i.test(model) ? 200000 : 1000000);
  const pct = (used / window) * 100;

  const PCT = clamp(getIntEnv('CONTEXT_GUARD_PCT') ?? 60, 1, 99);
  const STEP = Math.max(1, getIntEnv('CONTEXT_GUARD_STEP') ?? 10);

  const stateFile = path.join(base, `${sid}.state.json`);

  if (pct < PCT) {
    if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
    return null;
  }

  const level = PCT + Math.floor((pct - PCT) / STEP) * STEP;
  if (readState(stateFile) >= level) return null;

  fs.mkdirSync(base, { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify({ level }));

  const notesPath = path.join(base, `${sid}.md`);
  const roundedPct = Math.round(pct);
  const message = `[context-guard] Context is at ${roundedPct}% (${used} of ${window} tokens). Auto-compaction will later summarize this conversation, so checkpoint now, then continue where you left off:
1. Durable project knowledge not yet recorded (decisions and their reasons, conventions, gotchas, commands, specs): write it where it belongs in this project, either its repository files (e.g. CLAUDE.md, README, docs) or this project's auto memory. Your call. Don't commit just for this.
2. Transient progress (current goal, what's done, what's next, open questions, key file paths): overwrite ${notesPath}. It is re-injected automatically after compaction.
Keep both brief, confirm in one line, and resume the task.`;

  return {
    systemMessage: `コンテキスト ${roundedPct}%：チェックポイントを保存します`,
    hookSpecificOutput: {
      hookEventName: 'Stop',
      additionalContext: message,
    },
  };
}

function runCompact(input, base) {
  const sid = sanitizeSessionId(input.session_id);
  if (!sid) return null;

  const notesPath = path.join(base, `${sid}.md`);
  if (!fs.existsSync(notesPath)) return null;

  const stat = fs.statSync(notesPath);
  if (stat.size === 0) return null;

  let content = fs.readFileSync(notesPath, 'utf8');
  if (content.length > 20000) {
    content = content.slice(0, 20000) + '\n[context-guard] (truncated)';
  }

  const mtime = formatLocal(stat.mtime);
  const message = `[context-guard] The conversation was just compacted. Progress notes you saved before compaction (${notesPath}, last updated ${mtime}):\n\n${content}`;

  return {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: message,
    },
  };
}

try {
  const mode = process.argv[2];
  const input = readStdinJSON();
  const base = path.join(os.tmpdir(), 'claude-handoff');

  let output = null;
  if (mode === 'stop') output = runStop(input, base);
  else if (mode === 'compact') output = runCompact(input, base);

  if (output) process.stdout.write(JSON.stringify(output));
} catch {
  // Never break a session — swallow all errors, no output.
}
