# The Clerk

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green.svg)](https://nodejs.org/)

**Invisible, automated session documentation for [Claude Code](https://docs.anthropic.com/en/docs/claude-code).**

The Clerk silently records every tool call, user message, and session boundary in your Claude Code sessions. Like a court clerk in a courtroom — it observes everything, writes it all down, and never interrupts.

---

## Why?

Claude Code sessions can run for hours. Context compaction loses history. You forget what happened three sessions ago. The Clerk fixes this:

- **Nothing is lost** — Every action is recorded to a persistent file
- **Sessions are resumable** — On session start, recent history is injected into Claude's context
- **Work is auditable** — See exactly what was done, when, and to which files
- **Survives compaction** — Hooks run outside Claude's context window

---

## Quick Start

```bash
git clone https://github.com/Willabor/the-clerk.git
cd the-clerk
node install.js
```

That's it. Start a new Claude Code session anywhere and you'll see:

```
[CLERK] Online | Project: my-project | First session — recording started
```

---

## What It Records

| Event | What's Captured |
|-------|----------------|
| **Session start** | Timestamp, project directory |
| **Your messages** | First 500 characters of each prompt |
| **Tool calls** | Tool name, concise summary, files touched, 300-char response preview |
| **Session end** | Timestamp |

### What It Does NOT Record

- Claude's internal reasoning/thinking
- Full file contents (only paths + short previews)
- Meta tools (TodoRead, AskUserQuestion, ToolSearch, etc.)

---

## How It Works

The Clerk uses [Claude Code hooks](https://docs.anthropic.com/en/docs/claude-code/hooks) — shell commands that execute automatically at lifecycle events.

```
Session starts → SessionStart hook injects status + recent history
                                    ↓
You type a message → UserPromptSubmit hook records it
                                    ↓
Claude uses a tool → PostToolUse hook captures it with a concise summary
                                    ↓
Session ends → Stop hook writes end marker
                                    ↓
All data appends to → {project}/.claude/clerk/observations.jsonl
```

### Four Hooks

| Hook | Script | What It Does |
|------|--------|-------------|
| `SessionStart` | `session-start.js` | Creates clerk dir, auto-rotates large files, injects context |
| `UserPromptSubmit` | `user-prompt.js` | Records your messages (truncated to 500 chars) |
| `PostToolUse` | `capture.js` | Records tool calls with smart summarization |
| `Stop` | `session-end.js` | Writes session end marker |

### Tool Summarization

Each tool type gets a human-readable summary:

| Tool | Summary Format |
|------|---------------|
| Bash | `cmd: npm test` |
| Read | `read: src/app/page.js` |
| Write | `write: src/lib/constants.mjs` |
| Edit | `edit: src/app/page.js \| old: const revenue...` |
| Grep | `grep: "pattern" in src/` |
| Glob | `glob: **/*.js` |
| Agent | `agent: Deep research on authentication` |
| MCP | `mcp vikunja.tasks_list: {...}` |

---

## Data Storage

### Per-Project Isolation

Each project folder where you run Claude Code gets its own independent log:

```
my-project/.claude/clerk/observations.jsonl
another-project/.claude/clerk/observations.jsonl
```

Logs are never shared between projects.

### Data Format (JSONL)

One JSON record per line. Five record types:

```jsonl
{"type":"session_start","ts":"2026-03-06T14:00:00.000Z","session":"abc123","cwd":"/home/user/project"}
{"type":"user_prompt","ts":"2026-03-06T14:00:05.000Z","session":"abc123","message":"fix the login bug"}
{"type":"observation","ts":"2026-03-06T14:00:10.000Z","session":"abc123","tool":"Edit","summary":"edit: src/auth.js | old: if (token)","files":["src/auth.js"],"response_preview":"..."}
{"type":"session_end","ts":"2026-03-06T14:30:00.000Z","session":"abc123"}
{"type":"rotation_summary","ts":"2026-06-15T14:00:00.000Z","period":"Mar 6 — Jun 15","total_sessions":87,"total_observations":4200}
```

### Auto-Rotation

When `observations.jsonl` exceeds **10 MB** (~2-3 months of heavy use):

1. The old file is scanned for a statistical summary (top files, top tools, date range, recent work)
2. Old file is renamed: `observations_archive_20260615.jsonl`
3. New file starts with a `rotation_summary` record preserving context continuity
4. No data is ever deleted — archives are preserved indefinitely

---

## Context Injection

On every session start, the Clerk injects recent history into Claude's context:

```
[CLERK] Online | Project: my-project | 247 records across 12 sessions
Last session (Mar 5):
- [02:15 PM] **Bash** — cmd: npm test
- [02:16 PM] **Edit** — edit: src/app/page.js | old: const revenue = s.total
- [02:17 PM] **Write** — write: src/lib/constants.mjs
- [02:20 PM] **You** — now deploy it to production
```

After auto-rotation, it also shows archive stats:

```
Previous archive (Mar 6, 2026 — Jun 15, 2026):
- 87 sessions, 4200 observations, 350 user messages
- Most-touched files: page.js (45x), route.js (38x), db.mjs (20x)
- Recent work: fix the reorder algorithm | update transfer logic
```

---

## Commands

### Check Status

```bash
# Count records in current project:
wc -l .claude/clerk/observations.jsonl

# See last 5 records:
tail -5 .claude/clerk/observations.jsonl

# Pretty-print recent observations:
node -e "
  const lines = require('fs').readFileSync('.claude/clerk/observations.jsonl','utf8').trim().split('\n');
  const obs = lines.map(l => { try { return JSON.parse(l) } catch { return null } })
    .filter(o => o && o.type === 'observation').slice(-20);
  obs.forEach(o => console.log(new Date(o.ts).toLocaleString(), o.tool, '-', o.summary));
"
```

### View User Messages

```bash
node -e "
  const lines = require('fs').readFileSync('.claude/clerk/observations.jsonl','utf8').trim().split('\n');
  const prompts = lines.map(l => { try { return JSON.parse(l) } catch { return null } })
    .filter(o => o && o.type === 'user_prompt');
  prompts.forEach(p => console.log(new Date(p.ts).toLocaleString(), '→', p.message));
"
```

### Disable / Enable

```bash
# Disable for THIS project only:
mkdir -p .claude/clerk && touch .claude/clerk/DISABLED

# Re-enable for THIS project:
rm .claude/clerk/DISABLED

# Disable temporarily (one session):
CLERK_OFF=1 claude

# Disable globally (permanent):
node uninstall.js
```

---

## Installation Details

### What `install.js` Does

1. Creates `~/.claude/clerk/scripts/` directory
2. Copies 4 hook scripts there
3. Reads existing `~/.claude/settings.json` (or creates it)
4. Merges Clerk hooks into the settings (preserves existing hooks from other tools)

### What `uninstall.js` Does

1. Removes Clerk hook entries from `~/.claude/settings.json` (preserves other hooks)
2. Deletes `~/.claude/clerk/scripts/`
3. Does **NOT** delete per-project observation data — that's yours to keep

### Requirements

- **Node.js 18+** (uses `fs`, `path`, `os` — all built-in, zero npm dependencies)
- **Claude Code** with hooks support

---

## Security

### Git Exclusion

The `.claude/clerk/` directory may contain sensitive information captured from tool inputs and responses (API keys, passwords, file contents). **Add it to your global gitignore:**

```bash
# Add to your global gitignore (do this once):
echo ".claude/clerk/" >> ~/.gitignore_global
git config --global core.excludesFile ~/.gitignore_global
```

Or add `.claude/clerk/` to each project's `.gitignore`.

### Data Stays Local

- All data is stored locally in each project folder
- Nothing is sent to external servers
- No network requests are made
- No telemetry or analytics

---

## Design Principles

| Principle | Implementation |
|-----------|---------------|
| **Zero dependencies** | Only Node.js built-in modules (`fs`, `path`, `os`) |
| **Never blocks** | Every hook exits 0 — Claude is never interrupted |
| **Invisible** | All hooks return `suppressOutput: true` — no UI noise |
| **Crash-safe** | If a hook fails, Claude continues unaffected |
| **Append-only** | Log files are never modified, only appended to |
| **Per-project** | Each project has its own independent log |
| **Cross-platform** | Works on Windows, macOS, and Linux |

---

## Inspired By

[claude-mem](https://github.com/thedotmack/claude-mem) by Alex Newman — an excellent Claude Code memory system with AI compression, vector search, and a web UI.

The Clerk takes a simpler approach:

| claude-mem | The Clerk |
|-----------|-----------|
| Bun runtime required | Node.js only |
| Express HTTP worker on port 37777 | Direct file writes |
| SQLite + ChromaDB | Single JSONL file |
| AI compression pipeline | Raw capture + concise summaries |
| MCP server for search | File queries via Node one-liners |
| ~50+ source files | 4 scripts, ~570 lines total |
| npm install + native deps | Zero dependencies |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines. In short:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Open a Pull Request

All contributions must be submitted via pull request. Direct pushes to `main` are not allowed.

---

## License

[GPL-3.0](LICENSE) — Free to use, modify, and distribute. If you distribute modified versions, you must keep them open source under the same license.

Copyright (c) 2026 Wail Abor
