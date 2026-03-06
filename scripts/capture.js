#!/usr/bin/env node
/**
 * CLERK — PostToolUse Hook
 * Fires on every tool call. Captures observation to project-local JSONL file.
 * Fire-and-forget: always exits 0, never blocks Claude.
 */

const fs = require('fs');
const path = require('path');

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
      case 'Bash': return `cmd: ${(input.command || '').slice(0, 200)}`;
      case 'Read': return `read: ${input.file_path || ''}`;
      case 'Write': return `write: ${input.file_path || ''}`;
      case 'Edit': return `edit: ${input.file_path || ''} | old: ${(input.old_string || '').slice(0, 80)}`;
      case 'Grep': return `grep: "${input.pattern || ''}" in ${input.path || 'cwd'}`;
      case 'Glob': return `glob: ${input.pattern || ''}`;
      case 'Agent': return `agent: ${input.description || input.subagent_type || ''}`;
      case 'WebSearch': return `search: ${input.query || ''}`;
      case 'WebFetch': return `fetch: ${input.url || ''}`;
      case 'SendMessage': return `msg to ${input.recipient || 'team'}: ${(input.summary || input.content || '').slice(0, 100)}`;
      case 'TaskCreate': return `task: ${input.subject || ''}`;
      case 'TaskUpdate': return `task update: ${input.taskId || ''} → ${input.status || ''}`;
      default:
        // MCP tools
        if (toolName.startsWith('mcp__')) {
          const parts = toolName.split('__');
          const server = parts[1] || '';
          const method = parts.slice(2).join('__') || '';
          return `mcp ${server}.${method}: ${JSON.stringify(input).slice(0, 150)}`;
        }
        return JSON.stringify(input).slice(0, 200);
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

function truncateResponse(toolResponse) {
  try {
    const resp = typeof toolResponse === 'string' ? toolResponse : JSON.stringify(toolResponse);
    return resp.slice(0, 300);
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

    // Build observation record
    const observation = {
      type: 'observation',
      ts: new Date().toISOString(),
      session: session_id,
      tool: tool_name,
      summary: summarizeTool(tool_name, input.tool_input),
      files: extractFiles(tool_name, input.tool_input),
      response_preview: truncateResponse(input.tool_response)
    };

    // Append to JSONL file
    const logFile = path.join(clerkDir, 'observations.jsonl');
    fs.appendFileSync(logFile, JSON.stringify(observation) + '\n');

    process.stdout.write(JSON.stringify({ continue: true, suppressOutput: true }));
  } catch (err) {
    // Never fail — always let Claude continue
    process.stdout.write(JSON.stringify({ continue: true, suppressOutput: true }));
  }
  process.exit(0);
}

main();
