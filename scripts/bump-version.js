#!/usr/bin/env node
'use strict';

/*
 * Bump the extension version everywhere it is a *pointer*, in one command.
 *
 *   node scripts/bump-version.js <new-version> [--dry]
 *   npm run bump -- <new-version>
 *
 * Touches:
 *   - package.json + package-lock.json   via `npm version` (only the project's own version field —
 *                                        dependency versions in the lockfile are never changed).
 *   - *.md                               the install/download pointers only:
 *                                          `wireferry-<v>.vsix`  and  `/v<v>/`
 *
 * Leaves alone (these are plain version strings, not pointers):
 *   - CHANGELOG / README history: "## <v>" headings, "What's New" entries, "in version <v>" prose.
 *
 * Prints a report of every pointer it changed, plus every other place the old version still appears
 * so you can confirm the leftovers are release history. The new CHANGELOG section and the README
 * "What's New" line are still written by hand.
 *
 * --dry previews the report and writes nothing.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const fail = msg => {
  console.error(`bump-version: ${msg}`);
  process.exit(1);
};
const read = p => fs.readFileSync(p, 'utf8');
const lineAt = (text, off) => text.slice(0, off).split('\n').length;

const argv = process.argv.slice(2);
const dry = argv.includes('--dry') || argv.includes('-n');
const next = argv.find(a => !a.startsWith('-'));

if (!next) fail('usage: node scripts/bump-version.js <new-version> [--dry]');
if (!/^\d+\.\d+\.\d+$/.test(next)) fail(`"${next}" is not an X.Y.Z version`);

const pkgPath = path.join(root, 'package.json');
const cur = JSON.parse(read(pkgPath)).version;
if (!cur) fail('package.json has no "version"');
if (cur === next) fail(`already at ${next}`);

const lockPath = path.join(root, 'package-lock.json');
const hasLock = fs.existsSync(lockPath);
const lockCur = hasLock ? JSON.parse(read(lockPath)).version || '(unset)' : null;

// Current-version references we DO bump. Both patterns are install/download pointers and never
// collide with dependency versions or with historical version mentions in the docs.
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const c = esc(cur);
const pointers = [
  { what: '.vsix file', re: new RegExp(`wireferry-${c}\\.vsix`, 'g'), to: `wireferry-${next}.vsix` },
  { what: 'release URL', re: new RegExp(`/v${c}/`, 'g'), to: `/v${next}/` },
];

const changed = []; // { file, line, what, before, after }
const leftover = []; // { file, line, text }

// 1) package.json + package-lock.json — delegate to npm so only the project's own version moves
//    (and a lockfile whose version drifted behind package.json gets re-synced for free).
if (!dry) {
  try {
    execSync(`npm version ${next} --no-git-tag-version --ignore-scripts`, { cwd: root, stdio: 'pipe' });
  } catch (e) {
    fail(`npm version failed: ${e.stderr ? e.stderr.toString().trim() : e.message}`);
  }
}
changed.push({ file: 'package.json', line: '', what: 'version', before: cur, after: next });
if (hasLock) changed.push({ file: 'package-lock.json', line: '', what: 'version', before: lockCur, after: next });

// 2) docs pointers + leftover scan, across tracked text files only (git ls-files skips node_modules).
const tracked = execSync('git ls-files', { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
for (const rel of tracked) {
  if (!/\.(md|json|jsonc|ts|js)$/i.test(rel)) continue;
  if (rel === 'package.json' || rel === 'package-lock.json') continue; // handled via npm above
  const abs = path.join(root, rel);
  let text;
  try {
    text = read(abs);
  } catch {
    continue;
  }

  let out = text;
  for (const p of pointers) {
    out = out.replace(p.re, (m, off) => {
      changed.push({ file: rel, line: lineAt(text, off), what: p.what, before: m, after: p.to });
      return p.to;
    });
  }
  if (!dry && out !== text) fs.writeFileSync(abs, out);

  // Report any remaining mention of the old version after the pointer replacement, so leftovers
  // can be eyeballed. Scan `out` (the post-replace text) in both modes so --dry previews reality.
  out.split('\n').forEach((ln, i) => {
    if (ln.includes(cur)) leftover.push({ file: rel, line: i + 1, text: ln.trim() });
  });
}

// 3) report
const tag = dry ? '[dry-run] ' : '';
console.log(`\n${tag}WireFerry version bump: ${cur} -> ${next}\n`);

console.log(`Changed pointers (${changed.length}):`);
for (const ch of changed) {
  const loc = ch.line ? `${ch.file}:${ch.line}` : ch.file;
  console.log(`  ${loc.padEnd(34)} ${ch.what.padEnd(12)} ${ch.before} -> ${ch.after}`);
}

console.log(`\nOld version "${cur}" still present elsewhere (${leftover.length}) — should be release history, verify:`);
if (leftover.length === 0) {
  console.log('  (none)');
} else {
  for (const lo of leftover) {
    const t = lo.text.length > 90 ? lo.text.slice(0, 87) + '...' : lo.text;
    console.log(`  ${(lo.file + ':' + lo.line).padEnd(20)} ${t}`);
  }
}

console.log('\nStill to do by hand:');
console.log(`  - add a "## ${next}" section to CHANGELOG.md and a "What's New" line (RU + EN)`);
console.log('  - rebuild: npm run compile  (the .vsix version must differ from the installed one)');
if (dry) console.log('\n(dry run — nothing written)');
console.log('');
