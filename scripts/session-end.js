#!/usr/bin/env node
/**
 * CLERK — Stop Hook
 * Fires when Claude finishes responding. Records session end marker.
 */

const fs = require('fs');
const path = require('path');

async function main() {
  try {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks).toString());

    const { session_id, cwd } = input;
    const clerkDir = path.join(cwd, '.claude', 'clerk');
    const logFile = path.join(clerkDir, 'observations.jsonl');

    // Check for DISABLED flag
    if (fs.existsSync(path.join(clerkDir, 'DISABLED'))) {
      process.stdout.write(JSON.stringify({ continue: true, suppressOutput: true }));
      process.exit(0);
    }

    // Check for CLERK_OFF env variable
    if (process.env.CLERK_OFF === '1') {
      process.stdout.write(JSON.stringify({ continue: true, suppressOutput: true }));
      process.exit(0);
    }

    // Only write if clerk dir exists (don't create it on Stop)
    if (fs.existsSync(clerkDir)) {
      const record = {
        type: 'session_end',
        ts: new Date().toISOString(),
        session: session_id
      };
      fs.appendFileSync(logFile, JSON.stringify(record) + '\n');
    }

    process.stdout.write(JSON.stringify({ continue: true, suppressOutput: true }));
  } catch {
    process.stdout.write(JSON.stringify({ continue: true, suppressOutput: true }));
  }
  process.exit(0);
}

main();
