import * as vscode from 'vscode';
import { COMMAND_UPLOAD_MODIFIED_FROM_TREE } from '../constants';
import { checkCommand } from './abstract/createCommand';
import app from '../app';
import { uploadFile } from '../fileHandlers';
import * as operationReport from '../ui/operationReport';
import { partitionByWritable } from '../modules/uploadModified/partition';
import { uploadFilesAsRoot, RootUploadItem } from '../modules/batchUploadAsRoot';
import { acquirePermissionDialog, releasePermissionDialog } from '../modules/permissionFallback';
import { ModifiedUploadCandidate } from '../modules/remoteExplorer';
import { formatPerm } from '../helper/fileFacts';
import { L } from '../i18n';
import logger from '../logger';

// The needs-root preview tab: what will be staged and applied via `su`, one bullet per file with its
// remote path, local twin, mode and owner, so the user can review before approving the password prompt.
function buildNeedsRootReport(files: ModifiedUploadCandidate[]): string {
  const lines: string[] = [];
  lines.push(L({ en: 'Files that need root to upload', ru: 'Файлы, которым для выгрузки нужен root' }));
  lines.push('='.repeat(48), '');
  lines.push(
    L({
      en:
        'These differ from the server (M) and your login cannot write them (RO). WireFerry can stage each ' +
        'to /tmp and apply it via `su` as root (the destination owner/mode is preserved).',
      ru:
        'Они отличаются от сервера (M), и ваш логин не может их записать (RO). WireFerry положит каждый ' +
        'во /tmp и применит через `su` от root (владелец/права назначения сохранятся).',
    }),
    ''
  );
  for (const f of files) {
    const perm = typeof f.mode === 'number' ? formatPerm(f.mode) : '?';
    const own = [f.owner, f.group].filter(Boolean).join(':') || '?';
    lines.push(`• ${f.remotePath}`);
    lines.push(`    local : ${f.localPath}`);
    lines.push(`    mode  : ${perm}   owner: ${own}   host: ${f.host || '?'}`, '');
  }
  lines.push(
    L({
      en: 'Only cached (expanded) folders are scanned — expand folders first to see every M file.',
      ru: 'Сканируется только кэш (раскрытые папки) — раскройте папки, чтобы увидеть все M-файлы.',
    })
  );
  return lines.join('\n');
}

// Resolve the per-root filesystem handles for the needs-root batch. Candidates may span profiles, so each
// is routed through its own tree root (findRoot → getRemoteFileSystem/getLocalFileSystem).
async function resolveRootItems(
  cands: ModifiedUploadCandidate[]
): Promise<{ items: RootUploadItem[]; unresolved: number }> {
  const items: RootUploadItem[] = [];
  let unresolved = 0;
  for (const c of cands) {
    const root = app.remoteExplorer.findRoot(c.remoteUri);
    if (!root) {
      // The config was removed/renamed between collect and resolve — count it so the summary can't
      // silently under-report an approved file as neither ok nor failed.
      unresolved += 1;
      logger.error('resolve root item: no live root for', c.remotePath);
      continue;
    }
    const { fileService, config } = root.explorerContext;
    try {
      const remoteFs = await fileService.getRemoteFileSystem(config);
      const localFs = fileService.getLocalFileSystem();
      items.push({
        localPath: c.localPath,
        remotePath: c.remotePath,
        remoteFs,
        localFs,
        host: config.host || '',
      });
    } catch (e) {
      unresolved += 1;
      logger.error('resolve root item failed', e);
    }
  }
  return { items, unresolved };
}

export default checkCommand({
  id: COMMAND_UPLOAD_MODIFIED_FROM_TREE,

  async handleCommand() {
    const { candidates, pendingMd5 } = app.remoteExplorer.collectModifiedUploadCandidates();
    if (candidates.length === 0) {
      vscode.window.showInformationMessage(
        pendingMd5 > 0
          ? L({
              en: `No modified (M) files yet — MD5 verification is still running for ${pendingMd5} file(s). Try again in a moment.`,
              ru: `Пока нет изменённых (M) файлов — идёт проверка MD5 для ${pendingMd5} файл(ов). Повторите чуть позже.`,
            })
          : L({
              en: 'No modified (M) files in the Remote Explorer cache. Expand folders so WireFerry can see them.',
              ru: 'В кэше Remote Explorer нет изменённых (M) файлов. Раскройте папки, чтобы WireFerry их увидел.',
            })
      );
      return;
    }

    const { normal, needsRoot } = partitionByWritable(candidates);

    // Preview + confirm the root group BEFORE any upload, so Cancel aborts everything.
    let rootApproved = false;
    if (needsRoot.length > 0) {
      await operationReport.openTextReport('upload-needs-root.txt', buildNeedsRootReport(needsRoot));
      const yes = L({ en: 'Upload as root', ru: 'Загрузить от root' });
      const skip = L({ en: 'Skip root files', ru: 'Пропустить root-файлы' });
      const pick = await vscode.window.showWarningMessage(
        L({
          en: `${needsRoot.length} file(s) need root. Upload them as root?`,
          ru: `${needsRoot.length} файл(ов) требуют root. Загрузить от root?`,
        }),
        {
          modal: true,
          detail: L({
            en: 'A list is open in an editor tab. The password is kept in memory only for this window.',
            ru: 'Список открыт во вкладке. Пароль хранится в памяти только на это окно.',
          }),
        },
        yes,
        skip // Cancel/Esc → abort the whole command
      );
      if (pick === undefined) {
        return; // Cancel — do nothing at all
      }
      rootApproved = pick === yes;
    }

    // Hold the permission-dialog gate so the reactive per-file recovery dialogs stay silent during the
    // batch (a failed normal upload still records a report row, just no modal/toast storm).
    const held = acquirePermissionDialog();
    try {
      await operationReport.withReport('upload', async () => {
        for (const c of normal) {
          try {
            await uploadFile(c.remoteUri, { ignore: null }); // remoteUri ⇒ correct profile/config
          } catch (e) {
            logger.error('Upload modified (normal) failed', e);
          }
        }
        if (rootApproved) {
          const { items, unresolved } = await resolveRootItems(needsRoot);
          const { ok, fail } = await uploadFilesAsRoot(items);
          const failed = fail.length + unresolved;
          vscode.window.showInformationMessage(
            unresolved > 0
              ? L({
                  en: `Root upload: ${ok.length} ok, ${failed} failed (${unresolved} could not be matched to a live server).`,
                  ru: `Загрузка от root: успешно ${ok.length}, с ошибкой ${failed} (${unresolved} не удалось сопоставить с активным сервером).`,
                })
              : L({
                  en: `Root upload: ${ok.length} ok, ${fail.length} failed.`,
                  ru: `Загрузка от root: успешно ${ok.length}, с ошибкой ${fail.length}.`,
                })
          );
        }
      });
    } finally {
      if (held) {
        releasePermissionDialog();
      }
      app.remoteExplorer.refresh(); // full refresh: uploaded files flip M → Synced
    }
  },
});
