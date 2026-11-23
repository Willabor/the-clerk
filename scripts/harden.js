#!/usr/bin/env node
/**
 * CLERK — restrict access to existing logs, then prove it.
 *
 * Usage:  npm run harden -- [--root <dir>]...            REPORT only (default)
 *         npm run harden -- --apply [--root <dir>]...    actually change permissions
 *
 * Report is the default deliberately. On Windows the change is `icacls /inheritance:r /grant:r`,
 * which DROPS inherited access — and on at least one of our machines the inherited principals
 * include a sandbox group that may be how an agent runs. Removing it could lock out a process that
 * legitimately reads these files. So: show what would change, let a human decide, then --apply.
 *
 * Every file is re-read after the change. A syscall that returned 0 is not evidence that access
 * changed — on Git Bash for Windows, `chmod 600` returns 0 and changes nothing at all.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { check, harden, isWin } = require('./secure');

const args = process.argv.slice(2);
const roots = [];
let apply = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--root') roots.push(args[++i]);
  else if (args[i] === '--apply') apply = true;
}

/**
 * Locate Clerk logs under `root`.
 *
 * Returns { logs, unreadable } — the second half matters as much as the first. A directory this
 * walk could not open might hold logs, and reporting only what was found lets "0 exposed" mean
 * "nothing was looked at". Absence of a finding is not a finding of absence.
 *
 * Two things this deliberately handles, because the REAL log paths hit both and the temp-file
 * unit test does not:
 *   - a --root pointing straight at a .jsonl file (not a directory to search)
 *   - directory SYMLINKS and Windows JUNCTIONS. `dirent.isDirectory()` is false for both, so the
 *     original walk stepped over them in silence — and a Dropbox-hosted log folder is exactly the
 *     kind of path that is a junction. Followed here, with a realpath visited-set against cycles.
 */
function findLogs(root, depth = 6) {
  const out = [];
  const unreadable = [];
  const seen = new Set();

  const collect = (dir) => {
    try { for (const f of fs.readdirSync(dir)) if (f.endsWith('.jsonl')) out.push(path.join(dir, f)); }
    catch (e) { unreadable.push(`${dir} (${e.code || e.message})`); }
  };

  const walk = (dir, d) => {
    if (d < 0) return;
    let real; try { real = fs.realpathSync(dir); } catch (e) { unreadable.push(`${dir} (${e.code || e.message})`); return; }
    if (seen.has(real)) return;            // a junction pointing back up must not loop forever
    seen.add(real);

    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (e) { unreadable.push(`${dir} (${e.code || e.message})`); return; }

    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const full = path.join(dir, e.name);
      // isDirectory() is false for a symlink/junction to a directory — stat through it.
      let isDir = e.isDirectory();
      if (!isDir && e.isSymbolicLink()) {
        try { isDir = fs.statSync(full).isDirectory(); } catch { continue; }
      }
      if (!isDir) continue;
      if (e.name === 'clerk' && path.basename(dir) === '.claude') { collect(full); continue; }
      walk(full, d - 1);
    }
  };

  // A --root may name the log file itself rather than a tree to search.
  let st; try { st = fs.statSync(root); } catch (e) { return { logs: [], unreadable: [`${root} (${e.code || e.message})`] }; }
  if (st.isFile()) return { logs: [root], unreadable: [] };

  walk(root, depth);
  return { logs: out, unreadable };
}

const scanned = roots.length
  ? roots.map((r) => findLogs(r))
  : [findLogs(path.join(process.cwd()), 2)];
const logs = [...new Set(scanned.flatMap((s) => s.logs))];
const unreadable = [...new Set(scanned.flatMap((s) => s.unreadable))];

if (unreadable.length) {
  console.log(`⚠️  ${unreadable.length} location(s) could NOT be searched — anything there is UNKNOWN, not clean:`);
  for (const u of unreadable) console.log(`        ${u}`);
  console.log('');
}

if (!logs.length) {
  console.error(roots.length ? `no logs found under: ${roots.join(', ')}` : 'no logs found in this project');
  console.error('that is not the same as "no logs exist" — pass every --root you actually work in');
  if (unreadable.length) console.error('and some locations above could not be read at all, so this search was incomplete');
  process.exit(2);
}

let ok = 0, failed = 0, unknown = 0;
for (const f of logs) {
  if (!apply) {
    const cur = check(f);
    const status = cur.ok === true ? 'ok     ' : cur.ok === null ? 'UNKNOWN' : 'EXPOSED';
    console.log(`${status} ${f}`);
    console.log(`        current: ${cur.detail}${cur.others.length ? ' -> ' + cur.others.join(', ') : ''}`);
    if (cur.ok === true) ok++; else if (cur.ok === null) unknown++; else failed++;
    continue;
  }
  const { attempted, verified } = harden(f);
  const status = verified.ok === true ? 'OK     ' : verified.ok === null ? 'UNKNOWN' : 'FAILED ';
  console.log(`${status} ${f}`);
  console.log(`        attempted: ${attempted.join('; ')}`);
  console.log(`        verified : ${verified.detail}${verified.others.length ? ' -> ' + verified.others.join(', ') : ''}`);
  if (verified.ok === true) ok++; else if (verified.ok === null) unknown++; else failed++;
}
if (!apply) {
  console.log(`\n${logs.length} log(s): ${ok} restricted, ${failed} exposed, ${unknown} undetermined  [REPORT ONLY]`);
  console.log('nothing was changed. Re-run with --apply to change permissions.');
  console.log('review first: on Windows --apply drops INHERITED access, which may include a group an agent runs as.');
} else {
  console.log(`\n${logs.length} log(s): ${ok} restricted, ${failed} still reachable, ${unknown} undetermined`);
}
if (isWin) console.log('win32: confirm independently with `icacls <path>` — do not take this tool\'s word for it');
// Exit non-zero unless every file was VERIFIED restricted. "Undetermined" is not success.
process.exit(failed || unknown || unreadable.length ? 1 : 0);
