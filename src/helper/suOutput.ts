// Pure helpers for reading and sanitizing the PTY output of a `su -` exec (see SSHClient.execRoot).
// Kept separate from the client so they can be unit-tested without a real ssh session — this is the
// exact logic (exit-code marker + secret stripping) that must not regress.

// Escape a literal so it can be embedded in a RegExp — the sentinel is a fixed constant today, but the
// helpers take it as a parameter, so don't assume it's regex-safe.
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The exit code carried by the LAST sentinel marker in `output`. The real marker is echoed after the
// command, so command/stderr text that happens to contain the pattern earlier (e.g. a failing path
// named like the marker) must not win. Returns null when no marker is present (command never ran).
export function parseSentinelCode(output: string, sentinel: string): number | null {
  const re = new RegExp(`${escapeRegExp(sentinel)}(\\d+)__`, 'g');
  let m: RegExpExecArray | null;
  let last: RegExpExecArray | null = null;
  // tslint:disable-next-line no-conditional-assignment
  while ((m = re.exec(output)) !== null) {
    last = m;
  }
  return last ? parseInt(last[1], 10) : null;
}

// Strip anything secret or noisy before `output` is returned or put in an error/log. Order matters:
// remove the FIXED, known text first (sentinel markers, standalone "Password:" prompt lines), THEN the
// password — otherwise a password that overlaps the marker characters would corrupt the marker so its
// removal misses and a fragment leaks. The password strip is defence in depth: su normally keeps tty
// echo off and execRoot already discards the auth phase, but a tty that leaves echo on could echo the
// password into the post-clear buffer — so strip EVERY length (a short password mangling some legit
// output on error is a cheaper price than leaking the root password).
// Discard everything up to and including the "begin" marker — drops login-shell noise (MOTD, /etc/profile
// or .bashrc echoes) that `su -` prints BEFORE the command runs, so a data command's stdout starts clean.
// The marker is echoed right after auth and before the command, so the FIRST occurrence is the real one.
export function stripBeforeBegin(output: string, beginMarker: string): string {
  const idx = output.indexOf(beginMarker);
  if (idx === -1) {
    return output;
  }
  return output.slice(idx + beginMarker.length).replace(/^\r?\n/, '');
}

// Drop ONLY the exit-code marker WE appended at the very end (and the trailing newline echo added) —
// nothing else. Anchored to end-of-string, so a marker-like substring earlier in real data is left intact.
// Used for the rawOutput (data) path, where the command's stdout must be returned VERBATIM: no trim (would
// eat leading indent / a trailing newline), no password strip, no GLOBAL marker strip (which would mangle a
// file/name that merely contains the marker pattern).
export function stripTrailingSentinel(output: string, sentinel: string): string {
  return output.replace(new RegExp(`${escapeRegExp(sentinel)}\\d+__\\s*$`), '');
}

// True when `output` (the accumulated su PTY text) currently ends in su's password prompt AND we are still in
// the auth phase — the begin marker (echoed only AFTER auth, right before the command) has NOT appeared yet.
// The prompt is "Password: " with no trailing newline; anchor to a line start so a banner like "change your
// password:" doesn't match, and strip \r for PTYs that end lines with CR. Once the begin marker is present su
// has already run the command, so a "password:" in the command's OWN output is DATA — matching it there would
// push the password into the running command, truncate the captured output, and (a passwordless su with tty
// echo on) leak it into the returned bytes; hence the begin-marker gate.
export function isAuthPasswordPrompt(output: string, beginMarker: string): boolean {
  if (output.includes(beginMarker)) {
    return false;
  }
  return /(^|\n)[^\S\r\n]*password:[^\S\r\n]*$/i.test(output.replace(/\r/g, ''));
}

export function sanitizeSuOutput(raw: string, password: string, sentinel: string): string {
  let s = raw
    .replace(new RegExp(`${escapeRegExp(sentinel)}\\d+__`, 'g'), '')
    .replace(/^[^\S\r\n]*password:[^\S\r\n]*$/gim, '');
  if (password) {
    s = s.split(password).join('');
  }
  return s.trim();
}
