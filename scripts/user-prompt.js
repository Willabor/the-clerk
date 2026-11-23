#!/usr/bin/env node
/**
 * CLERK — UserPromptSubmit Hook
 * Fires when the user submits a message. Records it to the log.
 * Never blocks, never interferes.
 */

const fs = require('fs');
const path = require('path');
const { redact } = require('./redact');

async function main() {
  try {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks).toString());

    const { session_id, cwd } = input;
    const clerkDir = path.join(cwd, '.claude', 'clerk');

    // Check for DISABLED flag or CLERK_OFF env
    if (fs.existsSync(path.join(clerkDir, 'DISABLED')) || process.env.CLERK_OFF === '1') {
      process.stdout.write(JSON.stringify({ continue: true, suppressOutput: true }));
      process.exit(0);
    }

    // Ensure clerk directory exists
    fs.mkdirSync(clerkDir, { recursive: true });

    // Extract user message — it comes in input.prompt or input.user_prompt
    const userMessage = input.prompt || input.user_prompt || input.content || '';

    // Full message, redacted. People paste credentials into chat — that is how a tunnel
    // token once reached a real Clerk log — so the prompt stream is
    // no safer than the command stream and gets the same treatment.
    const { text, redactions } = redact(userMessage);

    const record = {
      type: 'user_prompt',
      ts: new Date().toISOString(),
      session: session_id,
      message: text
    };
    if (redactions.length) record.redacted = [...new Set(redactions)];

    const logFile = path.join(clerkDir, 'observations.jsonl');
    if (!fs.existsSync(logFile)) fs.writeFileSync(logFile, '', { mode: 0o600 });
    fs.appendFileSync(logFile, JSON.stringify(record) + '\n');

    process.stdout.write(JSON.stringify({ continue: true, suppressOutput: true }));
  } catch {
    process.stdout.write(JSON.stringify({ continue: true, suppressOutput: true }));
  }
  process.exit(0);
}

main();
