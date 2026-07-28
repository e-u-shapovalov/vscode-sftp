# ROADMAP / backlog

Post-1.0.0 work. Releases deliberately ship only verified fixes — everything below is
**pre-existing technical debt inherited from earlier forks**, to be done one at a
time with tests, not bundled into a release. Items marked ✅ were verified against the code in this
repo.

## Toolchain & dependency baseline — ✅ steps 1–2 DONE (1.1.1 / 2.x)
The dev toolchain was modernized (TypeScript 3.9 → 5.9, `@types/node` 9 → 18, `@types/vscode`
1.40 → 1.66, jest 29.7, webpack 5.107, `skipLibCheck` on): `tsc --noEmit` now passes and the jest
suite runs. Only the runtime-dep bumps (step 3) remain:

1. ✅ **Dev toolchain** — done (TypeScript 5.9, `@types/node` 18, `@types/vscode` 1.66, ts-loader,
   webpack updated, `skipLibCheck` set). `tslint` → eslint migration is still optional.
2. ✅ **Tests run** — `test/preprocessor.js` returns `{ code }` for jest@29; the stale
   `syncMode` / `watcher.autoDelete` assertions are gone. (One test is `skip`ped — see below.)
3. **Runtime deps, one at a time with tests green.**
   ✅ `joi` 10.6.0 → 17.13.4 is done in 2.5.5: the removed `Joi.validate` API was migrated to a
   compiled schema instance, the production schema was isolated for direct tests, and the vulnerable
   old `hoek` / `topo` chain is gone. Joi 18 is not suitable while VS Code 1.66 / Node 16 remains the
   compatibility floor because Joi 18 requires Node 20. Remaining: `fs-extra` 10 → 11 and evaluate
   replacing the ancient `ftp@0.3.10` with `basic-ftp`. `ssh2` is already at latest (1.17).

Snapshot (for reference): typescript 3.9.7→6.x, @types/node 9→25.x, @types/vscode 1.40→1.120 (engines
^1.64.2), jest 29→30, webpack ^5.0.0→5.107, ts-loader 9.4→9.6, fs-extra 10.1→11.3. Joi is now
17.13.4; 18.x remains blocked by its Node 20 floor.

## High value (1.1)
- **Shared task Scheduler per FileService.** ✅ `createTransferScheduler` builds a *new* `Scheduler`
  per transfer call, so a watcher touching N files can open N concurrent transfers instead of
  honoring `concurrency`. Move the scheduler to a single per-service queue. Risk: server IP bans /
  crashes under load.
- ✅ **`MAX_OPEN_FD_NUM` is now an `SSHClient` instance field.** Profiles no longer overwrite each
  other's `limitOpenFilesOnRemote`.
- ✅ **Explorer preview has a hard byte cap.** Unknown-size and oversized files are refused before
  they can be buffered into RAM.

## Medium
- ✅ **Secrets in `SecretStorage`.** Passwords and key passphrases can use VS Code SecretStorage;
  plaintext and prompt modes remain available for compatibility and explicit user choice.
- ✅ **FIXED: `bothDiretions` typo renamed** to `bothDirections` across `transfer.ts`,
  `fileCommandSyncBothDirections.ts` and the tests. It was internal and consistent (users never typed
  it in JSON; the command id `wireferry.sync.bothDirections` was always correct), so this was cosmetic.
- **Deep-merge profiles.** Profiles replace whole objects (e.g. `watcher`); a profile overriding one
  sub-key wipes the rest. Implement deep merge.

## Lower
- **FTP `lstat` is O(N)** — lists the whole parent dir to stat one file; slow in large folders.
- **`_limitSftpFileDescriptor` monkey-patches `ssh2` internals** — fragile across `ssh2` upgrades.
- ✅ **`@types/vscode` now matches the VS Code 1.66 engine floor.**
- Switch ssh-config lookup to `.compute()` for full `Include`/`Match` support.

## Correctness & error handling
Two related blockers were **fixed in 1.0.0** (sshClient `.on('close', this.end())` TypeError;
`realpathSync` ENOENT on deleted paths in `toRemotePath`). The rest is backlog:

- ✅ **FIXED (1.1.1): Upload Changed Files now awaits its work.** Previously
  (`commandUploadChangedFiles.ts:98,116`) the `map()` callbacks didn't return the promises, so
  upload/rename/delete were fire-and-forget and async errors were swallowed.
- ✅ **`createCommand` returns async work.** `Command.run()` now waits for normal commands and can
  route their failures through the command error handler.
- ✅ **FIXED (1.1.1): `renameRemote` rewritten.** It previously used a local path as the remote path
  (`rename.ts:9`) and the caller swapped old/new (`commandUploadChangedFiles.ts:108`), so git-rename
  sync was broken. The handler was rewritten to keep local and remote paths separate.
- ✅ **FIXED: `tsc --noEmit` passes.** The toolchain was modernized and `skipLibCheck` is set in
  `tsconfig.json`.
- ✅ **FIXED: the jest suite runs.** `test/preprocessor.js` returns `{ code }` for jest@29; the suites
  run. One test (`sync --update with time offset`) is intentionally `skip`ped — see the next item.
- **`remoteTimeOffsetInHours` is disabled.** It is commented out at every call site in
  `transfer/index.ts`, so the documented option currently has no effect; and the sync `--update`
  mtime comparison does not account for the offset (a re-sync re-uploads an already-synced file).
  Re-enable the option and make the comparison offset-aware together; the `sync --update with time
  offset` test is `skip`ped until then.
- ✅ **Every "Upload to all profiles" variant confirms**, including active file/folder, project and
  force upload.
- ~~**Inverted context menu** for `downloadWhenOpenInRemoteExplorer`.~~ Investigated and **not** a bug
  (don't re-file): the menu deliberately offers the OTHER action to whatever a click does. With the
  setting on, a click downloads (`treeDataProvider.ts:747` → `editInLocal`) and the menu offers
  "View Content" (`package.json` `when: config.wireferry.downloadWhenOpenInRemoteExplorer`); with it
  off, the pair is reversed. Both commands stay reachable either way.
- ✅ **FIXED: delete/chmod in sync are now awaited** (`transfer.ts`). Deletions are collected into the
  `Promise.all` the command waits on (so success is no longer reported before they finish) and made
  non-fatal via try/catch in `removeFile`; the `dirPerm` chmod is awaited with its own try/catch so a
  chmod failure is logged rather than escaping as an unhandled rejection.
- ✅ **FIXED (2.6.3): `removeRemote` no longer awaits `undefined`** for unknown stat types. An
  unremovable kind (socket, device, fifo → `FileType.Unknown`) is now rejected with a thrown error
  BEFORE the report row and the `afterHandle` refresh claim a deletion, and the switch `default`
  throws as a defensive backstop for any future `FileType` (`remove.ts`).

## Known bugs (pre-existing)
Spot-checked against the code. All inherited from upstream unless noted.

- ✅ **FIXED: `isSubpathOf` / `isInWorkspace` now append `path.sep` before comparing** (`paths.ts`), so
  `/foo` is no longer treated as a parent of `/foo-bar`. (`isSubpathOf` is currently unused, but kept
  correct.)
- ✅ **Connection identities are deterministic and secret-free.** Nested objects and key order no
  longer collide, and credentials are excluded from the long-lived cache key.
- ✅ **FTP raw-command paths are validated**, including the `SITE CHMOD` path.
- ✅ **SFTP symlink callbacks settle once** and return immediately after rejection.
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
  pane for files with no local copy; duplicate/empty `context` silently overwrites in the service
  trie. (`replaceHomePath` was fixed in 2.6.3 — it expands the Windows `~\` prefix as well as `~/`.)
- Resource/leak items (TreeView/EventEmitter/StatusBar/outputChannel not disposed; `_map` unbounded;
  FD/stream leaks in `transferTask`/`fileBaseOperations`; zombie SSH hop clients; listener leak on
  reconnect) — audit `dispose()` coverage holistically.
- Security: path-traversal from a malicious server's listing (`uResource`/`treeDataProvider`); SSH
  hop `forwardOut` as open proxy. Lower priority but note for a hardening pass.

Investigated and **not** a bug (don't re-file): the service trie longest-prefix lookup is
token-split and correct.

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
