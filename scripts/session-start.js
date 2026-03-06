#!/usr/bin/env node
/**
 * CLERK — SessionStart Hook
 * Fires when a new session begins. Injects clerk status + recent context.
 * Creates the clerk database (JSONL files) if it doesn't exist.
 * Auto-rotates when file exceeds MAX_SIZE_MB.
 */

const fs = require('fs');
const path = require('path');

const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB — auto-rotate threshold

function getFileSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function buildRotationSummary(logFile) {
  // Build a summary of the archive before rotating
  try {
    const content = fs.readFileSync(logFile, 'utf-8').trim();
    if (!content) return null;

    const lines = content.split('\n');
    const records = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

    // Gather stats
    const sessionIds = new Set();
    const filesTouched = {};
    const toolCounts = {};
    let firstTs = null;
    let lastTs = null;
    let userPrompts = 0;
    let observations = 0;

    for (const r of records) {
      if (r.session) sessionIds.add(r.session);
      if (r.ts) {
        if (!firstTs || r.ts < firstTs) firstTs = r.ts;
        if (!lastTs || r.ts > lastTs) lastTs = r.ts;
      }
      if (r.type === 'observation') {
        observations++;
        if (r.tool) toolCounts[r.tool] = (toolCounts[r.tool] || 0) + 1;
        if (r.files) {
          for (const f of r.files) {
            // Use just the filename for readability
            const name = path.basename(f);
            filesTouched[name] = (filesTouched[name] || 0) + 1;
          }
        }
      }
      if (r.type === 'user_prompt') userPrompts++;
    }

    // Top 10 most-touched files
    const topFiles = Object.entries(filesTouched)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => `${name} (${count}x)`);

    // Top 5 tools
    const topTools = Object.entries(toolCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tool, count]) => `${tool} (${count}x)`);

    // Date range
    const startDate = firstTs ? new Date(firstTs).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'unknown';
    const endDate = lastTs ? new Date(lastTs).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'unknown';

    // Last 5 user prompts (what was the user working on?)
    const recentPrompts = records
      .filter(r => r.type === 'user_prompt' && r.message)
      .slice(-5)
      .map(r => r.message.slice(0, 100));

    return {
      type: 'rotation_summary',
      ts: new Date().toISOString(),
      period: `${startDate} — ${endDate}`,
      total_sessions: sessionIds.size,
      total_observations: observations,
      total_prompts: userPrompts,
      top_files: topFiles,
      top_tools: topTools,
      recent_work: recentPrompts
    };
  } catch {
    return null;
  }
}

function autoRotate(logFile, clerkDir) {
  const size = getFileSize(logFile);
  if (size < MAX_SIZE_BYTES) return;

  // Build summary BEFORE rotating
  const summary = buildRotationSummary(logFile);

  // Rotate: rename current file with date stamp
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const archiveName = `observations_archive_${date}.jsonl`;
  const archivePath = path.join(clerkDir, archiveName);

  // If archive already exists today, append a counter
  let finalPath = archivePath;
  let counter = 1;
  while (fs.existsSync(finalPath)) {
    finalPath = path.join(clerkDir, `observations_archive_${date}_${counter}.jsonl`);
    counter++;
  }

  fs.renameSync(logFile, finalPath);

  // Write summary as first record in new file
  if (summary) {
    fs.appendFileSync(logFile, JSON.stringify(summary) + '\n');
  }
}

function readTail(filePath, bytes) {
  // Read only the last N bytes of the file — efficient for large files
  try {
    if (!fs.existsSync(filePath)) return '';
    const stat = fs.statSync(filePath);
    const readSize = Math.min(bytes, stat.size);
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(readSize);
    fs.readSync(fd, buffer, 0, readSize, stat.size - readSize);
    fs.closeSync(fd);
    return buffer.toString('utf-8');
  } catch {
    return '';
  }
}

function readLastRecords(filePath, maxRecords) {
  try {
    // Read last 64KB — enough for ~150 records
    const tail = readTail(filePath, 64 * 1024);
    if (!tail) return [];
    const lines = tail.split('\n').filter(l => l.trim());
    // First line might be partial — skip it
    const safeLines = lines.length > 1 ? lines.slice(1) : lines;
    return safeLines.slice(-maxRecords).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function getQuickStats(filePath) {
  // Approximate stats without reading entire file
  try {
    if (!fs.existsSync(filePath)) return { records: 0, sessions: 0 };
    const size = getFileSize(filePath);

    // For small files (<1MB), count exactly
    if (size < 1024 * 1024) {
      const content = fs.readFileSync(filePath, 'utf-8').trim();
      if (!content) return { records: 0, sessions: 0 };
      const lines = content.split('\n');
      const sessionIds = new Set();
      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          if (obj.session) sessionIds.add(obj.session);
        } catch {}
      }
      return { records: lines.length, sessions: sessionIds.size };
    }

    // For large files, estimate records from file size and count sessions from tail
    const avgRecordSize = 460; // bytes, measured from real data
    const estimatedRecords = Math.round(size / avgRecordSize);

    // Count sessions from last 200KB (covers many sessions)
    const tail = readTail(filePath, 200 * 1024);
    const tailLines = tail.split('\n').filter(l => l.trim());
    const sessionIds = new Set();
    for (const line of tailLines) {
      try {
        const obj = JSON.parse(line);
        if (obj.session) sessionIds.add(obj.session);
      } catch {}
    }

    return { records: estimatedRecords, sessions: sessionIds.size, estimated: true };
  } catch {
    return { records: 0, sessions: 0 };
  }
}

function getLatestArchive(clerkDir) {
  try {
    const files = fs.readdirSync(clerkDir)
      .filter(f => f.startsWith('observations_archive_') && f.endsWith('.jsonl'))
      .sort()
      .reverse();
    if (files.length === 0) return null;
    return path.join(clerkDir, files[0]);
  } catch {
    return null;
  }
}

function formatObservation(obs) {
  const time = obs.ts ? new Date(obs.ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '??:??';
  if (obs.type === 'user_prompt') {
    return `- [${time}] **You** — ${(obs.message || '').slice(0, 100)}`;
  }
  return `- [${time}] **${obs.tool}** — ${obs.summary || ''}`;
}

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

    // Ensure clerk directory exists
    fs.mkdirSync(clerkDir, { recursive: true });

    // Auto-rotate if file is too large
    autoRotate(logFile, clerkDir);

    // Record session start
    const sessionRecord = {
      type: 'session_start',
      ts: new Date().toISOString(),
      session: session_id,
      cwd: cwd
    };
    fs.appendFileSync(logFile, JSON.stringify(sessionRecord) + '\n');

    // Gather stats (efficiently — no full file read for large files)
    const stats = getQuickStats(logFile);

    // Add archived records to total count
    try {
      const archives = fs.readdirSync(clerkDir)
        .filter(f => f.startsWith('observations_archive_') && f.endsWith('.jsonl'));
      for (const archive of archives) {
        const archiveSize = getFileSize(path.join(clerkDir, archive));
        stats.records += Math.round(archiveSize / 460);
        stats.estimated = true;
      }
    } catch {}

    // Get recent observations (reads only last 64KB)
    let recentObs = readLastRecords(logFile, 30)
      .filter(o => o.type === 'observation' || o.type === 'user_prompt')
      .slice(-15);

    // If current file has few records (just rotated), also check most recent archive
    if (recentObs.length < 5) {
      const latestArchive = getLatestArchive(clerkDir);
      if (latestArchive) {
        const archiveObs = readLastRecords(latestArchive, 30)
          .filter(o => o.type === 'observation' || o.type === 'user_prompt')
          .slice(-15);
        // Prepend archive observations, then append current
        recentObs = [...archiveObs.slice(-(15 - recentObs.length)), ...recentObs];
      }
    }

    // Get project folder name
    const projectName = path.basename(cwd);

    // Build context injection
    const approx = stats.estimated ? '~' : '';
    let context = `[CLERK] Online | Project: ${projectName} | ${approx}${stats.records} records across ${approx}${stats.sessions} sessions\n`;

    if (recentObs.length > 0) {
      // Find the last session's observations
      const lastSessionId = recentObs[recentObs.length - 1].session;
      const lastSessionObs = recentObs.filter(o => o.session === lastSessionId);

      if (lastSessionObs.length > 0 && lastSessionId !== session_id) {
        const lastDate = lastSessionObs[0].ts
          ? new Date(lastSessionObs[0].ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          : 'unknown';
        context += `Last session (${lastDate}):\n`;
        for (const obs of lastSessionObs.slice(-10)) {
          context += formatObservation(obs) + '\n';
        }
      }
    }

    // Check for rotation summary (first record after rotation)
    const allRecent = readLastRecords(logFile, 5);
    const rotationSummary = allRecent.find(r => r.type === 'rotation_summary');
    if (rotationSummary) {
      context += `\nPrevious archive (${rotationSummary.period}):\n`;
      context += `- ${rotationSummary.total_sessions} sessions, ${rotationSummary.total_observations} observations, ${rotationSummary.total_prompts} user messages\n`;
      if (rotationSummary.top_files && rotationSummary.top_files.length > 0) {
        context += `- Most-touched files: ${rotationSummary.top_files.slice(0, 5).join(', ')}\n`;
      }
      if (rotationSummary.recent_work && rotationSummary.recent_work.length > 0) {
        context += `- Recent work: ${rotationSummary.recent_work.join(' | ')}\n`;
      }
    }

    if (stats.records <= 1 && !rotationSummary) {
      context = `[CLERK] Online | Project: ${projectName} | First session — recording started\n`;
    }

    const response = {
      continue: true,
      suppressOutput: true,
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: context
      }
    };

    process.stdout.write(JSON.stringify(response));
  } catch (err) {
    // On any error, don't block — just skip injection
    process.stdout.write(JSON.stringify({ continue: true, suppressOutput: true }));
  }
  process.exit(0);
}

main();
