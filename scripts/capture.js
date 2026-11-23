#!/usr/bin/env node
/**
 * CLERK — PostToolUse Hook
 * Fires on every tool call. Captures observation to project-local JSONL file.
 * Fire-and-forget: always exits 0, never blocks Claude.
 */

const fs = require('fs');
const path = require('path');
const { redact } = require('./redact');

const SKIP_TOOLS = new Set([
  'TodoRead', 'TodoWrite', 'AskUserQuestion', 'Skill',
  'ListMcpResourcesTool', 'ToolSearch', 'TaskList', 'TaskGet',
  'EnterPlanMode', 'ExitPlanMode'
]);

function summarizeTool(toolName, toolInput) {
  if (!toolInput) return '';
  try {
    const input = typeof toolInput === 'string' ? JSON.parse(toolInput) : toolInput;
    switch (toolName) {
      // FULL command, never truncated. A record that silently drops the end is worse than no
      // record, because you trust it: reconstructing a truncated command is how a made-up value
      // ends up being reported as a fact. Secrets are handled by redaction, not by truncation.
      case 'Bash': return `cmd: ${input.command || ''}`;
      case 'Read': return `read: ${input.file_path || ''}`;
      case 'Write': return `write: ${input.file_path || ''}`;
      case 'Edit': return `edit: ${input.file_path || ''} | old: ${input.old_string || ''}`;
      case 'Grep': return `grep: "${input.pattern || ''}" in ${input.path || 'cwd'}`;
      case 'Glob': return `glob: ${input.pattern || ''}`;
      case 'Agent': return `agent: ${input.description || input.subagent_type || ''}`;
      case 'WebSearch': return `search: ${input.query || ''}`;
      case 'WebFetch': return `fetch: ${input.url || ''}`;
      case 'SendMessage': return `msg to ${input.recipient || 'team'}: ${input.summary || input.content || ''}`;
      case 'TaskCreate': return `task: ${input.subject || ''}`;
      case 'TaskUpdate': return `task update: ${input.taskId || ''} → ${input.status || ''}`;
      default:
        // MCP tools
        if (toolName.startsWith('mcp__')) {
          const parts = toolName.split('__');
          const server = parts[1] || '';
          const method = parts.slice(2).join('__') || '';
          return `mcp ${server}.${method}: ${JSON.stringify(input)}`;
        }
        return JSON.stringify(input);
    }
  } catch {
    return '';
  }
}

function extractFiles(toolName, toolInput) {
  try {
    const input = typeof toolInput === 'string' ? JSON.parse(toolInput) : toolInput;
    if (input.file_path) return [input.file_path];
    if (input.path) return [input.path];
    if (input.notebook_path) return [input.notebook_path];
    return [];
  } catch {
    return [];
  }
}

// Tool RESPONSES carry secrets too — a query that selects an access token returns it here. Kept in
// full for the same reason as commands, and redacted for the same reason as commands.
function captureResponse(toolResponse) {
  try {
    return typeof toolResponse === 'string' ? toolResponse : JSON.stringify(toolResponse);
  } catch {
    return '';
  }
}

async function main() {
  try {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks).toString());

    const { session_id, cwd, tool_name } = input;

    // Skip noisy/meta tools
    if (SKIP_TOOLS.has(tool_name)) {
      process.stdout.write(JSON.stringify({ continue: true, suppressOutput: true }));
      process.exit(0);
    }

    // Check for DISABLED flag
    const clerkDir = path.join(cwd, '.claude', 'clerk');
    if (fs.existsSync(path.join(clerkDir, 'DISABLED'))) {
      process.stdout.write(JSON.stringify({ continue: true, suppressOutput: true }));
      process.exit(0);
    }

    // Check for CLERK_OFF env variable
    if (process.env.CLERK_OFF === '1') {
      process.stdout.write(JSON.stringify({ continue: true, suppressOutput: true }));
      process.exit(0);
    }

    // Ensure clerk directory exists
    fs.mkdirSync(clerkDir, { recursive: true });

    // Build observation record. Everything written here goes through redaction first: this file
    // is permanent and plaintext, so a credential that reaches it is a credential that has leaked.
    const summary = redact(summarizeTool(tool_name, input.tool_input));
    const response = redact(captureResponse(input.tool_response));
    const redactions = [...new Set([...summary.redactions, ...response.redactions])];

    const observation = {
      type: 'observation',
      ts: new Date().toISOString(),
      session: session_id,
      tool: tool_name,
      summary: summary.text,
      files: extractFiles(tool_name, input.tool_input),
      response: response.text
    };
    // Only present when something was removed — its presence is the signal that this record is
    // not verbatim, so a reader is never left guessing whether a gap meant "nothing was there".
    if (redactions.length) observation.redacted = redactions;

    // Append to JSONL file, 0600 from the moment it is created: the log is a transcript of
    // everything this machine did, and it should not be world-readable even after redaction.
    const logFile = path.join(clerkDir, 'observations.jsonl');
    if (!fs.existsSync(logFile)) fs.writeFileSync(logFile, '', { mode: 0o600 });
    fs.appendFileSync(logFile, JSON.stringify(observation) + '\n');

    process.stdout.write(JSON.stringify({ continue: true, suppressOutput: true }));
  } catch (err) {
    // Never fail — always let Claude continue
    process.stdout.write(JSON.stringify({ continue: true, suppressOutput: true }));
  }
  process.exit(0);
}

main();
