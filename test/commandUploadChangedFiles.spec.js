// "Upload Changed Files" fans out over every git change. Each uploadFile/renameRemote/removeRemote
// builds its own transfer Scheduler, so a Promise.all over N changes opened N transfers at once,
// ignoring `concurrency` (can trip sshd MaxSessions / get IP-banned on shared hosting). The command
// must run its per-file work sequentially. This spec drives the real handler with instrumented
// handlers that record the peak number of operations in flight, and asserts it never exceeds 1.
//
// The `.js` specs are not run through babel-jest (the jest `transform` only maps `.ts`), so
// `jest.mock` is NOT hoisted — the mocks below register in source order, before the module is
// required at the bottom, exactly like test/ext.spec.js.

let inFlight = 0;
let maxInFlight = 0;
const calls = { upload: 0, rename: 0, remove: 0 };

function resetInstrumentation() {
  inFlight = 0;
  maxInFlight = 0;
  calls.upload = 0;
  calls.rename = 0;
  calls.remove = 0;
}

// A hoisted function declaration so the mock factories can reference it regardless of order.
async function instrument(kind) {
  calls[kind] += 1;
  inFlight += 1;
  maxInFlight = Math.max(maxInFlight, inFlight);
  // A real await window so overlapping calls would actually overlap: with Promise.all every call
  // reaches this point before the first delay resolves (peak === N); serialized, peak stays 1.
  await new Promise(resolve => setTimeout(resolve, 5));
  inFlight -= 1;
}

// Distinct numeric tags; only internal consistency matters (the switch compares against this same
// object the test builds its changes from).
const Status = {
  INDEX_MODIFIED: 0,
  INDEX_ADDED: 1,
  INDEX_DELETED: 2,
  INDEX_RENAMED: 3,
  MODIFIED: 5,
  DELETED: 6,
  UNTRACKED: 7,
};

jest.mock(
  'vscode',
  () => ({
    window: {
      // The deletes branch confirms first: return the confirm action label (3rd arg) so the
      // deletions proceed and their fan-out is exercised too.
      showWarningMessage: (_msg, _opts, confirmLabel) => Promise.resolve(confirmLabel),
    },
  }),
  { virtual: true }
);

jest.mock('../src/modules/git', () => ({
  getGitService: () => ({ repositories: [] }),
  Status,
}));
jest.mock('../src/modules/serviceManager', () => ({ getFileService: () => ({}) }));
jest.mock('../src/fileHandlers', () => ({
  uploadFile: () => instrument('upload'),
  renameRemote: () => instrument('rename'),
  removeRemote: () => instrument('remove'),
}));
jest.mock('../src/commands/abstract/createCommand', () => ({ checkCommand: a => a }));
jest.mock('../src/logger', () => ({ default: { log() {}, error() {}, warn() {} } }));
jest.mock('../src/helper', () => ({ simplifyPath: p => p }));
jest.mock('../src/i18n', () => ({ L: o => (o && o.en) || '' }));
jest.mock('../src/constants', () => ({ COMMAND_UPLOAD_CHANGEDFILES: 'wireferry.upload.changedFiles' }));

const command = require('../src/commands/commandUploadChangedFiles').default;

function uri(p) {
  return { fsPath: p };
}

function change(status, p) {
  const c = { status, uri: uri(p) };
  if (status === Status.INDEX_RENAMED) {
    c.originalUri = uri(p);
    c.renameUri = uri(`${p}.renamed`);
  }
  return c;
}

// Drive the command with a Repository hint (has `rootUri`) so it uses that repo directly and never
// touches the QuickPick/repository-selection path.
function repositoryWith(changes) {
  return {
    rootUri: uri('/repo'),
    state: { indexChanges: [], workingTreeChanges: changes },
  };
}

describe('Upload Changed Files — sequential fan-out', () => {
  beforeEach(resetInstrumentation);

  test('runs uploads, renames and deletes one at a time (peak in-flight === 1)', async () => {
    const changes = [
      change(Status.MODIFIED, '/repo/a.txt'),
      change(Status.MODIFIED, '/repo/b.txt'),
      change(Status.MODIFIED, '/repo/c.txt'),
      change(Status.UNTRACKED, '/repo/new.txt'),
      change(Status.INDEX_RENAMED, '/repo/r1.txt'),
      change(Status.INDEX_RENAMED, '/repo/r2.txt'),
      change(Status.DELETED, '/repo/d1.txt'),
      change(Status.DELETED, '/repo/d2.txt'),
    ];

    await command.handleCommand(repositoryWith(changes));

    // Every change was actually processed…
    expect(calls.upload).toBe(4); // 3 modified + 1 untracked
    expect(calls.rename).toBe(2);
    expect(calls.remove).toBe(2);
    // …and never more than one transfer was open at once.
    expect(maxInFlight).toBe(1);
  });
});
