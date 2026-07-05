import * as vscode from 'vscode';
import * as path from 'path';
import { COMMAND_UPLOAD_CHANGEDFILES } from '../constants';
import { getFileService } from '../modules/serviceManager';
import { uploadFile, renameRemote, removeRemote } from '../fileHandlers';
import { getGitService, GitAPI, Repository, Status, Change } from '../modules/git';
import { checkCommand } from './abstract/createCommand';
import logger from '../logger';
import { simplifyPath } from '../helper';
import { L } from '../i18n';

export default checkCommand({
  id: COMMAND_UPLOAD_CHANGEDFILES,

  async handleCommand(hint: any) {
    return handleCommand(hint);

    // resourceGroup.resourceStates.forEach(resourceState => {
    //   resourceState.
    //   console.log(resourceState.decorations);
    // });

    // try {
    //   await uploadFile(ctx, { ignore: null });
    // } catch (error) {
    //   // ignore error when try to upload a deleted file
    //   if (error.code !== 'ENOENT') {
    //     throw error;
    //   }
    // }
  },
});

function isRepository(object: any): object is Repository {
  return 'rootUri' in object;
}

function isSourceControlResourceGroup(object: any): object is vscode.SourceControlResourceGroup {
  return 'id' in object && 'resourceStates' in object;
}

async function handleCommand(hint: any) {
  let repository: Repository | undefined;
  let filterGroupId;
  const git = getGitService();

  if (!hint) {
    repository = await getRepository(git);
  } else if (isSourceControlResourceGroup(hint)) {
    repository = git.repositories.find(repo => repo.ui.selected);
    filterGroupId = hint.id;
  } else if (isRepository(hint)) {
    // Use the repo we were invoked on, not the UI-selected one: in a multi-root workspace they differ,
    // and resolving to `selected` uploaded a different project's changes than the one clicked.
    repository = hint;
  }

  if (!repository) {
    return;
  }

  let changes: Change[];
  if (filterGroupId === 'index') {
    changes = repository.state.indexChanges;
  } else if (filterGroupId === 'workingTree') {
    changes = repository.state.workingTreeChanges;
  } else {
    changes = repository.state.indexChanges.concat(repository.state.workingTreeChanges);
  }

  const creates: Change[] = [];
  const uploads: Change[] = [];
  const renames: Change[] = [];
  const deletes: Change[] = [];
  for (const change of changes) {
    if (!getFileService(change.uri)) {
      continue;
    }

    switch (change.status) {
      case Status.INDEX_MODIFIED:
      case Status.MODIFIED:
        uploads.push(change);
        break;
      case Status.INDEX_ADDED:
      case Status.UNTRACKED:
        creates.push(change);
        break;
      case Status.INDEX_RENAMED:
        renames.push(change);
        break;
      case Status.INDEX_DELETED:
      case Status.DELETED:
        deletes.push(change);
        break;
      default:
        break;
    }
  }

  // Process each change one at a time. Every uploadFile/renameRemote/removeRemote builds its own
  // transfer Scheduler, so a Promise.all over N changes opened N transfers at once and ignored
  // `concurrency` — a git commit with hundreds of files could trip sshd MaxSessions/MaxStartups,
  // exhaust file descriptors, or get the IP banned on shared hosting. Serial keeps the blast
  // radius bounded; the per-change try/catch still logs a failure and moves on to the next.
  for (const change of creates.concat(uploads)) {
    try {
      await uploadFile(change.uri);
    } catch (e) {
      logger.error('Upload failed.', e);
    }
  }
  for (const change of renames) {
    try {
      await renameRemote(change.originalUri, {
        newLocalPath: change.renameUri!.fsPath,
        skipRefresh: true,
      });
    } catch (e) {
      logger.error('Rename failed.', e);
    }
  }
  // Deleting on the server is destructive and irreversible, and the user clicked an "upload" action —
  // confirm the delete fan-out explicitly (uploads/renames just overwrite content they already saved).
  if (deletes.length > 0) {
    const sample = deletes.slice(0, 5).map(c => simplifyPath(c.uri.fsPath));
    const more = deletes.length > 5 ? ` (+${deletes.length - 5})` : '';
    const del = L({ en: 'Delete on server', ru: 'Удалить на сервере' });
    const answer = await vscode.window.showWarningMessage(
      L({
        en: `Also delete ${deletes.length} file(s) on the server?\n${sample.join(', ')}${more}`,
        ru: `Также удалить на сервере ${deletes.length} файл(ов)?\n${sample.join(', ')}${more}`,
      }),
      { modal: true },
      del,
      L({ en: 'Skip deletions', ru: 'Пропустить удаления' })
    );
    if (answer !== del) {
      deletes.length = 0; // keep uploads/renames, drop the server deletions
    }
  }
  for (const change of deletes) {
    try {
      await removeRemote(change.uri);
    } catch (e) {
      logger.error('Deletion failed.', e);
    }
  }

  logger.log('');
  logger.log('------ Upload Changed Files Result ------');
  outputGroup('create', creates, c => simplifyPath(c.uri.fsPath));
  outputGroup('upload', uploads, c => simplifyPath(c.uri.fsPath));
  outputGroup(
    'renamed',
    renames,
    c => `${simplifyPath(c.originalUri.fsPath)} ➞ ${simplifyPath(c.renameUri!.fsPath)}`
  );
  outputGroup('deleted', deletes, c => simplifyPath(c.uri.fsPath));
}

function outputGroup<T>(label: string, items: T[], formatItem: (x: T) => string) {
  if (items.length <= 0) {
    return;
  }

  logger.log(`${label.toUpperCase()}:`);
  logger.log(items.map(i => formatItem(i)).join('\n'));
  logger.log('');
}

async function getRepository(git: GitAPI): Promise<Repository | undefined> {
  if (git.repositories.length === 1) {
    return git.repositories[0];
  }

  if (git.repositories.length === 0) {
    throw new Error(L({ en: 'There are no available repositories', ru: 'Нет доступных репозиториев' }));
  }

  const picks = git.repositories.map(repo => {
    const label = path.basename(repo.rootUri.fsPath);
    const description = repo.state.HEAD ? repo.state.HEAD.name : '';

    return {
      label,
      description,
      repository: repo,
    };
  });

  const pick = await vscode.window.showQuickPick(picks, {
    placeHolder: L({ en: 'Choose a repository', ru: 'Выберите репозиторий' }),
  });

  return pick && pick.repository;
}
