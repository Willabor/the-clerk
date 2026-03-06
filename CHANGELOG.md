# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

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
