import { Uri, window } from 'vscode';
import logger from '../../logger';
import { reportError } from '../../helper';
import { L } from '../../i18n';
import { handleCtxFromUri, allHandleCtxFromUri, FileHandlerContext } from '../../fileHandlers';
import Command from './command';
import * as transferProgress from '../../ui/transferProgress';
import * as operationReport from '../../ui/operationReport';
import { findAllFileService } from '../../modules/serviceManager';

// Map a command ID to the report kind, or null for commands that don't want a log tab
// (e.g. delete, chmod — delete manages its own report in commandDeleteRemote).
function reportKind(id: string): operationReport.ReportKind | null {
  if (/^wireferry\.upload\./.test(id)) return 'upload';
  if (/^wireferry\.download\./.test(id)) return 'download';
  if (/^wireferry\.sync\.localToRemote/.test(id)) return 'upload';
  if (/^wireferry\.sync\.remoteToLocal/.test(id)) return 'download';
  if (/^wireferry\.sync\./.test(id)) return 'upload';
  return null;
}

// Return a localised progress notification title for transfer commands, or null for others
// (e.g. delete, chmod) so they don't get a progress bar.
function transferTitle(id: string): string | null {
  if (/^wireferry\.upload\./.test(id)) {
    return L({ en: 'WireFerry: uploading…', ru: 'WireFerry: выгрузка…' });
  }
  if (/^wireferry\.download\./.test(id)) {
    return L({ en: 'WireFerry: downloading…', ru: 'WireFerry: скачивание…' });
  }
  if (/^wireferry\.sync\./.test(id)) {
    return L({ en: 'WireFerry: syncing…', ru: 'WireFerry: синхронизация…' });
  }
  // A plain click in the tree downloads via editInLocal — show the byte bar so the user sees it's
  // fetching (the file is downloaded for real), but NOT a report tab: a single click just wants the
  // progress, the report is reserved for explicit right-click transfers (reportKind excludes this).
  if (/\.editInLocal$/.test(id)) {
    return L({ en: 'WireFerry: downloading…', ru: 'WireFerry: скачивание…' });
  }
  return null;
}

// Cancel all in-progress transfers across every registered FileService.
function cancelAllTransfers(): void {
  findAllFileService(f => f.isTransferring()).forEach(f => f.cancelTransferTasks());
}

// Every wireferry.upload.*.to.allProfiles command is a mass operation — they all get the same
// safety prompt (previously only the file/folder variants asked; project/active/force did not).
async function confirmUploadToAllProfiles(commandId: string): Promise<boolean> {
  if (!commandId.endsWith('.to.allProfiles')) {
    return true;
  }
  const yes = L({ en: 'Yes', ru: 'Да' });
  const answer = await window.showInformationMessage(
    L({
      en: 'Are you sure you want to upload to all profiles?',
      ru: 'Точно выгрузить во все профили?',
    }),
    yes,
    L({ en: 'No', ru: 'Нет' })
  );
  return answer === yes;
}

interface BaseCommandOption {
  id: string;
  name?: string;
}

interface CommandOption extends BaseCommandOption {
  handleCommand: (this: Command, ...args: any[]) => unknown | Promise<unknown>;
}

interface FileCommandOption extends BaseCommandOption {
  handleFile: (ctx: FileHandlerContext) => Promise<unknown>;
  getFileTarget: (...args: any[]) => undefined | Uri | Uri[] | Promise<undefined | Uri | Uri[]>;
}

function checkType<T>() {
  return (a: T) => a;
}

export const checkCommand = checkType<CommandOption>();
export const checkFileCommand = checkType<FileCommandOption>();

export function createCommand(commandOption: CommandOption & { name: string }) {
  return class NormalCommand extends Command {
    constructor() {
      super();
      this.id = commandOption.id;
      this.name = commandOption.name;
    }

    doCommandRun(...args) {
      // Return the promise: Command.run() awaits it, so async errors reach reportError and
      // commitCommandDone fires only after the command actually finishes.
      return commandOption.handleCommand.apply(this, args);
    }
  };
}

export function createFileCommand(commandOption: FileCommandOption & { name: string }) {
  return class FileCommand extends Command {
    constructor() {
      super();
      this.id = commandOption.id;
      this.name = commandOption.name;
    }

    protected async doCommandRun(...args) {
      if (!(await confirmUploadToAllProfiles(this.id))) {
        return;
      }

      const target = await commandOption.getFileTarget(...args);
      if (!target) {
        logger.warn(`The "${this.name}" command get canceled because of missing targets.`);
        return;
      }

      const targetList: Uri[] = Array.isArray(target) ? target : [target];
      // Tasks must be created inside work() so they start within the progress session.
      const run = () => Promise.all(targetList.map(async uri => {
        try {
          await commandOption.handleFile(handleCtxFromUri(uri));
        } catch (error) {
          reportError(error);
        }
      }));

      const title = transferTitle(this.id);
      const kind = reportKind(this.id);
      const runWithProgress = title
        ? () => transferProgress.withTransferProgress(title, cancelAllTransfers, run)
        : run;
      if (kind) {
        await operationReport.withReport(kind, runWithProgress);
      } else {
        await runWithProgress();
      }
    }
  };
}

export function createFileMultiCommand(commandOption: FileCommandOption & { name: string }) {
  return class FileCommand extends Command {
    constructor() {
      super();
      this.id = commandOption.id;
      this.name = commandOption.name;
    }

    protected async doCommandRun(...args) {
      if (!(await confirmUploadToAllProfiles(this.id))) {
        return;
      }

      const target = await commandOption.getFileTarget(...args);
      if (!target) {
        logger.warn(`The "${this.name}" command get canceled because of missing targets.`);
        return;
      }

      const targetList: Uri[] = Array.isArray(target) ? target : [target];
      // Tasks must be created inside work() so they start within the progress session.
      const run = () => Promise.all(targetList.map(async uri => {
        // Catch per profile: a bare Promise.all rejects on the first profile's failure and leaves the
        // other profiles' rejections unhandled — and the user sees only one error of the fan-out.
        await Promise.all(
          allHandleCtxFromUri(uri).map(ctx =>
            commandOption.handleFile(ctx).catch(error => reportError(error))
          )
        );
      }));

      const title = transferTitle(this.id);
      const kind = reportKind(this.id);
      const runWithProgress = title
        ? () => transferProgress.withTransferProgress(title, cancelAllTransfers, run)
        : run;
      if (kind) {
        await operationReport.withReport(kind, runWithProgress);
      } else {
        await runWithProgress();
      }
    }
  };
}
