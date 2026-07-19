import * as vscode from 'vscode';
import * as nodePath from 'path';
import { COMMAND_DELETE_REMOTE } from '../constants';
import { upath, FileType } from '../core';
import { removeRemote, handleCtxFromUri, allHandleCtxFromUri } from '../fileHandlers';
import { getFileService } from '../modules/serviceManager';
import { reportError } from '../helper';
import { checkCommand } from './abstract/createCommand';
import { uriFromExplorerContextOrEditorContext } from './shared';
import { L } from '../i18n';
import * as operationReport from '../ui/operationReport';
import { execAsRoot, canElevate, ElevationCancelled, shQuote } from '../modules/privilegedExec';
import { localFileMd5, serverFileMd5 } from '../helper/fileFacts';
import app from '../app';
import * as fse from 'fs-extra';

// Is there a TRUE local backup of this target — a local file identical to the server's? Only then is a
// server delete recoverable. Compares size first (cheap), and on a size match verifies by MD5, so a broken
// or edited local copy of the same size does NOT count as a backup. Anything we can't prove identical —
// a missing local file, a directory, an unreadable side, or no server-side MD5 — counts as "not a backup".
async function hasIdenticalLocalCopy(uri: vscode.Uri): Promise<boolean> {
  let ctx;
  try {
    ctx = handleCtxFromUri(uri);
  } catch {
    return false;
  }
  const { localFsPath, remoteFsPath } = ctx.target;
  if (!localFsPath || !fse.existsSync(localFsPath)) {
    return false;
  }
  try {
    const remotefs = await ctx.fileService.getRemoteFileSystem(ctx.config);
    const [localStat, remoteStat] = await Promise.all([
      fse.lstat(localFsPath),
      remotefs.lstat(remoteFsPath),
    ]);
    // Only a plain file counts as a content backup — lstat (NOT stat) so a local SYMLINK is not mistaken
    // for one (it could point at the very server file being deleted). A size mismatch already proves they
    // differ.
    if (!localStat.isFile() || remoteStat.type !== FileType.File || localStat.size !== remoteStat.size) {
      return false;
    }
    const [localMd5, remoteMd5] = await Promise.all([
      localFileMd5(localFsPath),
      serverFileMd5(remotefs, remoteFsPath),
    ]);
    return !!localMd5 && !!remoteMd5 && localMd5 === remoteMd5;
  } catch {
    return false; // can't verify → treat as "no backup" (require confirmation)
  }
}

// A hard, type-to-confirm gate before an IRRECOVERABLE server delete — the kind that has bitten people
// deleting server configs on autopilot. It fires whenever the server copy is removed AND no TRUE backup
// remains: deleting on both sides / all servers, or on the server alone when there is no local copy OR the
// local copy DIFFERS from the server (a broken/edited local is not a backup). Deleting locally only, or on
// the server while an IDENTICAL local copy stays, does NOT ask. Returns true to proceed.
async function confirmIrrecoverableServerDelete(
  scope: DeleteScope,
  targetList: vscode.Uri[],
  subject: string
): Promise<boolean> {
  if (scope === 'local') {
    return true; // server copy stays — nothing irrecoverable
  }
  // 'server' is safe to skip the hard gate ONLY when EVERY target keeps an identical local backup.
  if (scope === 'server') {
    const identical = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: L({ en: 'WireFerry: checking for a local backup…', ru: 'WireFerry: проверяю локальную копию…' }),
      },
      () => Promise.all(targetList.map(hasIdenticalLocalCopy))
    );
    if (identical.every(Boolean)) {
      return true;
    }
  }
  const both = scope === 'both' || scope === 'allServers';
  const typed = await vscode.window.showInputBox({
    ignoreFocusOut: true,
    title: L({
      en: '⚠ Deleting on the server — no safe copy will remain',
      ru: '⚠ Удаление на сервере — надёжной копии не останется',
    }),
    prompt: L({
      en: `You are about to delete ${subject} on the server${both ? ' and locally' : ''}. There is no identical local backup, so the server copy cannot be recovered. Type "yes" to confirm, or press Esc to cancel.`,
      ru: `Вы удаляете ${subject} на сервере${both ? ' и локально' : ''}. Идентичной локальной копии нет, поэтому серверную версию не восстановить. Введите «yes» для подтверждения или Esc для отмены.`,
    }),
    placeHolder: 'yes',
  });
  return (typed || '').trim().toLowerCase() === 'yes';
}

// SFTP/FTP "no permission" codes/text — a delete rejected for lack of write permission on the target's
// parent directory (as opposed to "not found"). Such a delete can be retried as root.
function isDeletePermissionDenied(err: any): boolean {
  if (!err) {
    return false;
  }
  const code = err.code;
  const msg = (err.message || '').toString().toLowerCase();
  // Flag any "no write permission" delete (vs "not found") so it can be collected for a possible root retry.
  // SFTP reports code 3 (SSH_FX_PERMISSION_DENIED); a native fs layer EACCES/EPERM; some servers carry the
  // reason only in the message (this also matches FTP's "550 Permission denied"). FTP can't actually be
  // escalated — but that's handled downstream: deleteAsRootBatch's pre-pass detects canElevate=false and
  // reports it PLAINLY without the "Delete as root?" modal, so a text match here never dead-ends on a modal.
  return (
    code === 3 ||
    code === 'EACCES' ||
    code === 'EPERM' ||
    msg.includes('permission denied') ||
    msg.includes('no access')
  );
}

// A server delete was rejected for lack of permission. Offer to remove it as root via `su rm -rf` — with an
// explicit confirmation EVERY time (even when the root password is already cached for this window), because
// a delete is destructive. Returns true when the item was removed as root; for a "both" delete the local
// copy is then moved to the trash too. Best-effort — never throws.
async function deleteAsRootBatch(uris: vscode.Uri[], option: any): Promise<void> {
  if (uris.length === 0) {
    return;
  }
  // A target that can actually be root-deleted: connection resolved, elevatable (SSH shell), path safe.
  type Elevatable = { uri: vscode.Uri; remotefs: any; host: string; remotePath: string };
  const elevatable: Elevatable[] = [];
  let failed = 0;
  // PRE-PASS before the modal: resolve every target's connection PER TARGET (a multi-select can span
  // different hosts/profiles — reusing one connection would `rm -rf` host B's path on host A), and drop the
  // ones that can't be root-deleted. This reports FTP ("no shell") and unsafe paths PLAINLY here, so the
  // "Delete as root?" modal only appears when there is genuinely something to escalate (no dead-end modal)
  // and can list the REAL paths it is about to `rm -rf`.
  for (const uri of uris) {
    let ctx;
    try {
      ctx = handleCtxFromUri(uri);
    } catch (e) {
      reportError(e as Error);
      failed += 1;
      continue;
    }
    let remotefs;
    let host;
    try {
      remotefs = await ctx.fileService.getRemoteFileSystem(ctx.config);
      host = ctx.config.host || '';
    } catch (e) {
      reportError(e as Error);
      failed += 1;
      continue;
    }
    if (!canElevate(remotefs)) {
      // FTP (or any transport without a shell): a permission error can't be escalated. Report it here — do
      // NOT let it reach the modal, which would dead-end on "needs SSH".
      reportError(
        new Error(
          L({
            en: `No permission to delete "${ctx.target.remoteFsPath}", and root elevation needs an SSH shell (not available on FTP).`,
            ru: `Нет прав удалить «${ctx.target.remoteFsPath}», а эскалация до root требует SSH (недоступно на FTP).`,
          })
        )
      );
      failed += 1;
      continue;
    }
    // Normalise, then refuse a non-absolute path (would resolve from /root under `su -`) AND refuse the
    // filesystem root itself (`rm -rf /`). Legitimate system paths like /etc/nginx/... are still allowed.
    // Done in the pre-pass so a refused path is never even offered in the confirmation.
    // POSIX normalisation ONLY: `upath.normalize` treats `\` as a separator, so a legitimate server file whose
    // name contains a backslash (`/srv/a\b`) would be rewritten to `/srv/a/b` — root would then `rm -rf` a
    // DIFFERENT existing object than the one selected/confirmed. `path.posix` keeps `\` as an ordinary char.
    const remotePath = nodePath.posix.normalize(ctx.target.remoteFsPath || '');
    if (!remotePath || remotePath[0] !== '/' || remotePath === '/') {
      reportError(new Error(`Refusing to delete an unsafe path as root: ${ctx.target.remoteFsPath}`));
      failed += 1;
      continue;
    }
    elevatable.push({ uri, remotefs, host, remotePath });
  }
  if (elevatable.length === 0) {
    return; // nothing root-deletable — every target was FTP/unsafe and already reported above; no modal
  }
  // Subject = the ACTUAL paths about to be `rm -rf`'d (up to 5, else a count), so the confirmation is
  // auditable — the user sees exactly what root will remove, not a blind "N items".
  const paths = elevatable.map(e => e.remotePath);
  const subject =
    paths.length > 5
      ? L({
          en: `${paths.length} items`,
          ru: `${paths.length} ${pluralRu(paths.length, 'элемент', 'элемента', 'элементов')}`,
        })
      : paths.map(p => `"${p}"`).join(', ');
  // ONE confirmation for the whole batch (a multi-select must not stack N modals). Shown ALWAYS, even with
  // a cached password — a delete is destructive.
  const del = { title: L({ en: 'Delete as root', ru: 'Удалить от root' }) };
  const cancel = { title: L({ en: 'Cancel', ru: 'Отмена' }), isCloseAffordance: true };
  const pick = await vscode.window.showWarningMessage(
    L({ en: `No permission to delete ${subject}. Delete as root?`, ru: `Нет прав удалить ${subject}. Удалить от root?` }),
    {
      modal: true,
      detail: L({
        en: 'Runs `rm -rf` as root on the server — a folder is removed recursively. The root password is asked only if it is not already cached for this window.',
        ru: 'Выполнит `rm -rf` от root на сервере — папка удаляется рекурсивно. Пароль root спросят, только если он ещё не сохранён на это окно.',
      }),
    },
    del,
    cancel
  );
  if (!pick || pick.title !== del.title) {
    return;
  }
  let deleted = 0;
  for (const t of elevatable) {
    try {
      const { code } = await execAsRoot(t.remotefs, t.host, `rm -rf -- ${shQuote(t.remotePath)}`);
      if (code !== 0) {
        reportError(new Error(`root delete of "${t.remotePath}" exited with ${code}`));
        failed += 1;
        continue;
      }
      deleted += 1;
      // For a "both" delete, move the local copy to the trash too (no permission issue there).
      if (option && option.removeLocalCopy && !option.skipRemote) {
        await removeRemote(t.uri, {
          skipRemote: true,
          removeLocalCopy: true,
          ignore: null,
          reportScope: 'local',
        }).catch(() => undefined);
      }
    } catch (e) {
      if (e instanceof ElevationCancelled) {
        break; // user backed out of the password prompt — stop the batch
      }
      reportError(e as Error);
      failed += 1;
    }
  }
  if (deleted > 0) {
    app.remoteExplorer.refresh();
  }
  if (deleted > 0 || failed > 0) {
    vscode.window.showInformationMessage(
      failed > 0
        ? L({ en: `Deleted ${deleted} as root, ${failed} failed.`, ru: `Удалено от root: ${deleted}, не удалось: ${failed}.` })
        : L({ en: `Deleted ${deleted} item(s) as root.`, ru: `Удалено от root: ${deleted}.` })
    );
  }
}

// 'allServers' is offered only when the config has profiles: delete the server copy on EVERY profile's
// host plus the single local copy — the delete-side mirror of "Upload to All Profiles".
type DeleteScope = 'server' | 'local' | 'both' | 'allServers';

// Russian plural for a count subject: 1 элемент, 2 элемента, 5 элементов.
function pluralRu(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

// Modal "where do you want to delete this?" prompt. Returns the chosen scope, or undefined when the
// user cancels (Esc / Cancel / dialog dismissed). `subject` is pre-formatted: a quoted name list, or a
// "N items" count for a big multi-select (so the modal doesn't grow absurdly tall).
async function askDeleteScope(
  subject: string,
  allowAllServers: boolean
): Promise<DeleteScope | undefined> {
  const onServer = { title: L({ en: 'On server', ru: 'На сервере' }) };
  const onComputer = { title: L({ en: 'On computer', ru: 'На компьютере' }) };
  const onBoth = { title: L({ en: 'On both', ru: 'И там, и там' }) };
  const onAllServers = { title: L({ en: 'All servers + computer', ru: 'Все серверы + ПК' }) };
  const cancel = { title: L({ en: 'Cancel', ru: 'Отмена' }), isCloseAffordance: true };

  // The "all servers" button only makes sense with profiles; without them it would equal "On both".
  const buttons = allowAllServers
    ? [onServer, onComputer, onBoth, onAllServers, cancel]
    : [onServer, onComputer, onBoth, cancel];

  const picked = await vscode.window.showWarningMessage(
    L({ en: `Delete ${subject}?`, ru: `Удалить ${subject}?` }),
    {
      modal: true,
      detail: allowAllServers
        ? L({
            en:
              'Choose where to delete it. "All servers + computer" removes it from every profile\'s ' +
              'server and the local copy. The local copy is moved to the OS trash, not erased.',
            ru:
              'Выберите, где удалить. «Все серверы + ПК» удаляет с сервера каждого профиля и локальную ' +
              'копию. Локальная копия уходит в Корзину ОС, а не стирается безвозвратно.',
          })
        : L({
            en: 'Choose where to delete it. The local copy is moved to the OS trash, not erased.',
            ru: 'Выберите, где удалить. Локальная копия уходит в Корзину ОС, а не стирается безвозвратно.',
          }),
    },
    ...buttons
  );

  if (!picked || picked.title === cancel.title) {
    return undefined;
  }
  if (picked.title === onServer.title) {
    return 'server';
  }
  if (picked.title === onComputer.title) {
    return 'local';
  }
  if (picked.title === onAllServers.title) {
    return 'allServers';
  }
  return 'both';
}

export default checkCommand({
  id: COMMAND_DELETE_REMOTE,

  async handleCommand(item, items) {
    const targets = uriFromExplorerContextOrEditorContext(item, items);
    if (!targets) {
      return;
    }

    const targetList = Array.isArray(targets) ? targets : [targets];
    const names = targetList.map(t => upath.basename(t.fsPath));
    // Listing every name makes the modal absurdly tall on a big multi-select — past 5, show the count.
    const subject =
      names.length > 5
        ? L({
            en: `${names.length} items`,
            ru: `${names.length} ${pluralRu(names.length, 'элемент', 'элемента', 'элементов')}`,
          })
        : L({ en: `'${names.join(', ')}'`, ru: `«${names.join(', ')}»` });

    // Offer the "all servers" option only when this config actually has profiles.
    const fileService = getFileService(targetList[0]);
    const hasProfiles = !!fileService && fileService.getAvailableProfiles().length > 0;

    const scope = await askDeleteScope(subject, hasProfiles);
    if (scope === undefined) {
      return;
    }

    // Extra hard gate for a server delete that leaves NO copy — type "yes" to go through.
    if (!(await confirmIrrecoverableServerDelete(scope, targetList, subject))) {
      return;
    }

    if (scope === 'allServers') {
      await operationReport.withReport('delete', () =>
        Promise.all(
          targetList.map(async uri => {
            // Resolve the local path, then fan out to every profile's server via the same local→remote
            // mapping "Upload to All Profiles" uses — works whether the click came from the server tree
            // (remote URI) or the local Explorer.
            let ctxs;
            try {
              const { localFsPath } = handleCtxFromUri(uri).target;
              ctxs = allHandleCtxFromUri(vscode.Uri.file(localFsPath));
            } catch (error) {
              reportError(error);
              return;
            }
            // Delete the server copy on every profile independently — one unreachable host can't stop
            // the rest; each report row is tagged with its destination host.
            await Promise.all(
              ctxs.map(ctx =>
                removeRemote(ctx, {
                  removeLocalCopy: false,
                  ignore: null,
                  reportScope: 'server',
                  reportNote: `← ${ctx.config.host}`,
                }).catch(reportError)
              )
            );
            // Then move the single shared local copy to the trash once.
            if (ctxs.length > 0) {
              await removeRemote(ctxs[0], {
                skipRemote: true,
                removeLocalCopy: true,
                ignore: null,
                reportScope: 'local',
              }).catch(reportError);
            }
          })
        )
      );
      return;
    }

    // 'server' → remote only; 'local' → local copy only (server untouched); 'both' → remote + local.
    // `ignore: null` bypasses the sync `ignore` filter: this is an explicit delete of a file the user
    // can see in the tree, so an ignore rule (e.g. `*.txt`) must not silently skip it. Auto-sync
    // callers of removeRemote (file watcher, upload-changed-files) don't pass this and still honour it.
    // `reportScope` is forwarded into removeRemote so each report row carries the chosen scope.
    const option =
      scope === 'server'
        ? { removeLocalCopy: false, ignore: null, reportScope: 'server' as const }
        : scope === 'local'
        ? { removeLocalCopy: true, skipRemote: true, ignore: null, reportScope: 'local' as const }
        : { removeLocalCopy: true, ignore: null, reportScope: 'both' as const };

    const permissionDenied: vscode.Uri[] = [];
    await operationReport.withReport('delete', () =>
      Promise.all(
        targetList.map(async uri => {
          try {
            await removeRemote(uri, option);
          } catch (error) {
            // Collect permission-denied server deletes for a SINGLE "Delete as root?" batch prompt below
            // (so a multi-select doesn't stack N modals); report anything else immediately.
            if (isDeletePermissionDenied(error)) {
              permissionDenied.push(uri);
            } else {
              reportError(error);
            }
          }
        })
      )
    );
    // One batch confirmation + serial `su rm -rf` for everything that hit a permission wall.
    await deleteAsRootBatch(permissionDenied, option);
  },
});
