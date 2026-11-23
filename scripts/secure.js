#!/usr/bin/env node
/**
 * CLERK — log permissions: verify first, and never claim what was not measured.
 *
 * v1.1.0's installer called `chmod 0600` and printed "Tightened N log file(s) to 0600". On Windows
 * (Git Bash) that is theatre: `chmod` does not change NTFS access at all — a live test on one of our
 * machines showed the mode string unchanged AND the real ACL still granting Modify to a sandbox group
 * and two unresolved SIDs. So the installer would have reported success having changed nothing, on
 * the machine holding the most unredacted history. That is worse than doing nothing, because it is
 * the message people stop worrying after.
 *
 * Two rules, and they are the same two the redactor follows:
 *
 *   1. MEASURE, don't assume. After any change, read the permissions back and compare. A syscall
 *      that returned 0 is not evidence that access changed.
 *   2. Hardening is OPT-IN. `check()` only looks; `harden()` rewrites. Rewriting an ACL can lock out
 *      a process that legitimately reads these files, so it is a decision for the operator, not a
 *      side effect of running an installer.
 *
 * WIN32 STATUS — executed and observed, not assumed. Run on win32 10.0.26200 / node 22.16.0 on
 * 2026-08-17 by a colleague at the keyboard, because the author has no Windows machine:
 *
 *   as created   6 principals — a sandbox group and two unresolved SIDs arriving by INHERITANCE,
 *                plus SYSTEM / Administrators / the user.  check() -> ok:false, 3 others
 *   harden()     /inheritance:r genuinely removes them.    check() -> ok:true, others []
 *   missing file icacls exit 2 -> check() -> ok:null       (never ok:true — it fails safe)
 *   node mode    0o666, confirming POSIX bits are meaningless here
 *
 * The first version of harden() granted only the user and therefore stripped SYSTEM and
 * Administrators as well. That was found by running it, not by reading it.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const isWin = process.platform === 'win32';

/** Principals that may legitimately retain access on Windows. */
const ALLOWED_WIN = [
  (process.env.USERNAME || '').toLowerCase(),
  'nt authority\\system',
  'builtin\\administrators',
  'administrators',
  'system',
];

/**
 * Report who can reach `file`. Never modifies anything.
 * Returns { platform, ok, detail, others }.
 *   ok === true   -> access is restricted to the owner (+ SYSTEM/Administrators on Windows)
 *   ok === null   -> could not determine. NOT the same as ok, and callers must not treat it as ok.
 */
function check(file) {
  if (!fs.existsSync(file)) return { platform: process.platform, ok: null, detail: 'file not found', others: [] };

  if (!isWin) {
    let mode;
    try { mode = fs.statSync(file).mode & 0o777; } catch (e) { return { platform: 'posix', ok: null, detail: e.message, others: [] }; }
    const octal = mode.toString(8).padStart(3, '0');
    return {
      platform: 'posix',
      ok: (mode & 0o077) === 0,
      detail: `mode ${octal}`,
      others: (mode & 0o077) === 0 ? [] : [`group/other bits set (${octal})`],
    };
  }

  const r = spawnSync('icacls', [file], { encoding: 'utf8' });
  if (r.error || r.status !== 0) {
    return { platform: 'win32', ok: null, detail: `icacls unavailable or failed: ${(r.error && r.error.message) || r.stderr || r.status}`, others: [] };
  }
  // Lines look like:  C:\path\file NT AUTHORITY\SYSTEM:(I)(F)
  const others = [];
  for (const line of r.stdout.split(/\r?\n/)) {
    const m = /^(?:\S.*?\s)?([^:]+):\(/.exec(line.trim());
    if (!m) continue;
    const who = m[1].trim().toLowerCase();
    if (!who) continue;
    const bare = who.includes('\\') ? who.split('\\').pop() : who;
    if (ALLOWED_WIN.includes(who) || ALLOWED_WIN.includes(bare)) continue;
    others.push(m[1].trim());
  }
  return {
    platform: 'win32',
    ok: others.length === 0,
    detail: others.length ? `${others.length} other principal(s) retain access` : 'restricted to owner/SYSTEM/Administrators',
    others,
  };
}

/**
 * Restrict `file` to its owner, then VERIFY by reading the permissions back.
 * Returns the post-change check() result, plus what was attempted.
 */
function harden(file) {
  const attempted = [];
  if (!isWin) {
    try { fs.chmodSync(file, 0o600); attempted.push('chmod 0600'); }
    catch (e) { attempted.push(`chmod failed: ${e.message}`); }
  } else {
    const user = process.env.USERNAME || os.userInfo().username;
    // /inheritance:r drops inherited ACEs — on the machine we probed those were a sandbox group and
    // two unresolved SIDs, all arriving by inheritance from the parent directory.
    //
    // SYSTEM and Administrators are re-granted explicitly. The first version of this granted ONLY
    // the user, and the probe showed the result: `MACHINE\user:(F)` alone, with SYSTEM and
    // Administrators removed too. That is not the platform norm — backup, indexing and AV run as
    // SYSTEM, and an administrator who cannot read the file has to take ownership to recover it.
    // The real Clerk logs on that machine already sit at exactly {Administrators, SYSTEM, user},
    // so that is the correct target state rather than a lockout.
    const grants = [
      '/grant:r', `${user}:(F)`,
      '/grant:r', 'SYSTEM:(F)',
      '/grant:r', 'Administrators:(F)',
    ];
    const r = spawnSync('icacls', [file, '/inheritance:r', ...grants], { encoding: 'utf8' });
    attempted.push(r.status === 0
      ? `icacls /inheritance:r /grant:r ${user}:(F) SYSTEM:(F) Administrators:(F)`
      : `icacls failed (exit ${r.status}): ${(r.stderr || '').trim() || '(no stderr)'}`);
  }
  // The whole point: the result is whatever reading it back says, not whatever the call returned.
  return { attempted, verified: check(file) };
}

module.exports = { check, harden, isWin };
