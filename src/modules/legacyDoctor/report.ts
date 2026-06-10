import { Issue, IssueKind } from './scan';

export type Lang = 'en' | 'ru';

// Human recommendation for one issue, in the chosen language. Lives here (not in scan.ts) so scanning
// stays language-free and unit-testable.
function recommendation(issue: Issue, lang: Lang): string {
  if (issue.kind === IssueKind.LegacyRename) {
    return lang === 'ru'
      ? `переименуйте «${issue.key}» → «${issue.replacement}»`
      : `rename "${issue.key}" to "${issue.replacement}"`;
  }
  return lang === 'ru'
    ? `«${issue.key}» не поддерживается в этой версии — можно удалить`
    : `"${issue.key}" is not supported in this version — you can remove it`;
}

// One line per issue for the Output channel: `path:line — key — recommendation`.
export function formatIssue(issue: Issue, lang: Lang): string {
  const loc = issue.line > 0 ? `${issue.file}:${issue.line}` : issue.file;
  return `${loc} — ${issue.key} — ${recommendation(issue, lang)}`;
}

// Short one-liner for the toast notification, summarising how many issues of each kind were found.
export function buildSummary(issues: Issue[], lang: Lang): string {
  const renames = issues.filter(i => i.kind === IssueKind.LegacyRename).length;
  const unsupported = issues.length - renames;
  if (lang === 'ru') {
    const parts: string[] = [];
    if (renames > 0) {
      parts.push(`${renames} устаревших sftp.*`);
    }
    if (unsupported > 0) {
      parts.push(`${unsupported} неподдерживаемых`);
    }
    return `WireFerry: в конфигурации найдено — ${parts.join(', ')} (параметров).`;
  }
  const parts: string[] = [];
  if (renames > 0) {
    parts.push(`${renames} legacy sftp.* ${renames === 1 ? 'setting' : 'settings'}`);
  }
  if (unsupported > 0) {
    parts.push(`${unsupported} unsupported ${unsupported === 1 ? 'key' : 'keys'}`);
  }
  return `WireFerry: found ${parts.join(' and ')} in your configuration.`;
}

// Full markdown report for an editor tab: grouped by file, copyable paths, fix guidance. The tab
// stays open so the user can act on it at leisure (which files to open, which keys to change).
export function buildReportMarkdown(issues: Issue[], lang: Lang): string {
  const ru = lang === 'ru';
  const lines: string[] = [];
  lines.push(ru ? '# WireFerry — проверка конфигурации' : '# WireFerry — configuration check');
  lines.push('');
  lines.push(
    ru
      ? 'Найдены устаревшие или неподдерживаемые параметры. Откройте указанные файлы и поправьте строки ниже. Это окно можно закрыть в любой момент.'
      : 'Found legacy or unsupported settings. Open the files below and fix the listed lines. You can close this tab anytime.'
  );
  lines.push('');

  const byFile = new Map<string, Issue[]>();
  for (const issue of issues) {
    const arr = byFile.get(issue.file) || [];
    arr.push(issue);
    byFile.set(issue.file, arr);
  }
  for (const [file, fileIssues] of byFile) {
    lines.push(`## \`${file}\``);
    lines.push('');
    for (const issue of fileIssues) {
      const where = issue.line > 0 ? (ru ? `строка ${issue.line}` : `line ${issue.line}`) : '';
      lines.push(`- ${where ? where + ' — ' : ''}\`${issue.key}\` — ${recommendation(issue, lang)}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push(
    ru
      ? '_Отключить напоминания: настройка `wireferry.suppressLegacyConfigNotice`._'
      : '_To stop these reminders: setting `wireferry.suppressLegacyConfigNotice`._'
  );
  return lines.join('\n');
}
