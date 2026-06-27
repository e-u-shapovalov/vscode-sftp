import { window } from 'vscode';
import { isRemoteSubpathOf } from './paths';
import { L } from '../i18n';

// Scopes we've already explained this session, keyed by host + remotePath. Opening a file above the
// scope downloads a copy OUTSIDE the workspace; we tell the user once per scope where it lands and how
// to widen the scope, then stay out of the way. Reading itself is always allowed (it grants nothing
// beyond what the SSH account can already read) — this notice is purely about that local copy.
const explainedScopes = new Set<string>();

interface OutsideScopeInfo {
  // The configured scope — `remotePath` from .vscode/wireferry.json.
  scope: string;
  // The remote file being opened.
  remotePath: string;
  // Where its copy will be written on the local disk (mapped, can sit above the workspace).
  localPath: string;
  host?: string;
}

// Show a one-per-session, non-blocking notice when an Edit-in-Local target sits above the configured
// scope. No-op when the file is inside the scope (the common case) or already explained this session.
export function warnOutsideScopeOnce(info: OutsideScopeInfo): void {
  // Defensive: scope (config.remotePath) is a required non-empty string and the paths come from
  // UResource getters, so these are always set in practice — but guard anyway so a future caller can't
  // feed undefined into isRemoteSubpathOf (which would throw inside upath.normalize).
  if (!info.scope || !info.remotePath) {
    return;
  }
  if (isRemoteSubpathOf(info.scope, info.remotePath)) {
    return;
  }

  const key = `${info.host || ''}|${info.scope}`;
  if (explainedScopes.has(key)) {
    return;
  }
  explainedScopes.add(key);

  // Fire-and-forget: a non-modal notification so the open proceeds immediately and nothing blocks.
  void window.showWarningMessage(
    L({
      en:
        `WireFerry: "${info.remotePath}" is OUTSIDE your working scope, so a copy will be ` +
        `written to your local disk at:\n${info.localPath}\n\n` +
        `Your scope is the "remotePath" setting in .vscode/wireferry.json, currently:\n${info.scope}\n\n` +
        `This file lives above that path. Reading any file is always allowed; this notice is only ` +
        `about the local copy. To make such files land inside your project, widen "remotePath" in ` +
        `the settings. (Shown once per scope this session.)`,
      ru:
        `WireFerry: «${info.remotePath}» находится ВНЕ вашего рабочего скоупа, поэтому его копия ` +
        `будет записана на локальный диск сюда:\n${info.localPath}\n\n` +
        `Скоуп — это параметр «remotePath» в .vscode/wireferry.json, сейчас в нём:\n${info.scope}\n\n` +
        `Этот файл лежит выше него. Читать можно любой файл — это всегда разрешено; уведомление ` +
        `только про локальную копию. Чтобы такие файлы попадали внутрь проекта, расширьте ` +
        `«remotePath» в настройках. (Показывается один раз за сессию для этого скоупа.)`,
    })
  );
}
