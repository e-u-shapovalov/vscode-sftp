import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fse from 'fs-extra';
import { parse as parseJsonc, modify, applyEdits } from 'jsonc-parser';
import {
  CONFIG_PATH,
  LEGACY_CONFIG_PATH,
  CONFIG_KEY_KEEP_LEGACY,
  SETTING_SUPPRESS_LEGACY_NOTICE,
  EXTENSION_NAME,
} from '../../constants';
import { KNOWN_CONFIG_KEYS } from '../config';
import { getExtensionSetting } from '../ext';
import { getUserSetting, getWorkspaceFolders } from '../../host';
import { reportError } from '../../helper';
import { L, getAlertLang } from '../../i18n';
import * as output from '../../ui/output';
import { openReportTab } from '../../ui/reportTab';
import { scanSettings, scanConfig, Issue, IssueKind } from './scan';
import { buildSummary, formatIssue, buildReportMarkdown } from './report';
import { migrateSettingsText } from './autofix';
import { getConfigTemplate } from './template';
import { ensureFilePermText } from './ensureFilePerm';

// Per-window-session dedup: the doctor's notifications fire at most once per VS Code window.
let diagnosed = false;
const renamePrompted = new Set<string>();
const createPrompted = new Set<string>();

// workspaceState key: the user answered "don't ask in this project" to the create-config prompt.
const CREATE_DECLINED_KEY = (basePath: string) => `wireferry.createConfigDeclined:${basePath}`;

// Orchestrates the legacy-config doctor at startup. Best-effort: any failure is swallowed so it
// never blocks activation. Three independent concerns, in order:
//   1. auto-create a template config for a brand-new workspace (Part 6)
//   2. offer to rename a legacy .vscode/sftp.json -> wireferry.json (Part 4)
//   3. flag legacy/unsupported keys in settings.json and config files (Part 3)
//   4. backfill filePerm/dirPerm into a config that predates them (Part 7)
export async function runLegacyDoctor(context: vscode.ExtensionContext): Promise<void> {
  const folders = getWorkspaceFolders();
  if (folders) {
    for (const folder of folders) {
      await offerCreateConfig(context, folder.uri.fsPath);
      await offerConfigRename(folder.uri.fsPath);
      await ensureFilePermKeys(context, folder.uri.fsPath);
    }
  }
  await diagnoseLegacyKeys(folders);
}

// --- Part 7: backfill filePerm/dirPerm into an existing config that predates them -------------
// A config written before these options existed has no filePerm/dirPerm, so the new-file permission
// (issue #2) was invisible and un-tuneable. Surface it by writing the defaults straight into the file
// (the values MATCH the runtime defaults, so nothing changes behaviourally — the option just becomes
// visible and editable). Done at most once per config per project: the guard is set after the check so
// removing the key later is respected (we never re-add it). Skipped entirely when the user muted the
// doctor. Best-effort — any failure is swallowed so it never blocks activation.
async function ensureFilePermKeys(
  context: vscode.ExtensionContext,
  basePath: string
): Promise<void> {
  if (getExtensionSetting().suppressLegacyConfigNotice) {
    return;
  }
  const wfPath = path.join(basePath, CONFIG_PATH);
  const legacyPath = path.join(basePath, LEGACY_CONFIG_PATH);
  const configPath = fse.existsSync(wfPath)
    ? wfPath
    : fse.existsSync(legacyPath)
    ? legacyPath
    : undefined;
  if (!configPath) {
    return; // no config yet — offerCreateConfig handles fresh workspaces (its template has the keys)
  }
  const guardKey = `wireferry.filePermEnsured:${configPath}`;
  if (context.workspaceState.get(guardKey)) {
    return; // already checked this config in this project
  }

  try {
    const text = await fse.readFile(configPath, 'utf8');
    const { text: newText, added } = ensureFilePermText(text);
    if (added.length) {
      await fse.writeFile(configPath, newText);
      const name = path.basename(configPath);
      vscode.window.showInformationMessage(
        L({
          en: `WireFerry: added ${added.join(' & ')} to .vscode/${name} so new files/folders get safe permissions (644/755). Change them there anytime.`,
          ru: `WireFerry: добавил ${added.join(' и ')} в .vscode/${name} — новые файлы/папки получают безопасные права (644/755). Значения можно изменить прямо там.`,
        })
      );
    }
    // Only mark as done once the write actually succeeded (a failed write throws and skips this),
    // so a transient error retries next window instead of silently giving up.
    await context.workspaceState.update(guardKey, true);
  } catch (e) {
    reportError(e, 'ensureFilePermKeys');
  }
}

// --- Part 6: offer to create a config for a workspace that has none ---------------------------
// Asks first — a project may not need SFTP/FTP at all — instead of creating silently. "Don't ask in
// this project" is remembered in workspaceState; deleting the config and restarting asks again (the
// answer can also differ by alert language, so the template is generated fresh each time).
async function offerCreateConfig(
  context: vscode.ExtensionContext,
  basePath: string
): Promise<void> {
  const wfPath = path.join(basePath, CONFIG_PATH);
  const legacyPath = path.join(basePath, LEGACY_CONFIG_PATH);
  if (fse.existsSync(wfPath) || fse.existsSync(legacyPath)) {
    return; // a config already exists — nothing to offer
  }
  if (getExtensionSetting().suppressLegacyConfigNotice) {
    return;
  }
  if (context.workspaceState.get(CREATE_DECLINED_KEY(basePath))) {
    return; // user chose "don't ask in this project"
  }
  if (createPrompted.has(basePath)) {
    return; // already asked this window session
  }
  createPrompted.add(basePath);

  const CREATE = L({ en: 'Create config', ru: 'Создать конфиг' });
  const NOT_NOW = L({ en: 'Not now', ru: 'Не сейчас' });
  const NEVER = L({ en: "Don't ask in this project", ru: 'Не спрашивать в этом проекте' });
  const choice = await vscode.window.showInformationMessage(
    L({
      en: 'WireFerry: set up SFTP/FTP for this project? A commented config template will be created at .vscode/wireferry.json.',
      ru: 'WireFerry: настроить SFTP/FTP для этого проекта? Будет создан шаблон .vscode/wireferry.json с комментариями.',
    }),
    CREATE,
    NOT_NOW,
    NEVER
  );

  if (choice === CREATE) {
    await createConfigTemplate(wfPath);
  } else if (choice === NEVER) {
    await context.workspaceState.update(CREATE_DECLINED_KEY(basePath), true);
  }
  // NOT_NOW / dismissed: do nothing — it asks again next window session.
}

// Write the commented template (in the current alert language), open it, and prompt the user to fill
// it in. Used by the create prompt above.
async function createConfigTemplate(wfPath: string): Promise<void> {
  try {
    await fse.outputFile(wfPath, getConfigTemplate(getAlertLang()));
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(wfPath));
    await vscode.window.showTextDocument(doc);
    vscode.window.showInformationMessage(
      L({
        en: 'WireFerry: created a config template at .vscode/wireferry.json — fill in your real server details.',
        ru: 'WireFerry: создан шаблон .vscode/wireferry.json — впишите свои реальные данные сервера.',
      })
    );
  } catch (e) {
    reportError(e, 'createConfigTemplate');
  }
}

// --- Part 4: offer to rename a legacy-only sftp.json to wireferry.json ------------------------
async function offerConfigRename(basePath: string): Promise<void> {
  const wfPath = path.join(basePath, CONFIG_PATH);
  const legacyPath = path.join(basePath, LEGACY_CONFIG_PATH);
  if (!fse.existsSync(legacyPath) || fse.existsSync(wfPath)) {
    return; // only when legacy exists and the new name doesn't
  }
  if (renamePrompted.has(basePath)) {
    return;
  }

  let legacyText: string;
  try {
    legacyText = await fse.readFile(legacyPath, 'utf8');
  } catch (e) {
    return;
  }
  if (hasKeepLegacyMarker(legacyText) || getExtensionSetting().suppressLegacyConfigNotice) {
    return;
  }
  renamePrompted.add(basePath);

  const RENAME = L({ en: 'Rename to wireferry.json', ru: 'Переименовать в wireferry.json' });
  const KEEP = L({ en: 'Keep sftp.json', ru: 'Оставить sftp.json' });
  const choice = await vscode.window.showInformationMessage(
    L({
      en: 'WireFerry: this project still uses the legacy .vscode/sftp.json. Rename it to .vscode/wireferry.json? Legacy support may be dropped starting with 3.0.0.',
      ru: 'WireFerry: проект всё ещё использует устаревший .vscode/sftp.json. Переименовать в .vscode/wireferry.json? Поддержка устаревшего формата может быть прекращена начиная с 3.0.0.',
    }),
    RENAME,
    KEEP
  );

  if (choice === RENAME) {
    try {
      await vscode.workspace.fs.rename(vscode.Uri.file(legacyPath), vscode.Uri.file(wfPath), {
        overwrite: false,
      });
      vscode.window.showInformationMessage(
        L({
          en: 'WireFerry: renamed to .vscode/wireferry.json.',
          ru: 'WireFerry: переименовано в .vscode/wireferry.json.',
        })
      );
    } catch (e) {
      reportError(e, 'rename config');
    }
  } else if (choice === KEEP) {
    const typed = await vscode.window.showInputBox({
      title: L({ en: 'Keep the legacy config name', ru: 'Оставить устаревшее имя конфига' }),
      prompt: L({
        en: 'Type "yes" to confirm: keep .vscode/sftp.json and stop these migration prompts.',
        ru: 'Введите «yes» для подтверждения: оставить .vscode/sftp.json и больше не напоминать о переименовании.',
      }),
      ignoreFocusOut: true,
    });
    if (typed && typed.trim().toLowerCase() === 'yes') {
      await writeKeepLegacyMarker(legacyPath, legacyText);
      vscode.window.showInformationMessage(
        L({
          en: 'WireFerry: keeping sftp.json. Remove "keepLegacyConfigFormat" later to re-enable migration.',
          ru: 'WireFerry: оставляем sftp.json. Удалите «keepLegacyConfigFormat» позже, чтобы вернуть миграцию.',
        })
      );
    }
  }
}

function hasKeepLegacyMarker(text: string): boolean {
  const parsed = parseJsonc(text);
  const obj = Array.isArray(parsed) ? parsed[0] : parsed;
  return Boolean(obj && obj[CONFIG_KEY_KEEP_LEGACY] === true);
}

async function writeKeepLegacyMarker(filePath: string, text: string): Promise<void> {
  try {
    const parsed = parseJsonc(text);
    const jsonPath = Array.isArray(parsed)
      ? [0, CONFIG_KEY_KEEP_LEGACY]
      : [CONFIG_KEY_KEEP_LEGACY];
    const newText = applyEdits(
      text,
      modify(text, jsonPath, true, { formattingOptions: { tabSize: 4, insertSpaces: true } })
    );
    await fse.writeFile(filePath, newText);
  } catch (e) {
    reportError(e, 'writeKeepLegacyMarker');
  }
}

// --- Part 3: flag legacy/unsupported keys in settings.json and config files -------------------
async function diagnoseLegacyKeys(
  folders: readonly vscode.WorkspaceFolder[] | undefined
): Promise<void> {
  if (diagnosed || getExtensionSetting().suppressLegacyConfigNotice) {
    return;
  }
  diagnosed = true;
  const lang = getAlertLang();

  const issues: Issue[] = [];

  const settingsPath = getUserSettingsPath();
  let settingsText = '';
  if (settingsPath && fse.existsSync(settingsPath)) {
    try {
      settingsText = await fse.readFile(settingsPath, 'utf8');
      issues.push(...scanSettings(settingsText, settingsPath, getKnownSettingKeys()));
    } catch (e) {
      /* unreadable settings.json — skip */
    }
  }

  if (folders) {
    for (const folder of folders) {
      for (const rel of [CONFIG_PATH, LEGACY_CONFIG_PATH]) {
        const p = path.join(folder.uri.fsPath, rel);
        if (!fse.existsSync(p)) {
          continue;
        }
        try {
          issues.push(...scanConfig(await fse.readFile(p, 'utf8'), p, KNOWN_CONFIG_KEYS));
        } catch (e) {
          /* unreadable config — skip */
        }
      }
    }
  }

  if (!issues.length) {
    return;
  }

  // A transient popup is easy to miss, so also open a persistent report TAB with the full details
  // (paths, lines, what to change) that the user can read and act on at leisure.
  await openReportTab(buildReportMarkdown(issues, lang));
  output.print('--- WireFerry config check ---');
  issues.forEach(i => output.print(formatIssue(i, lang)));

  const renameable = issues.filter(
    i => i.kind === IssueKind.LegacyRename && i.file === settingsPath && i.replacement
  );

  const OPEN = L({ en: 'Open file', ru: 'Открыть файл' });
  const FIX = L({ en: 'Fix settings.json', ru: 'Исправить settings.json' });
  const DISMISS = L({ en: "Don't remind me", ru: 'Больше не напоминать' });
  const buttons = [OPEN];
  if (renameable.length) {
    buttons.push(FIX);
  }
  buttons.push(DISMISS);

  const choice = await vscode.window.showWarningMessage(buildSummary(issues, lang), ...buttons);
  if (choice === OPEN) {
    await openAtIssue(issues[0]);
  } else if (choice === FIX) {
    await autofixSettings(settingsPath as string, settingsText, renameable, lang);
  } else if (choice === DISMISS) {
    try {
      await getUserSetting(EXTENSION_NAME).update(
        SETTING_SUPPRESS_LEGACY_NOTICE,
        true,
        vscode.ConfigurationTarget.Global
      );
    } catch (e) {
      reportError(e, 'suppress legacy notice');
    }
  }
}

async function openAtIssue(issue: Issue): Promise<void> {
  try {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(issue.file));
    const editor = await vscode.window.showTextDocument(doc);
    if (issue.line > 0) {
      const pos = new vscode.Position(issue.line - 1, 0);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    }
  } catch (e) {
    reportError(e, 'openAtIssue');
  }
}

async function autofixSettings(
  settingsPath: string,
  text: string,
  renameIssues: Issue[],
  lang: 'en' | 'ru'
): Promise<void> {
  try {
    const renames = renameIssues.map(i => ({ from: i.key, to: i.replacement as string }));
    const newText = migrateSettingsText(text, renames);
    await fse.writeFile(settingsPath, newText);
    vscode.window.showInformationMessage(
      L({
        en: `WireFerry: migrated ${renames.length} setting(s) to the wireferry.* prefix in settings.json.`,
        ru: `WireFerry: перенесено настроек в префикс wireferry.* — ${renames.length} (в settings.json).`,
      })
    );
  } catch (e) {
    reportError(e, 'autofix settings');
  }
}

// Bare setting names from package.json contributes.configuration (e.g. "debug"), used by the
// settings scan to tell a known setting from an unsupported one.
function getKnownSettingKeys(): string[] {
  const ext = vscode.extensions.getExtension('EvgeniiShapovalov.wireferry');
  const pkg = ext && ext.packageJSON;
  const cfg = pkg && pkg.contributes && pkg.contributes.configuration;
  const props = cfg && cfg.properties ? cfg.properties : {};
  return Object.keys(props).map(k => k.replace(/^wireferry\./, ''));
}

// Best-effort path to the user's settings.json. VS Code exposes no API for this, so we derive it
// from the platform's standard location (honouring Insiders and portable installs). Returns
// undefined when nothing is found, in which case the caller simply skips the settings scan.
function getUserSettingsPath(): string | undefined {
  const portable = process.env.VSCODE_PORTABLE;
  if (portable) {
    return path.join(portable, 'user-data', 'User', 'settings.json');
  }
  const appDir =
    vscode.env.appName && vscode.env.appName.indexOf('Insiders') !== -1
      ? 'Code - Insiders'
      : 'Code';
  let base: string | undefined;
  if (process.platform === 'win32') {
    base = process.env.APPDATA;
  } else if (process.platform === 'darwin') {
    base = path.join(os.homedir(), 'Library', 'Application Support');
  } else {
    base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  }
  if (!base) {
    return undefined;
  }
  const candidate = path.join(base, appDir, 'User', 'settings.json');
  return fse.existsSync(candidate) ? candidate : undefined;
}
