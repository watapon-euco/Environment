'use strict';

// Tests for hooks/context-guard.js
//
// Run with: node --test tests/
//
// Strategy: spawn the script as a real child process (spawnSync) so we
// exercise it exactly as Claude Code would (stdin JSON in, stdout JSON out,
// exit code). Every test gets its own freshly-created temp directory that is
// injected via TEMP/TMP/TMPDIR so the script's `os.tmpdir()` call never
// touches the real system temp dir, and each test cleans its directory up
// afterwards.

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'dotfiles', 'hooks', 'context-guard.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir() {
  // Uses the REAL os.tmpdir() just to find a place to create our fake one.
  return fs.mkdtempSync(path.join(os.tmpdir(), 'context-guard-test-'));
}

function cleanupTmpDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function buildEnv(tmpDir, overrides) {
  const env = { ...process.env };
  // Force the child's os.tmpdir() to resolve to our fake dir on every platform.
  env.TEMP = tmpDir;
  env.TMP = tmpDir;
  env.TMPDIR = tmpDir;
  // Make sure no ambient config from the real environment leaks into a test.
  delete env.CONTEXT_GUARD_WINDOW;
  delete env.CONTEXT_GUARD_PCT;
  delete env.CONTEXT_GUARD_STEP;
  delete env.CLAUDE_CODE_DISABLE_1M_CONTEXT;
  Object.assign(env, overrides);
  return env;
}

function runHook(mode, input, tmpDir, envOverrides) {
  const result = spawnSync(process.execPath, [SCRIPT, mode], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: buildEnv(tmpDir, envOverrides || {}),
  });
  return result;
}

function baseDir(tmpDir) {
  return path.join(tmpDir, 'claude-handoff');
}

function stateFilePath(tmpDir, sid) {
  return path.join(baseDir(tmpDir), `${sid}.state.json`);
}

function notesFilePath(tmpDir, sid) {
  return path.join(baseDir(tmpDir), `${sid}.md`);
}

// Builds a usage object that sums to `total` tokens. When `split` is true,
// the total is spread across all four counted fields (to exercise the sum
// logic); otherwise it's placed entirely on input_tokens.
function usageFor(total, split) {
  if (!split) {
    return {
      input_tokens: total,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 0,
    };
  }
  const quarter = Math.floor(total / 4);
  const remainder = total - quarter * 4;
  return {
    input_tokens: quarter + remainder,
    cache_creation_input_tokens: quarter,
    cache_read_input_tokens: quarter,
    output_tokens: quarter,
  };
}

function assistantLine({ model = 'claude-sonnet-4-5-20250929', usage, isSidechain = false }) {
  return {
    type: 'assistant',
    isSidechain,
    message: { model, usage },
  };
}

function writeTranscript(tmpDir, lines, filename) {
  const p = path.join(tmpDir, filename || 'transcript.jsonl');
  const content = lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
  fs.writeFileSync(p, content, 'utf8');
  return p;
}

function stopInput({ sid, transcriptPath, stopHookActive = false }) {
  return {
    session_id: sid,
    transcript_path: transcriptPath,
    stop_hook_active: stopHookActive,
    hook_event_name: 'Stop',
  };
}

// ---------------------------------------------------------------------------
// 1. Threshold crossing, dedup per level, reset below threshold, re-arm
// ---------------------------------------------------------------------------

test('stop: threshold crossing, same-level dedup, reset below threshold, re-arm', (t) => {
  const tmpDir = makeTmpDir();
  t.after(() => cleanupTmpDir(tmpDir));
  const sid = 'sess-thresholds';

  function fireAt(pct, split) {
    const transcriptPath = writeTranscript(tmpDir, [
      assistantLine({ usage: usageFor(pct * 10000, split) }), // pct% of 1,000,000
    ]);
    return runHook('stop', stopInput({ sid, transcriptPath }), tmpDir);
  }

  // 59% -> below default 60% threshold -> silent.
  let r = fireAt(59);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');

  // 61% -> crosses threshold -> fires. Also validates usage is summed across
  // all four token fields (split=true).
  r = fireAt(61, true);
  assert.equal(r.status, 0);
  assert.notEqual(r.stdout, '');
  let payload = JSON.parse(r.stdout);
  assert.equal(payload.hookSpecificOutput.hookEventName, 'Stop');
  assert.ok(typeof payload.systemMessage === 'string' && payload.systemMessage.length > 0);
  assert.ok(payload.hookSpecificOutput.additionalContext.includes(notesFilePath(tmpDir, sid)));
  assert.ok(fs.existsSync(stateFilePath(tmpDir, sid)));

  // Same 61% again -> same level already recorded -> silent.
  r = fireAt(61, true);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');

  // 71% -> next 10-point level -> fires again.
  r = fireAt(71);
  assert.equal(r.status, 0);
  assert.notEqual(r.stdout, '');
  payload = JSON.parse(r.stdout);
  assert.equal(payload.hookSpecificOutput.hookEventName, 'Stop');

  // 30% -> below threshold -> silent, and state file removed.
  r = fireAt(30);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.equal(fs.existsSync(stateFilePath(tmpDir, sid)), false);

  // 61% again -> re-armed since state was cleared -> fires again.
  r = fireAt(61);
  assert.equal(r.status, 0);
  assert.notEqual(r.stdout, '');
  payload = JSON.parse(r.stdout);
  assert.equal(payload.hookSpecificOutput.hookEventName, 'Stop');
});

// ---------------------------------------------------------------------------
// 2. Model-dependent context window (haiku vs opus)
// ---------------------------------------------------------------------------

test('stop: haiku model uses 200k window and fires; same usage on opus is silent', (t) => {
  const tmpDirHaiku = makeTmpDir();
  const tmpDirOpus = makeTmpDir();
  t.after(() => {
    cleanupTmpDir(tmpDirHaiku);
    cleanupTmpDir(tmpDirOpus);
  });

  // 130,000 tokens is 65% of a 200,000 window -> fires.
  const haikuTranscript = writeTranscript(tmpDirHaiku, [
    assistantLine({ model: 'claude-3-5-haiku-20241022', usage: usageFor(130000) }),
  ]);
  const rHaiku = runHook('stop', stopInput({ sid: 'sess-haiku', transcriptPath: haikuTranscript }), tmpDirHaiku);
  assert.equal(rHaiku.status, 0);
  assert.notEqual(rHaiku.stdout, '');
  const payload = JSON.parse(rHaiku.stdout);
  assert.equal(payload.hookSpecificOutput.hookEventName, 'Stop');

  // Same 130,000 tokens is only 13% of a 1,000,000 window on a non-haiku model -> silent.
  const opusTranscript = writeTranscript(tmpDirOpus, [
    assistantLine({ model: 'claude-opus-4-1-20250805', usage: usageFor(130000) }),
  ]);
  const rOpus = runHook('stop', stopInput({ sid: 'sess-opus', transcriptPath: opusTranscript }), tmpDirOpus);
  assert.equal(rOpus.status, 0);
  assert.equal(rOpus.stdout, '');
});

// ---------------------------------------------------------------------------
// 3. Sidechain and synthetic-model lines are ignored
// ---------------------------------------------------------------------------

test('stop: trailing sidechain assistant message is ignored in favor of earlier main message', (t) => {
  const tmpDir = makeTmpDir();
  t.after(() => cleanupTmpDir(tmpDir));

  const transcriptPath = writeTranscript(tmpDir, [
    assistantLine({ usage: usageFor(100000) }), // 10%, main line
    assistantLine({ usage: usageFor(900000), isSidechain: true }), // 90%, but sidechain
  ]);
  const r = runHook('stop', stopInput({ sid: 'sess-sidechain', transcriptPath }), tmpDir);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('stop: trailing <synthetic>-model assistant message is ignored in favor of earlier main message', (t) => {
  const tmpDir = makeTmpDir();
  t.after(() => cleanupTmpDir(tmpDir));

  const transcriptPath = writeTranscript(tmpDir, [
    assistantLine({ usage: usageFor(100000) }), // 10%, main line
    assistantLine({ model: '<synthetic>', usage: usageFor(900000) }), // 90%, but synthetic
  ]);
  const r = runHook('stop', stopInput({ sid: 'sess-synthetic', transcriptPath }), tmpDir);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

// ---------------------------------------------------------------------------
// 4. stop_hook_active suppresses everything
// ---------------------------------------------------------------------------

test('stop: stop_hook_active true suppresses output even at 90%', (t) => {
  const tmpDir = makeTmpDir();
  t.after(() => cleanupTmpDir(tmpDir));

  const transcriptPath = writeTranscript(tmpDir, [assistantLine({ usage: usageFor(900000) })]);
  const r = runHook('stop', stopInput({ sid: 'sess-active', transcriptPath, stopHookActive: true }), tmpDir);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

// ---------------------------------------------------------------------------
// 5. Robustness: never break the session
// ---------------------------------------------------------------------------

test('stop: invalid JSON on stdin exits 0 with no output', (t) => {
  const tmpDir = makeTmpDir();
  t.after(() => cleanupTmpDir(tmpDir));

  const r = spawnSync(process.execPath, [SCRIPT, 'stop'], {
    input: '{ this is not json',
    encoding: 'utf8',
    env: buildEnv(tmpDir, {}),
  });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('stop: missing transcript file exits 0 with no output', (t) => {
  const tmpDir = makeTmpDir();
  t.after(() => cleanupTmpDir(tmpDir));

  const missingPath = path.join(tmpDir, 'does-not-exist.jsonl');
  const r = runHook('stop', stopInput({ sid: 'sess-missing', transcriptPath: missingPath }), tmpDir);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('stop: transcript full of garbage lines exits 0 with no output', (t) => {
  const tmpDir = makeTmpDir();
  t.after(() => cleanupTmpDir(tmpDir));

  const transcriptPath = path.join(tmpDir, 'garbage.jsonl');
  fs.writeFileSync(
    transcriptPath,
    ['not json', '{"broken":', '', 'plain text line', '{"type":"user"}'].join('\n') + '\n',
    'utf8'
  );
  const r = runHook('stop', stopInput({ sid: 'sess-garbage', transcriptPath }), tmpDir);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('stop: empty session_id exits 0 with no output', (t) => {
  const tmpDir = makeTmpDir();
  t.after(() => cleanupTmpDir(tmpDir));

  const transcriptPath = writeTranscript(tmpDir, [assistantLine({ usage: usageFor(900000) })]);
  const r = runHook('stop', stopInput({ sid: '', transcriptPath }), tmpDir);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

// ---------------------------------------------------------------------------
// 6. Large transcript (> 1 MiB) exercises the tail-read path
// ---------------------------------------------------------------------------

test('stop: relevant assistant line near the end of a >1MiB transcript is found via tail read', (t) => {
  const tmpDir = makeTmpDir();
  t.after(() => cleanupTmpDir(tmpDir));

  const transcriptPath = path.join(tmpDir, 'large.jsonl');
  const paddingLine = 'x'.repeat(600); // plain, non-JSON text; not a candidate match
  const paddingLines = new Array(2000).fill(paddingLine).join('\n') + '\n';
  const finalLine = JSON.stringify(assistantLine({ usage: usageFor(610000) })) + '\n'; // 61%
  fs.writeFileSync(transcriptPath, paddingLines + finalLine, 'utf8');

  const size = fs.statSync(transcriptPath).size;
  assert.ok(size > 1024 * 1024, `expected test fixture to exceed 1 MiB, got ${size} bytes`);

  const r = runHook('stop', stopInput({ sid: 'sess-large', transcriptPath }), tmpDir);
  assert.equal(r.status, 0);
  assert.notEqual(r.stdout, '');
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.hookSpecificOutput.hookEventName, 'Stop');
});

// ---------------------------------------------------------------------------
// 7. Compact mode
// ---------------------------------------------------------------------------

test('compact: no notes file is silent', (t) => {
  const tmpDir = makeTmpDir();
  t.after(() => cleanupTmpDir(tmpDir));

  const r = runHook('compact', { session_id: 'sess-nonotes' }, tmpDir);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('compact: notes file present is injected as SessionStart context', (t) => {
  const tmpDir = makeTmpDir();
  t.after(() => cleanupTmpDir(tmpDir));
  const sid = 'sess-withnotes';

  fs.mkdirSync(baseDir(tmpDir), { recursive: true });
  fs.writeFileSync(notesFilePath(tmpDir, sid), '## Progress\nDid the thing. Next: do the other thing.', 'utf8');

  const r = runHook('compact', { session_id: sid }, tmpDir);
  assert.equal(r.status, 0);
  assert.notEqual(r.stdout, '');
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.ok(payload.hookSpecificOutput.additionalContext.includes('Did the thing. Next: do the other thing.'));
});

test('compact: notes file belonging to a different session is not injected', (t) => {
  const tmpDir = makeTmpDir();
  t.after(() => cleanupTmpDir(tmpDir));

  fs.mkdirSync(baseDir(tmpDir), { recursive: true });
  fs.writeFileSync(notesFilePath(tmpDir, 'sess-other'), 'notes belonging to a different session', 'utf8');

  const r = runHook('compact', { session_id: 'sess-mine' }, tmpDir);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

// ---------------------------------------------------------------------------
// 8. CONTEXT_GUARD_PCT override
// ---------------------------------------------------------------------------

test('stop: CONTEXT_GUARD_PCT=70 raises the threshold', (t) => {
  const tmpDir = makeTmpDir();
  t.after(() => cleanupTmpDir(tmpDir));

  // 65% is below the overridden 70% threshold -> silent.
  const belowPath = writeTranscript(tmpDir, [assistantLine({ usage: usageFor(650000) })], 'below.jsonl');
  let r = runHook('stop', stopInput({ sid: 'sess-pctoverride', transcriptPath: belowPath }), tmpDir, {
    CONTEXT_GUARD_PCT: '70',
  });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');

  // 72% crosses the overridden 70% threshold -> fires.
  const abovePath = writeTranscript(tmpDir, [assistantLine({ usage: usageFor(720000) })], 'above.jsonl');
  r = runHook('stop', stopInput({ sid: 'sess-pctoverride', transcriptPath: abovePath }), tmpDir, {
    CONTEXT_GUARD_PCT: '70',
  });
  assert.equal(r.status, 0);
  assert.notEqual(r.stdout, '');
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.hookSpecificOutput.hookEventName, 'Stop');
});
