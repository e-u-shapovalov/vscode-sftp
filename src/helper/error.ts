import * as output from '../ui/output';
import logger from '../logger';
import { showErrorMessage } from '../host';

// ssh2 sets err.code to a numeric SSH_FX_* status. The generic FAILURE (4) arrives with the bare
// message "Failure" and no server-side detail, so we spell out the usual culprits. Extend as needed.
const SFTP_STATUS_HINTS: { [code: number]: string } = {
  4:
    'the server rejected the operation (SFTP failure) — the target may already exist, the remote ' +
    'filesystem may be read-only, out of disk space, or over quota',
};

function describeError(err: Error & { code?: number | string }): string {
  const base = err.message || 'Unknown error';
  if (typeof err.code === 'number' && SFTP_STATUS_HINTS[err.code]) {
    return `${base}: ${SFTP_STATUS_HINTS[err.code]}`;
  }
  return base;
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
  showErrorMessage(display, 'Detail').then(result => {
    if (result === 'Detail') {
      output.show();
    }
  });
  return;
}
