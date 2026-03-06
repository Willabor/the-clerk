#!/usr/bin/env node
/**
 * The Clerk — Uninstaller
 * Removes hooks from settings.json and optionally deletes scripts.
 * Does NOT delete per-project observation data — that's yours to keep.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const CLERK_DIR = path.join(os.homedir(), '.claude', 'clerk');
const SETTINGS_FILE = path.join(os.homedir(), '.claude', 'settings.json');

function uninstall() {
  console.log('');
  console.log('  The Clerk — Uninstalling...');
  console.log('  ===========================');
  console.log('');

  // 1. Remove hooks from settings.json
  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
      if (settings.hooks) {
        let removed = 0;
        for (const event of Object.keys(settings.hooks)) {
          if (Array.isArray(settings.hooks[event])) {
            const before = settings.hooks[event].length;
            settings.hooks[event] = settings.hooks[event].filter(handler => {
              if (!handler.hooks) return true;
              handler.hooks = handler.hooks.filter(h => {
                return !h.command || !h.command.includes('clerk/scripts/');
              });
              return handler.hooks.length > 0;
            });
            const after = settings.hooks[event].length;
            if (after < before) removed += (before - after);
            if (settings.hooks[event].length === 0) {
              delete settings.hooks[event];
            }
          }
        }
        if (Object.keys(settings.hooks).length === 0) {
          delete settings.hooks;
        }
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
        console.log(`  [1/2] Removed ${removed} hook entries from settings.json`);
      } else {
        console.log('  [1/2] No hooks found in settings.json — skipping');
      }
    } catch (err) {
      console.log(`  [1/2] WARNING: Could not update settings.json: ${err.message}`);
    }
  } else {
    console.log('  [1/2] No settings.json found — skipping');
  }

  // 2. Remove scripts directory
  const scriptsDir = path.join(CLERK_DIR, 'scripts');
  if (fs.existsSync(scriptsDir)) {
    fs.rmSync(scriptsDir, { recursive: true });
    console.log('  [2/2] Removed scripts from ~/.claude/clerk/scripts/');
  } else {
    console.log('  [2/2] No scripts directory found — skipping');
  }

  // Clean up clerk dir if empty (but keep if it has other files like CLERK_GUIDE.md)
  try {
    const remaining = fs.readdirSync(CLERK_DIR);
    if (remaining.length === 0) {
      fs.rmdirSync(CLERK_DIR);
    }
  } catch {}

  console.log('');
  console.log('  Uninstall complete!');
  console.log('');
  console.log('  The Clerk hooks have been removed from Claude Code.');
  console.log('  Your per-project observation data was NOT deleted.');
  console.log('  To remove a project\'s data: rm -rf {project}/.claude/clerk/');
  console.log('');
}

try {
  uninstall();
} catch (err) {
  console.error('  Uninstall failed:', err.message);
  process.exit(1);
}
