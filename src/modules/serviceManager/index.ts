import { Uri } from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import app from '../../app';
import logger from '../../logger';
import { simplifyPath, reportError } from '../../helper';
import { setContextValue, showWarningMessage } from '../../host';
import { L } from '../../i18n';
import { UResource, FileService, TransferTask } from '../../core';
import { TransferDirection } from '../../core/transferTask';
import { validateConfig } from '../config';
import watcherService from '../fileWatcher';
import Trie from './trie';
import * as operationReport from '../../ui/operationReport';

const WIN_DRIVE_REGEX = /^([a-zA-Z]):/;
const isWindows = process.platform === 'win32';

const serviceManager = new Trie<FileService>(
  {},
  {
    delimiter: path.sep,
  }
);

// Recursive: secrets also live in nested objects — profiles.<name>.password, hop[].password —
// which a top-level-only mask would print to the Output channel verbatim.
function maskConfig(config) {
  const MASK = '******';
  // `key`/`pfx` cover the TLS client material an FTPS `secureOptions` can carry — without them a
  // private key or PFX bundle would be printed verbatim to the Output channel.
  const SECRET_KEYS = ['username', 'password', 'passphrase', 'privateKey', 'key', 'pfx'];
  const mask = (value: any, key?: string) => {
    if (key !== undefined && SECRET_KEYS.indexOf(key) !== -1) {
      return MASK;
    }
    if (key === 'interactiveAuth' && Array.isArray(value)) {
      return value.map(() => MASK);
    }
    if (Array.isArray(value)) {
      return value.map(item => mask(item));
    }
    if (value !== null && typeof value === 'object') {
      const copy = {};
      Object.keys(value).forEach(k => {
        copy[k] = mask(value[k], k);
      });
      return copy;
    }
    return value;
  };
  return mask(config);
}

function normalizePathForTrie(pathname) {
  // Windows paths — including UNC \\host\share — are case-insensitive, but the trie keys by exact
  // string segments. Lowercase the whole path on Windows so a service registered as \\pc_test\...
  // is still found after realpathSync.native returns \\Pc_test\... on save (#589). Drive-letter
  // paths were already handled this way; this extends the same treatment to the UNC host part.
  if (isWindows) {
    pathname = pathname.toLowerCase();
  }

  return path.normalize(pathname);
}

export function getBasePath(context: string, workspace: string) {
  let dirpath;
  if (context) {
    if (path.isAbsolute(context)) {
      dirpath = context;
      if (isWindows) {
        const contextBeginWithDrive = context.match(WIN_DRIVE_REGEX);
        // if a windows user omit drive, we complete it with a drive letter same with the workspace one
        if (!contextBeginWithDrive) {
          const workspaceDrive = workspace.match(WIN_DRIVE_REGEX);
          if (workspaceDrive) {
            const drive = workspaceDrive[1];
            dirpath = path.join(`${drive}:`, context);
          }
        }
      }
    } else {
      // Don't use path.resolve bacause it may change the root dir of workspace!
      // Example: On window path.resove('\\a\\b\\c') will result to '<drive>:\\a\\b\\c'
      // We know workspace must be a absolute path and context is a relative path to workspace,
      // so path.join will suit our requirements.
      dirpath = path.join(workspace, context);
    }
  } else {
    dirpath = workspace;
  }

  return normalizePathForTrie(dirpath);
}

export function createFileService(config: any, workspace: string) {
  // Only seed the active profile if none is set yet. createFileService runs once per workspace
  // folder (in parallel via Promise.all at startup), so an unconditional write let the last config
  // to resolve win the race — two projects with different defaultProfile gave a nondeterministic
  // active profile, and operations could target the wrong server.
  if (config.defaultProfile && !app.state.profile) {
    app.state.profile = config.defaultProfile;
  }

  const normalizedBasePath = getBasePath(config.context, workspace);

  // The trie keys a service by its base path, so a second config with the same (or absent) "context"
  // would silently overwrite the first — an array of servers for one project would lose all but the
  // last (gone from the tree, transfers, profile picker). Warn instead of dropping it silently.
  const collides = getAllFileService().find(s => s.baseDir === normalizedBasePath);
  if (collides) {
    showWarningMessage(
      L({
        en: `WireFerry: more than one server uses the same "context" (${config.context || '.'}); only the last is kept. Give each server a distinct "context".`,
        ru: `WireFerry: несколько серверов используют один "context" (${config.context || '.'}); останется только последний. Задайте каждому серверу свой "context".`,
      })
    );
    // Dispose the colliding service before its trie slot is overwritten below — serviceManager.add
    // drops the only reference to it, so without this its FileSystemWatcher and open SSH/FTP
    // connections leak and a stale watcher keeps uploading to the wrong server.
    disposeFileService(collides);
  }

  const service = new FileService(normalizedBasePath, workspace, config);

  logger.info(`config at ${normalizedBasePath}`, maskConfig(config));

  serviceManager.add(normalizedBasePath, service);
  service.name = config.name;
  service.setConfigValidator(validateConfig);
  service.setWatcherService(watcherService);
  service.beforeTransfer(task => {
    const { localFsPath, transferType } = task;
    app.sftpBarItem.showMsg(
      `${transferType} ${path.basename(localFsPath)}`,
      simplifyPath(localFsPath)
    );
  });
  service.afterTransfer((error, task) => {
    const { localFsPath, transferType } = task;
    const filename = path.basename(localFsPath);
    const filepath = simplifyPath(localFsPath);
    const isUpload = transferType === TransferDirection.LOCAL_TO_REMOTE;
    // Which server this file went to / failed on. With profiles, one command fans out to several
    // hosts, so naming the host turns "Permission denied" into "10.0.0.1: Permission denied".
    const host = task.remoteHost;
    const arrow = isUpload ? '→' : '←';
    if (task.isCancelled()) {
      logger.info(`cancel transfer ${localFsPath}`);
      app.sftpBarItem.showMsg(`cancelled ${filename}`, filepath, 2000 * 2);
    } else if (error) {
      // Name the server in the popup so a multi-target run says WHO failed without guesswork.
      reportError(error, host ? `${transferType} ${arrow} ${host} · ${filename}` : `when ${transferType} ${localFsPath}`);
      app.sftpBarItem.showMsg(`failed ${filename}`, filepath, 2000 * 2);

      // Record the failure (server + reason) in the operation log so "Upload to All Profiles"
      // shows ❌ which host failed and why — not just a transient popup.
      if (operationReport.isActive()) {
        const reason = (error && error.message) || String(error);
        operationReport.addRow({
          action: L({ en: 'FAILED', ru: 'ОШИБКА' }),
          path: localFsPath,
          failed: true,
          note: host ? `${host}: ${reason}` : reason,
        });
      }
    } else {
      logger.info(`${transferType} ${localFsPath}`);
      app.sftpBarItem.showMsg(`done ${filename}`, filepath, 2000 * 2);

      // Feed completed transfers into the operation report when one is active.
      // For upload the local file is the source; for download it was just written to disk.
      // Either way, the local stat after the operation is the most informative snapshot.
      if (operationReport.isActive()) {
        // Determine the human-readable action verb from the transfer direction.
        const action = isUpload
          ? L({ en: 'uploaded', ru: 'выгружено' })
          : L({ en: 'downloaded', ru: 'скачано' });

        // Snapshot the local file; don't crash the afterTransfer hook if stat fails.
        let localStat: operationReport.FileSideStat | null = null;
        try {
          const s = fs.statSync(localFsPath);
          localStat = { size: s.size, mode: s.mode, mtime: s.mtimeMs };
        } catch {
          // File may not exist yet (upload) or was cleaned up — proceed with null.
        }

        // Tag the row with the server so a fan-out report shows where each file landed.
        operationReport.addRow({
          action,
          path: localFsPath,
          local: localStat,
          note: host ? `${arrow} ${host}` : undefined,
        });
      }
    }
  });

  return service;
}

export function getFileService(uri: Uri): FileService {
  let fileService;
  if (UResource.isRemote(uri)) {
    const remoteRoot = app.remoteExplorer.findRoot(uri);
    if (remoteRoot) {
      fileService = remoteRoot.explorerContext.fileService;
    }
  } else {
    fileService = serviceManager.findPrefix(normalizePathForTrie(uri.fsPath));
  }

  return fileService;
}

export function disposeFileService(fileService: FileService) {
  serviceManager.remove(fileService.baseDir);
  fileService.dispose();
}

// Forward declaration note: createFileService (above) calls disposeFileService on a context
// collision; both are module-level exports so ordering doesn't matter at runtime.

export function findAllFileService(predictor: (x: FileService) => boolean): FileService[] {
  if (serviceManager === undefined) {
    return [];
  }

  return getAllFileService().filter(predictor);
}

export function getAllFileService(): FileService[] {
  if (serviceManager === undefined) {
    return [];
  }

  return serviceManager.getAllValues();
}

// Drives the `wireferry.hasConfig` context key: true once at least one server is configured. The
// Remote Explorer hides its toolbar (package.json view/title `when`) and shows the "Create
// Configuration" welcome button (viewsWelcome) while this is false. Call it after every change to
// the set of services (startup, config save, the setup wizard).
export function refreshConfigContext(): void {
  setContextValue('hasConfig', getAllFileService().length > 0);
}

export function getRunningTransformTasks(): TransferTask[] {
  return getAllFileService().reduce<TransferTask[]>((acc, fileService) => {
    return acc.concat(fileService.getPendingTransferTasks());
  }, []);
}
