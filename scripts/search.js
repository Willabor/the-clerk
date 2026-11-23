#!/usr/bin/env node
/**
 * CLERK — search / retrieval
 *
 * The log is a plain append-only JSONL file and stays that way on purpose: an index would be
 * faster and would also be the thing that breaks in two years. The whole point of this tool is
 * that the record outlives everything around it, so the record has to be readable by `grep` even
 * if this script is gone. This is a convenience layer over that file, never a replacement for it.
 *
 * Usage:
 *   clerk-search [query]                 free-text / regex over the record
 *   clerk-search --tool Bash --since 2d
 *   clerk-search --file app/models       records touching a path
 *   clerk-search --session <id> --json
 *   clerk-search --stats
 *
 * Options:
 *   --log <path>       explicit log file (default: ./.claude/clerk/observations.jsonl)
 *   --tool <name>      tool name, exact (repeatable)
 *   --type <kind>      observation | user_prompt | session_start | session_end (repeatable)
 *   --session <id>     session id, prefix match
 *   --file <substr>    match against recorded file paths
 *   --since <when>     ISO date, or 30m / 6h / 2d / 1w
 *   --until <when>     same forms
 *   --redacted         only records where something was redacted
 *   -i                 case-insensitive query
 *   -n, --limit <n>    max records (default 50; 0 = unlimited)
 *   --json             emit raw JSONL rather than formatted lines
 *   --stats            summarise instead of listing
 *   --audit            scan EXISTING records for unredacted secrets (read-only, changes nothing)
 *   --root <dir>       with --audit: walk <dir> and audit EVERY .claude/clerk log found. REPEATABLE
 *                      and you should repeat it: the Clerk writes per PROJECT (cwd-relative), and on
 *                      Git Bash for Windows `~` does not contain `C:\dev`, so a single root proves
 *                      nothing about the machine. Pass every root you actually use.
 *
 * Exit codes: 0 = matches found, 1 = none found, 2 = usage/IO error. A search that matched nothing
 * exits non-zero deliberately, so a script can tell "no results" from "the log was unreadable".
 */

'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { redact } = require('./redact');

function parseWhen(s) {
  if (!s) return null;
  const rel = /^(\d+)([mhdw])$/.exec(s.trim());
  if (rel) {
    const n = Number(rel[1]);
    const ms = { m: 60e3, h: 3600e3, d: 86400e3, w: 604800e3 }[rel[2]];
    return new Date(Date.now() - n * ms);
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function parseArgs(argv) {
  const o = { tools: [], types: [], terms: [], roots: [], limit: 50 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--log': o.log = next(); break;
      case '--tool': o.tools.push(next()); break;
      case '--type': o.types.push(next()); break;
      case '--session': o.session = next(); break;
      case '--file': o.file = next(); break;
      case '--since': o.since = parseWhen(next()); break;
      case '--until': o.until = parseWhen(next()); break;
      case '--redacted': o.redactedOnly = true; break;
      case '-i': o.insensitive = true; break;
      case '--json': o.json = true; break;
      case '--stats': o.stats = true; break;
      case '--audit': o.audit = true; break;
      case '--root': o.roots.push(next()); break;
      case '-n': case '--limit': o.limit = Number(next()); break;
      case '-h': case '--help': o.help = true; break;
      default:
        if (a.startsWith('-')) { o.badFlag = a; }
        else o.terms.push(a);
    }
  }
  return o;
}

function defaultLog() {
  return path.join(process.cwd(), '.claude', 'clerk', 'observations.jsonl');
}

function recordText(r) {
  // `response_preview` is the pre-1.1.0 field name. Logs written by an older Clerk are still in
  // people's repos and must stay searchable — a retrieval tool that silently cannot see old
  // records is worse than one that refuses to run.
  return [r.summary, r.message, r.response, r.response_preview, (r.files || []).join(' '), r.tool, r.type]
    .filter(Boolean).join(' ');
}

function fmt(r) {
  const ts = (r.ts || '').replace('T', ' ').replace(/\.\d+Z$/, 'Z');
  const sess = (r.session || '').slice(0, 8);
  const mark = r.redacted ? ` [redacted:${r.redacted.join(',')}]` : '';
  if (r.type === 'user_prompt') return `${ts}  ${sess}  USER${mark}\n    ${r.message || ''}`;
  if (r.type === 'session_start' || r.type === 'session_end') return `${ts}  ${sess}  ${r.type.toUpperCase()}`;
  const body = r.summary || '';
  return `${ts}  ${sess}  ${r.tool || '?'}${mark}\n    ${body}`;
}

/**
 * Find every Clerk log under a root. The writer uses `path.join(cwd, '.claude', 'clerk')`, so a
 * machine that has run the Clerk in five projects has five logs — and auditing or chmod-ing only the
 * one in the current directory leaves the other four exactly as exposed as before. Discovered the
 * hard way: a log people believed was dead was simply a different project's.
 */
function findLogs(root, depth = 6) {
  const found = [];
  const walk = (dir, d) => {
    if (d < 0) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const full = path.join(dir, e.name);
      if (e.name === 'clerk' && path.basename(dir) === '.claude') {
        try {
          for (const f of fs.readdirSync(full)) if (f.endsWith('.jsonl')) found.push(path.join(full, f));
        } catch { /* unreadable dir is reported by the caller as unknown, not as clean */ }
        continue;
      }
      walk(full, d - 1);
    }
  };
  walk(root, depth);
  return found;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) { process.stdout.write(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^[\s\S]*?\*\n/, '') + '\n'); process.exit(0); }
  if (o.badFlag) { console.error(`unknown flag: ${o.badFlag} (try --help)`); process.exit(2); }

  // --audit --root: audit every project's log, not just this directory's.
  if (o.audit && o.roots.length) {
    const logs = [...new Set(o.roots.flatMap((r) => findLogs(r)))];
    if (!logs.length) {
      console.error(`no .claude/clerk logs found under: ${o.roots.join(', ')}`);
      console.error('that is not the same as "no logs exist" — check you passed the roots you actually use');
      process.exit(2);
    }
    let totalHits = 0;
    for (const lf of logs) {
      // On win32 the POSIX mode bits node reports are a translation, not the access control that
      // actually applies — NTFS ACLs govern. Printing "644" there invites the reader to conclude
      // "world-readable" from a number that never meant that. Say n/a and point at the real check.
      const mode = process.platform === 'win32'
        ? 'n/a(ACL)'
        : (() => { try { return (fs.statSync(lf).mode & 0o777).toString(8); } catch { return '???'; } })();
      const r = require('child_process').spawnSync(process.execPath, [__filename, '--audit', '--log', lf], { encoding: 'utf8' });
      const line = (r.stdout || '').split('\n').find((l) => l.startsWith('unredacted')) || 'unredacted ? (unreadable)';
      const flag = r.status === 1 ? 'HIT ' : r.status === 0 ? 'ok  ' : '??? ';
      console.log(`${flag} mode=${mode}  ${line.replace(/^unredacted\s+/, '').padEnd(46)}  ${lf}`);
      if (r.status === 1) totalHits++;
    }
    console.log(`\n${logs.length} log(s) scanned across ${o.roots.length} root(s), ${totalHits} containing credential shapes`);
    console.log('coverage is only as wide as the roots you passed — one clean root is not a clean machine');
    if (process.platform === 'win32') {
      console.log('win32: file modes are not shown because POSIX bits are a translation here.');
      console.log('       check real access with:  icacls <path>');
    }
    process.exit(totalHits ? 1 : 0);
  }

  const logFile = o.log || defaultLog();
  if (!fs.existsSync(logFile)) {
    // Distinguish "no log" from "no matches" — they mean different things and only one is a result.
    console.error(`no log at ${logFile} — the Clerk may not be installed, or nothing has been recorded here`);
    process.exit(2);
  }

  let re = null;
  if (o.terms.length) {
    try { re = new RegExp(o.terms.join(' '), o.insensitive ? 'i' : ''); }
    catch { re = null; } // fall back to substring match on an invalid regex
  }
  const plain = o.terms.join(' ');

  const rl = readline.createInterface({ input: fs.createReadStream(logFile), crlfDelay: Infinity });
  const out = [];
  const stats = { total: 0, matched: 0, byTool: {}, byType: {}, redacted: 0, first: null, last: null };
  const audit = { hits: 0, byKind: {}, samples: [] };

  for await (const line of rl) {
    if (!line.trim()) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; } // a torn final line must not kill the search
    stats.total++;

    if (o.types.length && !o.types.includes(r.type)) continue;
    if (o.tools.length && !o.tools.includes(r.tool)) continue;
    if (o.session && !(r.session || '').startsWith(o.session)) continue;
    if (o.redactedOnly && !r.redacted) continue;
    if (o.file && !(r.files || []).some((f) => f.includes(o.file))) continue;
    if (o.since || o.until) {
      const t = new Date(r.ts || 0);
      if (o.since && t < o.since) continue;
      if (o.until && t > o.until) continue;
    }
    if (o.terms.length) {
      const hay = recordText(r);
      const hit = re ? re.test(hay) : hay.includes(plain);
      if (!hit) continue;
    }

    stats.matched++;
    stats.byTool[r.tool || r.type] = (stats.byTool[r.tool || r.type] || 0) + 1;
    stats.byType[r.type] = (stats.byType[r.type] || 0) + 1;
    if (r.redacted) stats.redacted++;
    if (!stats.first || r.ts < stats.first) stats.first = r.ts;
    if (!stats.last || r.ts > stats.last) stats.last = r.ts;

    if (o.audit) {
      // Records written before v1.1.0 were never redacted. Re-run the patterns over them and
      // report — WITHOUT rewriting anything. Knowing whether an existing log holds credentials is
      // a different question from cleaning it, and the answer decides whether cleaning is urgent.
      const { redactions } = redact(recordText(r));
      if (redactions.length && !r.redacted) {
        audit.hits++;
        for (const k of new Set(redactions)) audit.byKind[k] = (audit.byKind[k] || 0) + 1;
        if (audit.samples.length < 5) audit.samples.push(`${r.ts} ${r.tool || r.type}`);
      }
      continue;
    }

    if (!o.stats) {
      out.push(r);
      if (o.limit > 0 && out.length > o.limit) out.shift(); // keep the most recent N
    }
  }

  if (o.audit) {
    console.log(`log        ${logFile}`);
    console.log(`records    ${stats.total}`);
    console.log(`unredacted ${audit.hits} record(s) contain credential-shaped text`);
    for (const [k, v] of Object.entries(audit.byKind).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(v).padStart(6)}  ${k}`);
    }
    if (audit.samples.length) {
      console.log('earliest examples (timestamps only — the values are not printed):');
      for (const sample of audit.samples) console.log(`  ${sample}`);
    }
    if (!audit.hits) console.log('clean — no credential shapes found in this log');
    process.exit(audit.hits ? 1 : 0);
  }

  if (o.stats) {
    console.log(`log       ${logFile}`);
    console.log(`records   ${stats.matched} matched of ${stats.total}`);
    console.log(`range     ${stats.first || '-'}  ..  ${stats.last || '-'}`);
    console.log(`redacted  ${stats.redacted}`);
    const tools = Object.entries(stats.byTool).sort((a, b) => b[1] - a[1]).slice(0, 15);
    for (const [k, v] of tools) console.log(`  ${String(v).padStart(6)}  ${k}`);
    process.exit(stats.matched ? 0 : 1);
  }

  for (const r of out) console.log(o.json ? JSON.stringify(r) : fmt(r));
  if (!o.json && stats.matched > out.length) {
    console.log(`\n(${stats.matched} matched, showing last ${out.length} — use -n 0 for all)`);
  }
  process.exit(stats.matched ? 0 : 1);
}

main().catch((e) => { console.error(String(e && e.message || e)); process.exit(2); });
