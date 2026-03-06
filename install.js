#!/usr/bin/env node
/**
 * The Clerk — Installer
 * Copies hook scripts to ~/.claude/clerk/scripts/ and registers hooks in settings.json
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const CLERK_DIR = path.join(os.homedir(), '.claude', 'clerk', 'scripts');
const SETTINGS_FILE = path.join(os.homedir(), '.claude', 'settings.json');
const SCRIPTS = ['session-start.js', 'capture.js', 'user-prompt.js', 'session-end.js'];
const SRC_DIR = path.join(__dirname, 'scripts');

function getHooksConfig() {
  // Use forward slashes for cross-platform compatibility
  const scriptsPath = CLERK_DIR.replace(/\\/g, '/');
  return {
    SessionStart: [{
      matcher: '',
      hooks: [{
        type: 'command',
        command: `node ${scriptsPath}/session-start.js`,
        timeout: 15000
      }]
    }],
    UserPromptSubmit: [{
      matcher: '',
      hooks: [{
        type: 'command',
        command: `node ${scriptsPath}/user-prompt.js`,
        timeout: 5000
      }]
    }],
    PostToolUse: [{
      matcher: '',
      hooks: [{
        type: 'command',
        command: `node ${scriptsPath}/capture.js`,
        timeout: 5000
      }]
    }],
    Stop: [{
      matcher: '',
      hooks: [{
        type: 'command',
        command: `node ${scriptsPath}/session-end.js`,
        timeout: 10000
      }]
    }]
  };
}

function install() {
  console.log('');
  console.log('  The Clerk — Installing...');
  console.log('  ========================');
  console.log('');

  // 1. Create scripts directory
  fs.mkdirSync(CLERK_DIR, { recursive: true });
  console.log(`  [1/3] Created ${CLERK_DIR}`);

  // 2. Copy scripts
  let copied = 0;
  for (const script of SCRIPTS) {
    const src = path.join(SRC_DIR, script);
    const dest = path.join(CLERK_DIR, script);
    if (!fs.existsSync(src)) {
      console.log(`  WARNING: ${script} not found in ${SRC_DIR}`);
      continue;
    }
    fs.copyFileSync(src, dest);
    copied++;
  }
  console.log(`  [2/3] Copied ${copied} scripts`);

  // 3. Update settings.json
  let settings = {};
  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
    } catch {
      console.log('  WARNING: Could not parse existing settings.json — creating new one');
      settings = {};
    }
  }

  // Check if hooks already exist
  if (settings.hooks) {
    const hasClerk = JSON.stringify(settings.hooks).includes('clerk/scripts/');
    if (hasClerk) {
      console.log('  [3/3] Hooks already registered in settings.json — updating scripts only');
    } else {
      // Merge hooks — don't overwrite existing hooks from other tools
      const newHooks = getHooksConfig();
      for (const [event, handlers] of Object.entries(newHooks)) {
        if (!settings.hooks[event]) {
          settings.hooks[event] = handlers;
        } else {
          // Append to existing handlers for this event
          settings.hooks[event].push(...handlers);
        }
      }
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
      console.log('  [3/3] Registered hooks in settings.json (merged with existing)');
    }
  } else {
    settings.hooks = getHooksConfig();
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    console.log('  [3/3] Registered hooks in settings.json');
  }

  console.log('');
  console.log('  Installation complete!');
  console.log('');
  console.log('  The Clerk will activate on your next Claude Code session.');
  console.log('  You will see "[CLERK] Online" at the start of each session.');
  console.log('');
  console.log('  Session data is stored per-project at:');
  console.log('    {project}/.claude/clerk/observations.jsonl');
  console.log('');
  console.log('  To disable per-project:  touch .claude/clerk/DISABLED');
  console.log('  To disable temporarily:  CLERK_OFF=1 claude');
  console.log('  To uninstall:            node uninstall.js');
  console.log('');
}

try {
  install();
} catch (err) {
  console.error('  Installation failed:', err.message);
  process.exit(1);
}
