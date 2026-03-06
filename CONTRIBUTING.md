# Contributing to The Clerk

Thank you for your interest in contributing!

## How to Contribute

1. **Fork** the repository
2. **Create a feature branch** (`git checkout -b feature/amazing-feature`)
3. **Make your changes**
4. **Test** your changes (see below)
5. **Commit** (`git commit -m 'Add amazing feature'`)
6. **Push** to your fork (`git push origin feature/amazing-feature`)
7. **Open a Pull Request** against `main`

## Development Setup

```bash
git clone https://github.com/YOUR-USERNAME/the-clerk.git
cd the-clerk
node tests/test.js
```

No `npm install` needed — The Clerk has zero dependencies.

## Guidelines

- Follow the existing code style
- Keep it zero-dependency — only use Node.js built-in modules
- Every hook must always exit 0 and return `{ "continue": true }` — never block Claude
- Add tests for new features
- Update the README if your change affects usage
- One feature per PR — keep PRs small and focused

## Testing

```bash
node tests/test.js
```

To test hooks manually:

```bash
# Test capture:
echo '{"session_id":"test","cwd":"/tmp/test","tool_name":"Bash","tool_input":{"command":"echo hello"},"tool_response":"hello"}' | node scripts/capture.js

# Test session start:
echo '{"session_id":"test","cwd":"/tmp/test"}' | node scripts/session-start.js
```

## Reporting Bugs

Use the [GitHub issue tracker](https://github.com/Willabor/the-clerk/issues) with the bug report template.

## Feature Requests

Open an issue using the feature request template. Describe:
- What you want to achieve
- Why the current behavior is insufficient
- Any alternatives you've considered

## Code of Conduct

Be respectful. Be constructive. We're all here to build useful tools.
