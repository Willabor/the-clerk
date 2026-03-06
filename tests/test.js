#!/usr/bin/env node
/**
 * The Clerk — Tests
 * Basic tests to verify hook scripts work correctly.
 * No test framework needed — uses Node.js assert.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const SCRIPTS_DIR = path.join(__dirname, '..', 'scripts');
const TEST_DIR = path.join(os.tmpdir(), 'clerk-test-' + Date.now());
const CLERK_DIR = path.join(TEST_DIR, '.claude', 'clerk');
const LOG_FILE = path.join(CLERK_DIR, 'observations.jsonl');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err.message}`);
    failed++;
  }
}

function runHook(script, input) {
  const inputJson = JSON.stringify(input);
  const result = spawnSync('node', [path.join(SCRIPTS_DIR, script)], {
    input: inputJson,
    cwd: TEST_DIR,
    timeout: 10000,
    encoding: 'utf-8'
  });
  if (result.stdout && result.stdout.trim()) {
    try { return JSON.parse(result.stdout.trim()); } catch {}
  }
  return null;
}

function getRecords() {
  if (!fs.existsSync(LOG_FILE)) return [];
  return fs.readFileSync(LOG_FILE, 'utf-8')
    .trim()
    .split('\n')
    .filter(l => l.trim())
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

// Setup
console.log('');
console.log('  The Clerk — Test Suite');
console.log('  =====================');
console.log(`  Test dir: ${TEST_DIR}`);
console.log('');

fs.mkdirSync(TEST_DIR, { recursive: true });

// Verify scripts exist
test('All 4 scripts exist', () => {
  const scripts = ['session-start.js', 'capture.js', 'user-prompt.js', 'session-end.js'];
  for (const s of scripts) {
    assert.ok(fs.existsSync(path.join(SCRIPTS_DIR, s)), `Missing: ${s}`);
  }
});

// Test session-start
test('SessionStart creates clerk directory and log file', () => {
  const result = runHook('session-start.js', { session_id: 'test-1', cwd: TEST_DIR });
  assert.ok(result, 'Hook returned no output');
  assert.strictEqual(result.continue, true);
  assert.ok(fs.existsSync(CLERK_DIR), 'Clerk directory not created');
  assert.ok(fs.existsSync(LOG_FILE), 'Log file not created');
});

test('SessionStart writes session_start record', () => {
  const records = getRecords();
  const starts = records.filter(r => r.type === 'session_start');
  assert.ok(starts.length > 0, 'No session_start record found');
  assert.strictEqual(starts[0].session, 'test-1');
});

test('SessionStart returns additionalContext', () => {
  const result = runHook('session-start.js', { session_id: 'test-2', cwd: TEST_DIR });
  assert.ok(result.hookSpecificOutput, 'No hookSpecificOutput');
  assert.ok(result.hookSpecificOutput.additionalContext, 'No additionalContext');
  assert.ok(result.hookSpecificOutput.additionalContext.includes('[CLERK] Online'), 'Missing [CLERK] Online status');
});

// Test capture
test('Capture records observation for Bash tool', () => {
  const beforeCount = getRecords().length;
  runHook('capture.js', {
    session_id: 'test-1',
    cwd: TEST_DIR,
    tool_name: 'Bash',
    tool_input: { command: 'echo hello world' },
    tool_response: 'hello world'
  });
  const records = getRecords();
  assert.strictEqual(records.length, beforeCount + 1, 'No new record added');
  const obs = records[records.length - 1];
  assert.strictEqual(obs.type, 'observation');
  assert.strictEqual(obs.tool, 'Bash');
  assert.ok(obs.summary.includes('cmd: echo hello world'), `Unexpected summary: ${obs.summary}`);
});

test('Capture records observation for Edit tool', () => {
  runHook('capture.js', {
    session_id: 'test-1',
    cwd: TEST_DIR,
    tool_name: 'Edit',
    tool_input: { file_path: '/tmp/test.js', old_string: 'const x = 1', new_string: 'const x = 2' },
    tool_response: 'success'
  });
  const records = getRecords();
  const obs = records[records.length - 1];
  assert.strictEqual(obs.tool, 'Edit');
  assert.ok(obs.summary.includes('edit:'), `Unexpected summary: ${obs.summary}`);
  assert.ok(obs.files.includes('/tmp/test.js'), 'File path not extracted');
});

test('Capture skips meta tools (TodoRead)', () => {
  const beforeCount = getRecords().length;
  runHook('capture.js', {
    session_id: 'test-1',
    cwd: TEST_DIR,
    tool_name: 'TodoRead',
    tool_input: {},
    tool_response: '{}'
  });
  assert.strictEqual(getRecords().length, beforeCount, 'Meta tool was not skipped');
});

test('Capture truncates response to 300 chars', () => {
  const longResponse = 'x'.repeat(1000);
  runHook('capture.js', {
    session_id: 'test-1',
    cwd: TEST_DIR,
    tool_name: 'Bash',
    tool_input: { command: 'cat big-file' },
    tool_response: longResponse
  });
  const records = getRecords();
  const obs = records[records.length - 1];
  assert.ok(obs.response_preview.length <= 300, `Response not truncated: ${obs.response_preview.length} chars`);
});

// Test user-prompt
test('UserPrompt records user message', () => {
  runHook('user-prompt.js', {
    session_id: 'test-1',
    cwd: TEST_DIR,
    prompt: 'fix the login bug on the dashboard'
  });
  const records = getRecords();
  const prompts = records.filter(r => r.type === 'user_prompt');
  assert.ok(prompts.length > 0, 'No user_prompt record found');
  assert.ok(prompts[prompts.length - 1].message.includes('fix the login bug'), 'Message not recorded');
});

test('UserPrompt truncates to 500 chars', () => {
  const longMessage = 'a'.repeat(1000);
  runHook('user-prompt.js', {
    session_id: 'test-1',
    cwd: TEST_DIR,
    prompt: longMessage
  });
  const records = getRecords();
  const prompt = records[records.length - 1];
  assert.ok(prompt.message.length <= 500, `Message not truncated: ${prompt.message.length} chars`);
});

// Test session-end
test('SessionEnd writes session_end record', () => {
  runHook('session-end.js', {
    session_id: 'test-1',
    cwd: TEST_DIR
  });
  const records = getRecords();
  const ends = records.filter(r => r.type === 'session_end');
  assert.ok(ends.length > 0, 'No session_end record found');
});

// Test DISABLED flag
test('DISABLED file prevents recording', () => {
  fs.writeFileSync(path.join(CLERK_DIR, 'DISABLED'), '');
  const beforeCount = getRecords().length;
  runHook('capture.js', {
    session_id: 'test-1',
    cwd: TEST_DIR,
    tool_name: 'Bash',
    tool_input: { command: 'echo disabled' },
    tool_response: 'disabled'
  });
  assert.strictEqual(getRecords().length, beforeCount, 'Recording was not disabled');
  fs.unlinkSync(path.join(CLERK_DIR, 'DISABLED'));
});

// Test all hooks return continue: true
test('All hooks always return continue: true', () => {
  const hooks = ['session-start.js', 'capture.js', 'user-prompt.js', 'session-end.js'];
  for (const hook of hooks) {
    const result = runHook(hook, {
      session_id: 'test-continue',
      cwd: TEST_DIR,
      tool_name: 'Bash',
      tool_input: { command: 'test' },
      tool_response: 'ok',
      prompt: 'test'
    });
    assert.ok(result, `${hook} returned no output`);
    assert.strictEqual(result.continue, true, `${hook} did not return continue: true`);
  }
});

// Cleanup
fs.rmSync(TEST_DIR, { recursive: true, force: true });

// Results
console.log('');
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('');

if (failed > 0) {
  process.exit(1);
}
