const { parseSentinelCode, sanitizeSuOutput } = require('../src/helper/suOutput');

const SENTINEL = '__WF_RC_';

// The exit code of a root command is read from a sentinel echoed after it. These guard the two bugs
// all reviewers converged on: a false marker earlier in the output must not win, and nothing secret
// (the password) may survive into the returned/logged buffer.
describe('parseSentinelCode', () => {
  test('reads the exit code from the marker', () => {
    expect(parseSentinelCode(`ok\n${SENTINEL}0__\n`, SENTINEL)).toBe(0);
    expect(parseSentinelCode(`${SENTINEL}1__`, SENTINEL)).toBe(1);
  });

  test('takes the LAST marker, not the first (a path/stderr may contain the pattern)', () => {
    // chown printing a failing path that looks like a marker, then the real marker with the real code
    const out = `chown: cannot access '/tmp/note__WF_RC_99__': No such file\n${SENTINEL}1__\n`;
    expect(parseSentinelCode(out, SENTINEL)).toBe(1);
  });

  test('null when no marker (command never ran — e.g. auth failure)', () => {
    expect(parseSentinelCode('su: Authentication failure', SENTINEL)).toBeNull();
    expect(parseSentinelCode('', SENTINEL)).toBeNull();
  });
});

describe('sanitizeSuOutput', () => {
  test('removes an echoed password', () => {
    const s = sanitizeSuOutput(`Password: hunter2\ndone\n${SENTINEL}0__`, 'hunter2', SENTINEL);
    expect(s).not.toMatch(/hunter2/);
  });

  test('removes the sentinel markers', () => {
    expect(sanitizeSuOutput(`x\n${SENTINEL}0__\n`, 'pw', SENTINEL)).not.toMatch(/__WF_RC_/);
  });

  test('removes standalone Password: prompt lines', () => {
    expect(sanitizeSuOutput('Password:\nreal error here', 'pw', SENTINEL)).toBe('real error here');
  });

  test('keeps the real command error text', () => {
    const s = sanitizeSuOutput(`chmod: cannot access '/etc/x': Operation not permitted\n${SENTINEL}1__`, 'pw', SENTINEL);
    expect(s).toBe("chmod: cannot access '/etc/x': Operation not permitted");
  });

  test('strips even a short password (no length gate) — a possible tty echo must not leak', () => {
    // security over cosmetics: a 1-char password is still removed, even if it mangles legit output
    expect(sanitizeSuOutput("echoed: 5", '5', SENTINEL)).not.toMatch(/5/);
  });

  test('marker is stripped even when the password overlaps its characters', () => {
    // password overlaps "WF_RC": markers are removed FIRST, so no fragment leaks
    const s = sanitizeSuOutput(`done\n${SENTINEL}1__`, 'WF_RC', SENTINEL);
    expect(s).toBe('done');
    expect(s).not.toMatch(/__|WF|RC/);
  });

  test('tolerates a sentinel containing regex-special characters', () => {
    const weird = '<<rc.$>>';
    expect(parseSentinelCode(`x\n${weird}7__`, weird)).toBe(7);
    expect(sanitizeSuOutput(`x\n${weird}7__`, 'pw', weird)).toBe('x');
  });
});
