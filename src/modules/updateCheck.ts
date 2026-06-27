import * as vscode from 'vscode';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import * as fse from 'fs-extra';
import { EXTENSION_NAME, SETTING_CHECK_FOR_UPDATES, GITHUB_REPO, CONFIG_PATH } from '../constants';
import { getUserSetting, getWorkspaceFolders } from '../host';
import { isSettingExplicitlySet } from './ext';
import { reportError } from '../helper';
import { L } from '../i18n';

// Opt-in GitHub update check (Part 8). Runs once per window, in the background, and only ever
// touches the network after explicit consent. Deliberately does NOT install anything: it
// downloads the .vsix and lets the user install it (avoids a download-and-execute pattern).
const EXTENSION_ID = 'EvgeniiShapovalov.wireferry';
let ranThisSession = false;

interface LatestRelease {
  version: string;
  vsixUrl?: string;
  htmlUrl: string;
}

export async function runUpdateCheck(): Promise<void> {
  if (ranThisSession) {
    return;
  }
  ranThisSession = true;

  const enabled = await ensureConsent();
  if (!enabled) {
    return;
  }

  try {
    const current = getCurrentVersion();
    const latest = await fetchLatestRelease();
    if (latest && isNewer(latest.version, current)) {
      await promptDownload(current, latest, /* install */ false);
    }
  } catch (e) {
    // Network/parse failures are non-fatal and stay silent — never nag about a failed check.
  }
}

// First-run consent: if the user never set wireferry.checkForUpdates, ask once and persist the
// choice, so the first network call only happens with explicit permission.
async function ensureConsent(): Promise<boolean> {
  const config = getUserSetting(EXTENSION_NAME);
  if (isSettingExplicitlySet(SETTING_CHECK_FOR_UPDATES)) {
    return config.get<boolean>(SETTING_CHECK_FOR_UPDATES, true);
  }

  const YES = L({ en: 'Yes', ru: 'Да' });
  const NO = L({ en: 'No', ru: 'Нет' });
  const choice = await vscode.window.showInformationMessage(
    L({
      en: 'WireFerry: check GitHub for updates on startup? This makes one HTTPS request to api.github.com (release version only — no telemetry, nothing about you is sent).',
      ru: 'WireFerry: проверять обновления на GitHub при запуске? Это один HTTPS-запрос к api.github.com (только номер версии — без телеметрии, ваши данные не отправляются).',
    }),
    YES,
    NO
  );
  if (choice !== YES && choice !== NO) {
    return false; // dismissed — leave unset and ask again next start
  }
  const enabled = choice === YES;
  try {
    await config.update(SETTING_CHECK_FOR_UPDATES, enabled, vscode.ConfigurationTarget.Global);
  } catch (e) {
    reportError(e, 'persist checkForUpdates');
  }
  return enabled;
}

// Manual "Check for Updates" command (Part 9). Explicit user action, so no consent gate, and —
// per the user's choice — it offers to download AND install (vs. the background check which only
// downloads). Reports "you're up to date" / "couldn't reach GitHub" so the click always answers.
export async function checkForUpdatesNow(): Promise<void> {
  const current = getCurrentVersion();
  let latest: LatestRelease | null = null;
  try {
    latest = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: L({ en: 'WireFerry: checking GitHub for updates…', ru: 'WireFerry: проверяю обновления на GitHub…' }),
      },
      () => fetchLatestRelease()
    );
  } catch (e) {
    latest = null;
  }

  if (!latest) {
    vscode.window.showWarningMessage(
      L({
        en: 'WireFerry: could not reach GitHub to check for updates.',
        ru: 'WireFerry: не удалось связаться с GitHub для проверки обновлений.',
      })
    );
    return;
  }
  if (!isNewer(latest.version, current)) {
    vscode.window.showInformationMessage(
      L({
        en: `WireFerry: you are on the latest version (${current}).`,
        ru: `WireFerry: у вас последняя версия (${current}).`,
      })
    );
    return;
  }
  await promptDownload(current, latest, /* install */ true);
}

// Offer the update. With `install` the .vsix is downloaded then installed via VS Code's own
// installExtension command (followed by an optional reload); otherwise it is only downloaded and
// revealed for a manual "Install from VSIX…". Either way nothing runs without the user's click.
async function promptDownload(
  current: string,
  latest: LatestRelease,
  install: boolean
): Promise<void> {
  const ACTION = install
    ? L({ en: 'Download & install', ru: 'Скачать и установить' })
    : L({ en: 'Download', ru: 'Скачать' });
  const choice = await vscode.window.showInformationMessage(
    L({
      en: `WireFerry: a newer release is on GitHub. Update from ${current} to ${latest.version}?`,
      ru: `WireFerry: на GitHub есть новая версия. Обновить с ${current} до ${latest.version}?`,
    }),
    { modal: true },
    ACTION
  );
  if (choice !== ACTION) {
    return; // No / dismissed — stay quiet until the next restart
  }

  if (!latest.vsixUrl) {
    vscode.env.openExternal(vscode.Uri.parse(latest.htmlUrl));
    return;
  }

  // Sanitise the release tag before it becomes part of an on-disk filename that gets handed to
  // installExtension: a tampered/compromised release must not be able to steer the path (e.g. via
  // path separators or `..`). GitHub ref rules already forbid most of this, but defend anyway.
  const safeVersion = String(latest.version || '');
  if (!/^[0-9A-Za-z._-]+$/.test(safeVersion)) {
    reportError(new Error(`Refusing release tag with unexpected characters: ${latest.version}`), 'update');
    vscode.env.openExternal(vscode.Uri.parse(latest.htmlUrl));
    return;
  }
  const dest = path.join(getDownloadDir(), `wireferry-${safeVersion}.vsix`);
  try {
    await fse.ensureDir(path.dirname(dest));
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: L({ en: `Downloading WireFerry ${latest.version}…`, ru: `Скачиваю WireFerry ${latest.version}…` }),
      },
      () => downloadFile(latest.vsixUrl as string, dest)
    );
  } catch (e) {
    reportError(e, 'download vsix');
    vscode.env.openExternal(vscode.Uri.parse(latest.htmlUrl));
    return;
  }

  if (install) {
    await installVsix(dest, latest.version);
  } else {
    const SHOW = L({ en: 'Show file', ru: 'Показать файл' });
    const pick = await vscode.window.showInformationMessage(
      L({
        en: `WireFerry ${latest.version} downloaded. Install it via the Extensions view → "Install from VSIX…".`,
        ru: `WireFerry ${latest.version} скачан. Установите его через панель «Расширения» → «Install from VSIX…».`,
      }),
      SHOW
    );
    if (pick === SHOW) {
      vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(dest));
    }
  }
}

async function installVsix(vsixPath: string, version: string): Promise<void> {
  try {
    await vscode.commands.executeCommand(
      'workbench.extensions.installExtension',
      vscode.Uri.file(vsixPath)
    );
    // VS Code has copied the .vsix into its own extensions dir by now, so the downloaded copy is
    // spent — remove it so we don't leave a stray .vsix next to the user's config. Best-effort.
    try {
      await fse.remove(vsixPath);
    } catch (e) {
      // Leaving the file behind is harmless; never let cleanup failure surface as an install error.
    }
    const RELOAD = L({ en: 'Reload window', ru: 'Перезагрузить окно' });
    const pick = await vscode.window.showInformationMessage(
      L({
        en: `WireFerry ${version} installed. Reload the window to activate it.`,
        ru: `WireFerry ${version} установлен. Перезагрузите окно, чтобы активировать.`,
      }),
      RELOAD
    );
    if (pick === RELOAD) {
      vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
  } catch (e) {
    reportError(e, 'install vsix');
    const SHOW = L({ en: 'Show file', ru: 'Показать файл' });
    const pick = await vscode.window.showWarningMessage(
      L({
        en: `WireFerry: automatic install failed. Install ${path.basename(vsixPath)} manually via "Install from VSIX…".`,
        ru: `WireFerry: автоматическая установка не удалась. Установите ${path.basename(vsixPath)} вручную через «Install from VSIX…».`,
      }),
      SHOW
    );
    if (pick === SHOW) {
      vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(vsixPath));
    }
  }
}

// Where the downloaded .vsix lands: next to the config (the first workspace folder's .vscode,
// alongside wireferry.json) so it's easy to find, instead of buried in the OS temp dir. Falls
// back to the temp dir when no folder is open. The installer deletes it afterwards (see installVsix).
function getDownloadDir(): string {
  const folders = getWorkspaceFolders();
  if (folders && folders.length > 0) {
    return path.join(folders[0].uri.fsPath, path.dirname(CONFIG_PATH));
  }
  return os.tmpdir();
}

function getCurrentVersion(): string {
  const ext = vscode.extensions.getExtension(EXTENSION_ID);
  return ext && ext.packageJSON ? String(ext.packageJSON.version) : '0.0.0';
}

// Compare dotted versions numerically: true when `a` is strictly newer than `b`.
function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map(n => parseInt(n, 10) || 0);
  const pb = b.split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) {
      return x > y;
    }
  }
  return false;
}

function fetchLatestRelease(): Promise<LatestRelease | null> {
  return new Promise(resolve => {
    const req = https.get(
      {
        hostname: 'api.github.com',
        path: `/repos/${GITHUB_REPO}/releases/latest`,
        headers: { 'User-Agent': 'WireFerry-VSCode', Accept: 'application/vnd.github+json' },
        timeout: 8000,
      },
      res => {
        if (res.statusCode !== 200) {
          res.resume();
          return resolve(null);
        }
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            const version = String(json.tag_name || '').replace(/^v/, '');
            const assets: any[] = Array.isArray(json.assets) ? json.assets : [];
            const vsix = assets.find(a => a && /\.vsix$/i.test(a.name));
            resolve({
              version,
              vsixUrl: vsix ? vsix.browser_download_url : undefined,
              htmlUrl: String(json.html_url || `https://github.com/${GITHUB_REPO}/releases`),
            });
          } catch (e) {
            resolve(null);
          }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

// Only follow the download (and its redirects) to GitHub-owned hosts over https. The .vsix gets
// installed afterwards, so a redirect to an arbitrary host would be a code-execution vector.
function isTrustedGithubUrl(target: string): boolean {
  try {
    const u = new URL(target);
    if (u.protocol !== 'https:') {
      return false;
    }
    const host = u.hostname.toLowerCase();
    return (
      host === 'github.com' ||
      host === 'api.github.com' ||
      host === 'objects.githubusercontent.com' ||
      host.endsWith('.githubusercontent.com')
    );
  } catch (e) {
    return false;
  }
}

// Stream a URL to a file, following GitHub's redirect to the asset CDN.
function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const get = (target: string, redirects: number) => {
      if (!isTrustedGithubUrl(target)) {
        return reject(new Error(`refusing to download from untrusted URL: ${target}`));
      }
      https
        .get(target, { headers: { 'User-Agent': 'WireFerry-VSCode' }, timeout: 30000 }, res => {
          const status = res.statusCode || 0;
          if (status >= 300 && status < 400 && res.headers.location && redirects < 5) {
            res.resume();
            return get(res.headers.location, redirects + 1);
          }
          if (status !== 200) {
            res.resume();
            return reject(new Error(`HTTP ${status}`));
          }
          const file = fse.createWriteStream(dest);
          res.pipe(file);
          file.on('finish', () => file.close(() => resolve()));
          file.on('error', err => {
            // Stop the response draining into a dead write stream before bailing out.
            res.unpipe(file);
            res.destroy();
            reject(err);
          });
        })
        .on('error', reject)
        .on('timeout', function (this: any) {
          this.destroy();
          reject(new Error('download timeout'));
        });
    };
    get(url, 0);
  });
}
