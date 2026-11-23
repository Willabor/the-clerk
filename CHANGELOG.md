# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [1.1.0] - 2026-11-23

### Added
- **Redaction** (`scripts/redact.js`) — credentials in commands, tool responses and prompts are replaced with `[REDACTED:<kind>]` before anything is written; records carry a `redacted` field when something was removed
- **search.js** — search the record (`npm run search`); reads both `response` and the old `response_preview` field
- **secure.js / harden.js** — check and tighten log file permissions (`npm run harden`, report-only unless `--apply`); uses `icacls` on Windows and re-reads the result
- Tests for redaction and for the installer copying every script

### Changed
- Commands, responses and prompts are recorded in full (no more 200/300/500-char truncation); `response_preview` is renamed `response`
- New log files are created with mode 0600
- Installer copies `redact.js` (required by the capture hooks) and the new tools

## [1.0.0] - 2026-03-06

### Added
- Initial release
- **SessionStart hook** — Context injection with recent session history, auto-rotation at 10 MB, archive fallback for context continuity
- **PostToolUse hook** — Tool-specific summarization for Bash, Read, Write, Edit, Grep, Glob, Agent, MCP, and more
- **UserPromptSubmit hook** — User message recording with 500-char truncation
- **Stop hook** — Session end markers
- **Per-project isolation** — Each project gets its own `observations.jsonl`
- **Auto-rotation** — Rotates at 10 MB with statistical summaries preserving context
- **Three kill switches** — `DISABLED` file (per-project), `CLERK_OFF=1` env (per-session), uninstall (global)
- **Installer/Uninstaller** — `install.js` and `uninstall.js` for easy setup and removal
- Cross-platform support (Windows, macOS, Linux)
