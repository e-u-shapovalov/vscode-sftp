# ROADMAP / backlog

Post-1.0.0 work. Releases deliberately ship only verified fixes — everything below is
**pre-existing technical debt inherited from earlier forks**, to be done one at a
time with tests, not bundled into a release. Items marked ✅ were verified against the code in this
repo.

## Toolchain & dependency baseline (do this before runtime-dep bumps)
The pain here is not "old" but **inconsistent**: a 2020 TypeScript/toolchain against partially-newer
transitive `@types/*`. That mismatch is exactly why `tsc --noEmit` fails and why things "randomly
break". Don't chase latest-everything — fix the baseline in order, gated by a green build + tests:

1. **Dev toolchain first** (no runtime behavior change): bump `typescript` (3.9 → 5.x), `@types/node`
   (9 → match the Node we run), `@types/vscode` (1.40 → ≥1.64 to match `engines`), `ts-loader`,
   `webpack`. Expect ~5 small legacy fixes (readonly arrays, `EventEmitter.fire()` arity, `Uri` types)
   — see the `@types/vscode` note below. Optionally migrate `tslint` → eslint. Add `"strict"` /
   `skipLibCheck` deliberately.
2. **Fix the tests** so they're a real signal: `test/preprocessor.js` must return `{ code }` for
   jest@29/30; drop the stale `syncMode` / `watcher.autoDelete` assertions in `config.spec.js`.
3. **Only then** move runtime deps, one at a time with the (now working) tests green:
   `fs-extra` 10 → 11, `joi` 10 → 18 (**breaking**: `Joi.validate` was removed — `config.ts:126`
   needs rewriting), evaluate replacing the ancient `ftp@0.3.10` with `basic-ftp`.
   `ssh2` is already at latest (1.17).

Snapshot (for reference): typescript 3.9.7→6.x, @types/node 9→25.x, @types/vscode 1.40→1.120 (engines
^1.64.2), jest 29→30, webpack ^5.0.0→5.107, ts-loader 9.4→9.6, fs-extra 10.1→11.3, joi 10.6→18.2.

## High value (1.1)
- **Shared task Scheduler per FileService.** ✅ `createTransferScheduler` builds a *new* `Scheduler`
  per transfer call, so a watcher touching N files can open N concurrent transfers instead of
  honoring `concurrency`. Move the scheduler to a single per-service queue. Risk: server IP bans /
  crashes under load.
- **`MAX_OPEN_FD_NUM` is a module-global** (`sshClient.ts:9`). ✅ Multiple profiles with different
  `limitOpenFilesOnRemote` overwrite each other. Make it an instance field of `SSHClient`.
- **Explorer "View Content" reads the whole file into RAM** (`treeDataProvider.ts:231`,
  `buffer.toString()`). ✅ OOM / event-loop hang on huge files. Add a size cap or stream to a temp
  file.

## Medium
- **Secrets in `SecretStorage`.** Passwords currently live in plaintext in `sftp.json`. Adopt VS Code
  `SecretStorage` for credentials.
- **`bothDiretions` typo.** ✅ Internal `transferOption` field is misspelled (`transfer.ts`, tests,
  `fileCommandSyncBothDirections.ts`). NOTE: it is *internal* and consistent — users never type it in
  JSON (the command id `sftp.sync.bothDirections` is correct), so this is cosmetic. Rename when
  convenient.
- **Deep-merge profiles.** Profiles replace whole objects (e.g. `watcher`); a profile overriding one
  sub-key wipes the rest. Implement deep merge.

## Lower
- **FTP `lstat` is O(N)** — lists the whole parent dir to stat one file; slow in large folders.
- **`_limitSftpFileDescriptor` monkey-patches `ssh2` internals** — fragile across `ssh2` upgrades.
- **Upgrade `@types/vscode` 1.40 → 1.64** to match `engines`. Touches ~5 legacy spots (readonly
  arrays, `EventEmitter.fire()` arity, `Uri` types). For now `onDidDeleteFiles` is reached via a
  small typed handle in `extension.ts` to avoid that churn in the release.
- Switch ssh-config lookup to `.compute()` for full `Include`/`Match` support.

## Correctness & error handling
Two related blockers were **fixed in 1.0.0** (sshClient `.on('close', this.end())` TypeError;
`realpathSync` ENOENT on deleted paths in `toRemotePath`). The rest is backlog:

- **Upload Changed Files doesn't await its work.** `commandUploadChangedFiles.ts:98,116` — the
  `map()` callbacks don't return the promises, so upload/rename/delete are fire-and-forget and async
  errors are swallowed.
- **`createCommand` swallows errors.** ✅ `createCommand.ts:40` doesn't `return handleCommand.apply(...)`,
  so `Command.run()`'s `await` resolves before the work and `try/catch` never sees async errors. This
  is the root cause beneath the fire-and-forget item above; affects all normal commands (config,
  setProfile, uploadChangedFiles…). One-line change but touches every normal command — verify.
- **`renameRemote` uses local paths as remote, and the caller swaps old/new** (`rename.ts:9` uses
  `this.target.localFsPath` for a remote rename; `commandUploadChangedFiles.ts:108` passes `renameUri`
  as `originPath`). Git-rename sync is effectively broken.
- **`tsc --noEmit` fails** on the old `typescript@3.9` / `@types/node@9` vs newer lib types
  (`@types/fs-extra`, `@types/prettier`, `memfs`). Webpack release build is fine (ts-loader), but
  `skipLibCheck` is not set in `tsconfig.json`. Add it (and/or modernize the toolchain).
- **Tests are not a valid release signal.** `test/preprocessor.js:5` returns a string but jest@29
  needs `{ code }`; 3 suites fail to run. Fix the transformer.
- **"Upload to all profiles" confirm** only covers `file`/`folder`, not `activeFile`/`activeFolder`/
  `project`/`forceUpload` (`createCommand.ts:55,89`).
- **Inverted context menu** for `downloadWhenOpenInRemoteExplorer` (`treeDataProvider.ts:124` vs
  `package.json` menu `when`).
- **Fire-and-forget delete/chmod in sync** (`transfer.ts:89,369`) — command can report success before
  they finish, errors escape.
- **`removeRemote` awaits `undefined`** for unknown stat types (`remove.ts` switch default) — UI then
  refreshes as if the delete succeeded. Throw / skip `afterHandle` instead.

## Known bugs (pre-existing)
Spot-checked against the code. All inherited from upstream unless noted.

- **`isSubpathOf` / `isInWorkspace` lack a path-separator check** (`paths.ts:49,61`) — `indexOf(...) === 0`
  makes `/foo/bar` a subpath of `/foo/b`. Append `path.sep` before comparing.
- **`hashOption` stringifies values with `join('')`** (`remoteFs.ts:14`) — object values become
  `[object Object]`, key order isn't stable → connection-reuse collisions. Hash deterministically.
- **FTP `chmod` raw-command injection** (`ftpFileSystem.ts:142`) — `path` is interpolated unescaped
  into `CHMOD ...`. FTP-only; escape/validate.
- **`symlink` settles twice** (`sftpFileSystem.ts:255-259`) — `reject(err)` then `resolve()`. `reject`
  wins so the error isn't lost, but add `return` after reject.
- **Double upload: `uploadOnSave` ⊕ `watcher.autoUpload`.** `fileActivityMonitor` (onSave) and
  `fileWatcher` (onDidChange) both upload the same Ctrl+S — two concurrent `put`s to one remote path,
  no shared lock; paths differ (save uses `realpathSync.native`, watcher doesn't) so they don't even
  dedupe. Related: `uploadQueue` is a `Set<Uri>` (dedupes by object identity, not path string);
  `currentDownloadTasks` snapshot goes stale inside the async `forEach`; `task.localFsPath === uri.fsPath`
  is case-sensitive (misses on Windows).
- **Delete dialog hides what's deleted.** `onDidDeleteFiles` confirm shows only a count, no paths/host;
  if a folder is among targets, `removeRemote` → `removeDir` recurses on the server and can delete
  remote-only files that never existed locally. Show paths; handle folders explicitly.
- Low: `transferTask` `open(target,'w')` truncates the server file before reading mode when
  `useTempFile:false` (lost original if `put` then fails); `diff` from Remote Explorer shows an empty
  pane for files with no local copy; `replaceHomePath` only expands `~/` not `~\` (Windows
  `privateKeyPath`); duplicate/empty `context` silently overwrites in the service trie.
- Resource/leak items (TreeView/EventEmitter/StatusBar/outputChannel not disposed; `_map` unbounded;
  FD/stream leaks in `transferTask`/`fileBaseOperations`; zombie SSH hop clients; listener leak on
  reconnect) — audit `dispose()` coverage holistically.
- Security: path-traversal from a malicious server's listing (`uResource`/`treeDataProvider`); SSH
  hop `forwardOut` as open proxy. Lower priority but note for a hardening pass.

Investigated and **not** bugs (don't re-file): symlink double-settle (reject wins, cosmetic only), and
the service trie longest-prefix lookup (token-split, correct).

## Architecture — the highest-leverage fix
A single **per-service transfer pipeline**: route every source (save, watcher, command, delete)
through one debounced queue keyed by normalized path with an in-flight lock. This collapses the
double-upload race, the `Set<Uri>` dedupe bug, and the per-call `Scheduler` concurrency issue into one
fix.

## Considered for 1.0.1 (shipped)
- **Windows `ignore` fix** — `fileService.ts` built the local relative path with `path.relative`
  (backslashes), but the `ignore` package is POSIX-only, so dir patterns (`node_modules`, `.git`)
  didn't match → Upload Project would push `node_modules`, and Sync+delete silently skipped the filter.
  Fixed by using `upath.relative` (matches the remote branch). Critical for Windows users.
- **Delete local copy to Trash, not permanently** — `remove.ts` now uses
  `vscode.workspace.fs.delete(uri, { recursive: true, useTrash: true })`, so an accidental
  Remote-Explorer Delete is recoverable.

## Ideas
- Explicit `deleteSync: "off" | "confirm" | "always"` setting, plus `externalDeletes: false`, instead
  of the current always-confirm behavior.
- Dry-run summary for **Upload Changed Files**: show create/upload/delete/rename before running.
- Queue + retry (exponential backoff) for failed transfers; diff-before-overwrite; bandwidth throttle;
  auto-pick up `.gitignore`/`.sftpignore`.
