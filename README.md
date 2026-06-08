# WireFerry

**SFTP & FTP file sync and deploy for VS Code**

[![Latest release](https://img.shields.io/github/v/release/e-u-shapovalov/vscode-sftp)](https://github.com/e-u-shapovalov/vscode-sftp/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://github.com/e-u-shapovalov/vscode-sftp/blob/develop/LICENSE)

WireFerry connects your VS Code workspace to a remote server over **SFTP**, **FTP** and **FTPS**, so you can upload, download and deploy without leaving the editor. Edit a file locally, hit save, and WireFerry pushes it to the host; pull a whole project down with one command; or keep both sides in step with two-way **sync**. Connections run over **SSH** for SFTP, with optional connection hopping through intermediate hosts.

A dedicated **Remote Explorer** lets you browse the server's filesystem like a second tree: open files for viewing, edit them locally, **diff** a local file against its remote copy, and drag entries between folders. Transfers work on single files, folders or the entire project, against one profile or all profiles at once — handy when the same code ships to staging and production.

WireFerry is an independent VS Code extension built for everyday remote-development and deploy workflows: keeping a live site, a CI artifact or a staging box up to date straight from the source you are editing.

- **Latest release (VSIX):** <https://github.com/e-u-shapovalov/vscode-sftp/releases/latest>
- **Issues:** <https://github.com/e-u-shapovalov/vscode-sftp/issues>

---

## What's New · Что нового

**English — in short**
- **2.0.0** — new name: **WireFerry**. New icon, commands & settings moved to the `wireferry.*` prefix, and config is now `.vscode/wireferry.json` (legacy `.vscode/sftp.json` still read). Update any custom `sftp.*` keybindings/settings to `wireferry.*`.
- **1.1.2** — maintenance release: security hardening (validates server-sent filenames and SSH connection fields).
- **1.1.1** — rename & move: "Rename" a server file via right-click, auto-sync when you rename/move locally, and drag&drop between folders in the server tree. Plus a large dependency & toolchain update (minimum VS Code is now 1.66).
- **1.0.9** — open a server file by its full path with one button.
- **1.0.6** — newly created files show in the tree instantly, no manual Refresh (folders since 1.0.4).
- **1.0.2** — "Copy Path": copy a file/folder's server-side path.
- **1.0.0** — works on Node 22+; safe delete with a modal confirmation.

**Русский — коротко**
- **2.0.0** — новое имя: **WireFerry**. Новая иконка, команды и настройки переехали на префикс `wireferry.*`, файл конфигурации теперь `.vscode/wireferry.json` (старый `.vscode/sftp.json` ещё читается). Свои горячие клавиши/настройки под `sftp.*` обновите на `wireferry.*`.
- **1.1.2** — технический релиз: усиление безопасности (проверка имён файлов, присланных сервером, и полей SSH-подключения).
- **1.1.1** — переименование и перемещение: «Rename» по ПКМ на сервере, авто-синхрон при локальном переименовании/переносе, drag&drop между папками в дереве сервера. Плюс большое обновление зависимостей и движка (минимум VS Code теперь 1.66).
- **1.0.9** — открыть файл на сервере по полному пути одной кнопкой.
- **1.0.6** — созданные файлы сразу видны в дереве без «Обновить» (папки — ещё с 1.0.4).
- **1.0.2** — «Copy Path»: копировать серверный путь файла/папки.
- **1.0.0** — работает на Node 22+; безопасное удаление с модальным подтверждением.

> Full release notes / полный список изменений: the **CHANGELOG** tab in the extension, or
> [CHANGELOG.md](https://github.com/e-u-shapovalov/vscode-sftp/blob/develop/CHANGELOG.md).

---

## Features

- **Remote Explorer** — browse the remote server right inside VS Code (see the section below).
- **Open Remote File by Path** — jump straight to any server file by its full path. _(new in 1.0.9)_
- **Copy Path** — copy a file/folder's server-side path to the clipboard. _(new in 1.0.2)_
- **Upload / Download** files, folders or the whole project — to one profile or to all profiles at once.
- **Sync** a directory: local → remote, remote → local, or both ways.
- **Diff** a local file against its remote counterpart.
- **Upload on save** and a **File Watcher**.
- **Multiple configurations** and **switchable profiles**.
- **Connection hopping** — reach a target server through one or more SSH proxies.
- **Safe delete** — deleting in the Remote Explorer asks first and sends the local copy to the OS Trash.

---

## Installation · Установка

WireFerry can also be installed from a `.vsix` file — download the latest from the
**[releases page](https://github.com/e-u-shapovalov/vscode-sftp/releases/latest)**, named
`wireferry-<version>.vsix` (e.g. `wireferry-2.0.0.vsix`).

**English**

_Via the VS Code UI (buttons):_
1. Open the **Extensions** view (`Ctrl/Cmd + Shift + X`).
2. Click the **... (Views and More Actions)** button at the top-right of the panel.
3. Choose **Install from VSIX...**, pick the downloaded file, then **Reload** VS Code.

_Via the command line:_
```
code --install-extension wireferry-2.0.0.vsix
```
Run it from the folder where you downloaded the file (use the real version number).

> If you're replacing another SFTP extension, disable or uninstall it first.

**Русский**

_Через интерфейс VS Code (кнопками):_
1. Откройте панель **Extensions / Расширения** (`Ctrl/Cmd + Shift + X`).
2. Нажмите кнопку **... (Views and More Actions)** в правом верхнем углу панели.
3. Выберите **Install from VSIX... / Установить из VSIX...**, укажите скачанный файл и **перезагрузите** VS Code.

_Через консоль:_
```
code --install-extension wireferry-2.0.0.vsix
```
Запускайте из папки, куда скачали файл (подставьте актуальный номер версии).

> Если у вас установлено другое SFTP-расширение — сначала отключите или удалите его.

---

## Quick start

1. Open the local folder you want to sync (or an empty folder to download a remote project into).
2. `Ctrl/Cmd + Shift + P` → run **WireFerry: Config**. This creates `.vscode/wireferry.json`.
3. Fill in your server details, for example:
   ```json
   {
       "name": "Production",
       "host": "deploy.example.com",
       "protocol": "sftp",
       "port": 22,
       "username": "deploy",
       "remotePath": "/var/www/myapp",
       "uploadOnSave": false
   }
   ```
   `password` is optional — you'll be prompted on sync if it's left out. For key-based SFTP, point `privateKeyPath` at your key instead. _Note:_ backslashes and other special characters in JSON strings must be escaped with a backslash.
4. Save and close `wireferry.json`.
5. `Ctrl/Cmd + Shift + P` → type **WireFerry** to see all commands (also available from the file-explorer context menus).
6. To pull an existing remote project, run **WireFerry: Download Project** — it downloads `remotePath` into your local folder.
7. Edit locally; with `uploadOnSave` enabled, every save syncs to the server.

---

## Configuration

WireFerry reads its settings from `.vscode/wireferry.json`. A legacy `.vscode/sftp.json` is still picked up automatically if present, so older workspaces keep working without changes.

A minimal SFTP profile:

```json
{
  "host": "deploy.example.com",
  "protocol": "sftp",
  "username": "deploy",
  "remotePath": "/var/www/myapp"
}
```

The same idea over FTPS instead of SSH:

```jsonc
{
  "host": "deploy.example.com",
  "protocol": "ftp",
  "port": 21,
  "secure": true,           // FTP over TLS (FTPS)
  "username": "deploy",
  "remotePath": "/var/www/myapp",
  "uploadOnSave": true      // push every save to the server
}
```

More setups — **profiles**, **multiple contexts**, **connection hopping** (through an SSH proxy) and reading credentials from **User Settings** — are covered in the docs:

- [Full configuration reference](https://github.com/e-u-shapovalov/vscode-sftp/blob/develop/docs/configuration.md)
- [SFTP configuration](https://github.com/e-u-shapovalov/vscode-sftp/blob/develop/docs/sftp_configuration.md) · [FTP configuration](https://github.com/e-u-shapovalov/vscode-sftp/blob/develop/docs/ftp_configuration.md)

---

## Remote Explorer

![Remote Explorer preview](https://raw.githubusercontent.com/e-u-shapovalov/vscode-sftp/develop/assets/showcase/remote-explorer.png)

Browse remote files without leaving the editor. Open the Remote Explorer via:

1. the command **View: Show WireFerry**, or
2. the **WireFerry** icon in the Activity Bar.

By default, double-clicking only **views** a file's content; run **WireFerry: Edit in Local** to edit it locally. You can also use the **Open Remote File by Path** toolbar button to jump straight to a file by its server path.

**Multiple select** — hold `Ctrl` or `Shift` to select several files/folders at once for upload or download, just like the regular Explorer.

**Order** — sort the Remote Explorer with the `remoteExplorer.order` parameter in `wireferry.json`:

```json
{
  "remoteExplorer": {
    "order": 1
  }
}
```

---

## Debug

1. Open **Settings** (`File → Preferences → Settings`, or `Code → Preferences → Settings` on macOS).
2. Set **`wireferry.debug`** to `true` and reload VS Code.
3. View the logs in **View → Output → WireFerry**.

---

## Documentation & FAQ

- [Home](https://github.com/e-u-shapovalov/vscode-sftp/blob/develop/docs/home.md) ·
  [Settings](https://github.com/e-u-shapovalov/vscode-sftp/blob/develop/docs/setting.md) ·
  [Common configuration](https://github.com/e-u-shapovalov/vscode-sftp/blob/develop/docs/common_configuration.md) ·
  [SFTP configuration](https://github.com/e-u-shapovalov/vscode-sftp/blob/develop/docs/sftp_configuration.md) ·
  [FTP configuration](https://github.com/e-u-shapovalov/vscode-sftp/blob/develop/docs/ftp_configuration.md) ·
  [Commands](https://github.com/e-u-shapovalov/vscode-sftp/blob/develop/docs/commands.md)
- [Frequently Asked Questions](https://github.com/e-u-shapovalov/vscode-sftp/blob/develop/FAQ.md)

---

## Credits & License

WireFerry is an independent fork in the vscode-sftp lineage (liximomo → Natizyskunk), developed separately by [Evgenii Shapovalov](https://github.com/e-u-shapovalov). Licensed under **MIT** — see [`LICENSE`](https://github.com/e-u-shapovalov/vscode-sftp/blob/develop/LICENSE). The original copyright notice is retained per the MIT terms; fork copyright © 2026 Evgenii Shapovalov.
