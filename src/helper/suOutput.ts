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
export function sanitizeSuOutput(raw: string, password: string, sentinel: string): string {
  let s = raw
    .replace(new RegExp(`${escapeRegExp(sentinel)}\\d+__`, 'g'), '')
    .replace(/^[^\S\r\n]*password:[^\S\r\n]*$/gim, '');
  if (password) {
    s = s.split(password).join('');
  }
  return s.trim();
}
