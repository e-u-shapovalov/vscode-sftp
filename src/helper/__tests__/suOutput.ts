import {
  stripBeforeBegin,
  sanitizeSuOutput,
  parseSentinelCode,
  stripTrailingSentinel,
  isAuthPasswordPrompt,
} from '../suOutput';

describe('suOutput', () => {
  describe('stripBeforeBegin', () => {
    it('drops login-shell noise (MOTD/profile) before the begin marker', () => {
      const raw = 'Welcome to Ubuntu\nMOTD line\n__WF_BEGIN__\nreal output\n';
      expect(stripBeforeBegin(raw, '__WF_BEGIN__')).toBe('real output\n');
    });
    it('returns the input unchanged when the marker is absent', () => {
      expect(stripBeforeBegin('no marker here', '__WF_BEGIN__')).toBe('no marker here');
    });
    it('uses the FIRST marker (the echoed one), keeping later data that repeats it intact', () => {
      const raw = '__WF_BEGIN__\ndata with __WF_BEGIN__ inside\n';
      expect(stripBeforeBegin(raw, '__WF_BEGIN__')).toBe('data with __WF_BEGIN__ inside\n');
    });
  });

  describe('sanitizeSuOutput', () => {
    it('strips the sentinel marker and trims', () => {
      expect(sanitizeSuOutput('out__WF_RC_0__', '', '__WF_RC_')).toBe('out');
    });
    it('strips the password when given (defence in depth for error/log text)', () => {
      expect(sanitizeSuOutput('a s3cret b', 's3cret', '__WF_RC_')).toBe('a  b');
    });
    it('keeps content INTACT when password is empty (the rawOutput data path)', () => {
      // The regression this guards: a config value that contains the su password must NOT be mangled when
      // the output is read as data (rawOutput=true → password passed as '' → no strip).
      expect(sanitizeSuOutput('server_port=51234\nadmin_pin=1234', '', '__WF_RC_')).toBe(
        'server_port=51234\nadmin_pin=1234'
      );
    });
  });

  describe('stripTrailingSentinel', () => {
    it('drops ONLY the trailing exit-code marker, leaving content byte-for-byte', () => {
      // Marker echoed right after a file whose last line has no newline of its own.
      expect(stripTrailingSentinel('port=22\nkey=/etc/x__WF_RC_0__\n', '__WF_RC_')).toBe('port=22\nkey=/etc/x');
    });
    it('preserves a leading indent and a trailing newline (no trim, unlike sanitizeSuOutput)', () => {
      expect(stripTrailingSentinel('  indented\n\n__WF_RC_0__\n', '__WF_RC_')).toBe('  indented\n\n');
    });
    it('leaves a marker-like substring EARLIER in the data intact (anchored to end)', () => {
      expect(stripTrailingSentinel('a__WF_RC_5__b\n__WF_RC_0__\n', '__WF_RC_')).toBe('a__WF_RC_5__b\n');
    });
  });

  describe('isAuthPasswordPrompt', () => {
    const MARK = '__WF_BEGIN_x9z__';
    it("matches su's prompt during the auth phase (before the begin marker)", () => {
      expect(isAuthPasswordPrompt('Password: ', MARK)).toBe(true);
      expect(isAuthPasswordPrompt('su noise\nPassword:', MARK)).toBe(true);
    });
    it('the begin-marker gate suppresses an indented "password:" config line in the command output', () => {
      // The regression (passwordless su): an indented `password:` (a YAML key) WOULD match the prompt regex,
      // so during the auth phase it reads as the prompt (correct then)…
      expect(isAuthPasswordPrompt('  password:', MARK)).toBe(true);
      // …but AFTER the begin marker the SAME line is command DATA, not su's prompt — matching it there would
      // send the password into the running command, truncate the read, and can leak it. The gate blocks that.
      expect(isAuthPasswordPrompt(`${MARK}\n  password:`, MARK)).toBe(false);
    });
    it('rejects a banner line where "password:" is not at the line start', () => {
      expect(isAuthPasswordPrompt('change your password:', MARK)).toBe(false);
    });
  });

  describe('parseSentinelCode', () => {
    it('reads the LAST sentinel code (real marker is echoed after the command)', () => {
      expect(parseSentinelCode('__WF_RC_1__ mid __WF_RC_0__', '__WF_RC_')).toBe(0);
    });
    it('returns null when there is no sentinel (command never ran)', () => {
      expect(parseSentinelCode('nothing here', '__WF_RC_')).toBeNull();
    });
  });
});
