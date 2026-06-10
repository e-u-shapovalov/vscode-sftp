import * as output from '../ui/output';
import logger from '../logger';
import { showErrorMessage } from '../host';
import { L } from '../i18n';

// ssh2 sets err.code to a numeric SSH_FX_* status. The generic FAILURE (4) arrives with the bare
// message "Failure" and no server-side detail, so we spell out the usual culprits. Computed per call
// (not a module-level const) so it follows the current alert language.
function sftpStatusHint(code: number): string | undefined {
  if (code === 4) {
    return L({
      en:
        'the server rejected the operation (SFTP failure) — the target may already exist, the remote ' +
        'filesystem may be read-only, out of disk space, or over quota',
      ru:
        'сервер отклонил операцию (ошибка SFTP) — цель уже существует, удалённая ФС только для чтения, ' +
        'нет места на диске или превышена квота',
    });
  }
  return undefined;
}

function describeError(err: Error & { code?: number | string }): string {
  const base = err.message || L({ en: 'Unknown error', ru: 'Неизвестная ошибка' });
  const hint = typeof err.code === 'number' ? sftpStatusHint(err.code) : undefined;
  return hint ? `${base}: ${hint}` : base;
}

export function reportError(err: Error | string, ctx?: string) {
  let errorString: string;
  let effectiveCtx = ctx;
  if (err instanceof Error) {
    // A file handler may attach operation+path context to the error (see createFileHandler).
    effectiveCtx = effectiveCtx || (err as any).ctx;
    errorString = describeError(err);
    logger.error(`${err.stack}`, effectiveCtx);
  } else {
    errorString = err;
    logger.error(errorString, effectiveCtx);
  }

  const display = effectiveCtx ? `${errorString} (${effectiveCtx})` : errorString;
  const detail = L({ en: 'Detail', ru: 'Подробности' });
  showErrorMessage(display, detail).then(result => {
    if (result === detail) {
      output.show();
    }
  });
  return;
}
