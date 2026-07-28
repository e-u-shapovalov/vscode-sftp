import * as vscode from 'vscode';
import { L } from '../i18n';
import { getExtensionSetting } from '../modules/ext';
import * as output from './output';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ReportKind = 'upload' | 'download' | 'delete';

/** Server-side or local-side stat snapshot for a single path. */
export interface FileSideStat {
  size: number;
  mode: number;
  mtime: number;
}

/** One line in the operation log. */
export interface Row {
  /** Short verb: 'uploaded', 'downloaded', 'deleted', … */
  action: string;
  /** The primary path (remote for delete; local for upload/download). */
  path: string;
  /** For delete rows: where the deletion happened. */
  scope?: 'server' | 'local' | 'both';
  /** Server-side stat at the moment of the operation. */
  server?: FileSideStat | null;
  /** Local-side stat at the moment of the operation. */
  local?: FileSideStat | null;
  /** Optional extra note shown after the path. */
  note?: string;
  /** True for a failed operation — drives the ✖ marker and the result tally. */
  failed?: boolean;
}

// ─── Module state ─────────────────────────────────────────────────────────────

interface ActiveReport {
  kind: ReportKind;
  rows: Row[];
  // Ref-count so two overlapping commands share one session and the LAST to finish renders —
  // otherwise the first finisher nulls `active` out from under a still-running second command.
  refs: number;
}

let active: ActiveReport | null = null;

// ─── Public API ──────────────────────────────────────────────────────────────

export function isActive(): boolean {
  return active !== null;
}

export function addRow(row: Row): void {
  if (active) {
    active.rows.push(row);
  }
}

/**
 * Run `work` inside a report session for `kind`.
 * If a session is already active (nested call) the work joins it without opening a second tab.
 * After `work` completes the rendered log is opened as a virtual document.
 */
export async function withReport<T>(kind: ReportKind, work: () => Promise<T>): Promise<T> {
  let session: ActiveReport;
  if (active) {
    // Already inside a session — join it (one tab) rather than stacking tabs.
    session = active;
    session.refs += 1;
  } else {
    session = { kind, rows: [], refs: 1 };
    active = session;
  }

  try {
    return await work();
  } finally {
    session.refs -= 1;
    // Only the last participant tears the session down and opens the tab — so an early-finishing
    // command can't drop a still-running one's rows.
    if (session.refs === 0) {
      if (active === session) {
        active = null;
      }
      if (session.rows.length > 0) {
        // Open after work() completes: non-blocking relative to the operation itself.
        await openReport(session.kind, session.rows).catch(() => {
          // Never let a display failure surface as an error from the operation.
        });
      }
    }
  }
}

// ─── Virtual document provider ───────────────────────────────────────────────

export const REPORT_SCHEME = 'wireferry-report';

// Map keyed by URI string; holds the rendered text for each open report tab.
const reportContents = new Map<string, string>();

export const reportProvider: vscode.TextDocumentContentProvider = {
  provideTextDocumentContent(uri: vscode.Uri): string {
    return reportContents.get(uri.toString()) ?? '';
  },
};

// ─── Formatting helpers ──────────────────────────────────────────────────────

/** Human-readable byte size: B / KB / MB / GB, one decimal place except for plain bytes. */
function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Format Unix mode bits as "644 (rw-r--r--)".
 * Mirrors the formatMode() helper in treeDataProvider.ts (not exported from there).
 */
function formatPerm(mode: number): string {
  // tslint:disable-next-line:no-bitwise
  const bits = mode & 0o777;
  const octal = bits.toString(8).padStart(3, '0');
  const symbols = [0o400, 0o200, 0o100, 0o040, 0o020, 0o010, 0o004, 0o002, 0o001]
    // tslint:disable-next-line:no-bitwise
    .map((bit, i) => (bits & bit ? 'rwx'[i % 3] : '-'))
    .join('');
  return `${octal} (${symbols})`;
}

/** YYYY-MM-DD HH:mm from millisecond epoch. */
function formatDate(mtimeMs: number): string {
  const d = new Date(mtimeMs);
  if (isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Format a single side (local or server). */
function formatSide(stat: FileSideStat | null | undefined): string {
  if (!stat) return L({ en: '(unavailable)', ru: '(недоступно)' });
  return `${humanSize(stat.size).padEnd(10)}  ${formatPerm(stat.mode)}  ${formatDate(stat.mtime)}`;
}

/** True if the two stat snapshots differ in a meaningful way (size, mtime to the second, or mode). */
function statsDiffer(a: FileSideStat | null | undefined, b: FileSideStat | null | undefined): boolean {
  if (!a || !b) return false;
  // tslint:disable-next-line:no-bitwise
  return a.size !== b.size || Math.floor(a.mtime / 1000) !== Math.floor(b.mtime / 1000) || (a.mode & 0o777) !== (b.mode & 0o777);
}

// ─── Renderer ────────────────────────────────────────────────────────────────

function kindLabel(kind: ReportKind): string {
  return kind === 'upload'
    ? L({ en: 'upload', ru: 'выгрузка' })
    : kind === 'download'
    ? L({ en: 'download', ru: 'скачивание' })
    : L({ en: 'delete', ru: 'удаление' });
}

function renderRows(kind: ReportKind, rows: Row[]): string {
  const now = formatDate(Date.now());
  const heading = `${kind}.log — ${now}, ${rows.length} ${L({ en: 'entries', ru: 'записей' })}  [${kindLabel(kind)}]`;
  const separator = '─'.repeat(Math.max(heading.length, 60));

  const lines: string[] = [heading, separator, ''];

  // One-line tally up top when anything failed, so a fan-out run (e.g. Upload to All Profiles) shows
  // "where it went / where it didn't" at a glance instead of scanning every row.
  const failedCount = rows.filter(r => r.failed).length;
  if (failedCount > 0) {
    const okCount = rows.length - failedCount;
    lines.push(
      L({ en: `Result: ${okCount} ok, ${failedCount} failed`, ru: `Итог: успешно ${okCount}, с ошибкой ${failedCount}` }),
      ''
    );
  }

  for (const row of rows) {
    // Primary entry line: "✖ ACTION  /some/path  [scope]  — note"
    let primary = `${row.failed ? '✖ ' : ''}${row.action.padEnd(12)}${row.path}`;
    if (row.scope) {
      primary += `  [${row.scope}]`;
    }
    if (row.note) {
      primary += `  — ${row.note}`;
    }
    lines.push(primary);

    // Only show a side that actually has a stat — skip both "not applicable" (undefined, e.g. the
    // server side of a transfer row) and "stat failed" (null), so the log doesn't carry empty
    // "(unavailable)" lines.
    const hasLocal = row.local != null;
    const hasServer = row.server != null;

    if (hasLocal || hasServer) {
      const differ = statsDiffer(row.local, row.server);
      if (hasLocal) {
        lines.push(`  ${L({ en: 'local ', ru: 'локал.' })} : ${formatSide(row.local)}`);
      }
      if (hasServer) {
        lines.push(`  ${L({ en: 'server', ru: 'сервер' })}: ${formatSide(row.server)}${differ ? `  ← ${L({ en: 'differ', ru: 'различаются' })}` : ''}`);
      }
    }

    lines.push('');
  }

  return lines.join('\n');
}

// Open an arbitrary read-only text report in a tab (reuses the same virtual-doc provider). The
// timestamp query makes each open a distinct URI so VS Code never serves stale cached content.
export async function openTextReport(fileName: string, body: string): Promise<void> {
  const uri = vscode.Uri.parse(`${REPORT_SCHEME}:/${fileName}?${Date.now()}`);
  reportContents.set(uri.toString(), body);
  // Bound memory: the provider only needs content for tabs the user might still reopen; drop the
  // oldest once we're past a sane cap so a long session doesn't accumulate every report ever shown.
  while (reportContents.size > 20) {
    reportContents.delete(reportContents.keys().next().value);
  }
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, { preview: false });
}

// A run that lost files must stay visible even when the log itself is muted. Some failures reach the
// user ONLY through the report: a permission-denied upload takes the recovery branch instead of the
// error toast (serviceManager.afterTransfer), and that branch goes quiet for every file after the
// first while the single-dialog gate is held — Upload Modified holds it for the whole batch on
// purpose. So `off`/`output` suppress the log, never the fact that something failed: one toast with
// the tally, and the full log one click away for whoever wants it.
function warnAboutFailures(kind: ReportKind, rows: Row[], body: string): void {
  const failedCount = rows.filter(r => r.failed).length;
  if (failedCount === 0) {
    return;
  }
  const okCount = rows.length - failedCount;
  const showLog = L({ en: 'Show log', ru: 'Показать журнал' });
  // Fire-and-forget: awaiting the toast would keep the command "running" until the user dismisses it.
  void Promise.resolve(
    vscode.window.showWarningMessage(
      L({
        en: `WireFerry ${kindLabel(kind)}: ${okCount} ok, ${failedCount} failed.`,
        ru: `WireFerry, ${kindLabel(kind)}: успешно ${okCount}, с ошибкой ${failedCount}.`,
      }),
      showLog
    )
  ).then(pick => {
    if (pick === showLog) {
      return openTextReport(`${kind}.log`, body);
    }
    return undefined;
  }, () => {
    // A display failure must never surface as an error from the operation itself.
  });
}

// The automatic post-transfer log. Unlike the on-demand reports (tree.txt, folder-size.txt, the
// needs-root preview) nobody asked for this one, so `wireferry.operationLog` decides where it goes:
// a tab (default), the output channel, or nowhere. Read live so a change applies without a reload.
async function openReport(kind: ReportKind, rows: Row[]): Promise<void> {
  const mode = getExtensionSetting().operationLog;
  // Rendered up front in every mode: `off` still needs a body behind the "Show log" button, and the
  // renderer is pure, so paying for it costs nothing but the string.
  const body = renderRows(kind, rows);

  if (mode === 'off') {
    warnAboutFailures(kind, rows, body);
    return;
  }

  if (mode === 'output') {
    // Append only — revealing the panel would be the very interruption this mode exists to avoid.
    output.print(`\n${body}`);
    warnAboutFailures(kind, rows, body);
    return;
  }

  await openTextReport(`${kind}.log`, body);
}
