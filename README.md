# SFTP Link

> Sync your workspace with a remote server over **SFTP / FTP**, right inside VS Code — browse, edit, upload, download, diff and watch.

[![VS Marketplace](https://img.shields.io/badge/VS%20Marketplace-SFTP%20Link-2b7cd3)](https://marketplace.visualstudio.com/items?itemName=EvgeniiShapovalov.sftp-link)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://github.com/e-u-shapovalov/vscode-sftp/blob/develop/LICENSE)

**SFTP Link** is a maintained, independent fork of [Natizyskunk's vscode-sftp](https://github.com/Natizyskunk/vscode-sftp) (itself a fork of [liximomo's vscode-sftp](https://github.com/liximomo/vscode-sftp)), maintained by [Evgenii Shapovalov](https://github.com/e-u-shapovalov). It is developed independently from the upstream forks; the original MIT license and copyright notice are preserved in [`LICENSE`](https://github.com/e-u-shapovalov/vscode-sftp/blob/develop/LICENSE).

- 🛒 **Marketplace:** <https://marketplace.visualstudio.com/items?itemName=EvgeniiShapovalov.sftp-link>
- 📦 **VSIX releases:** <https://github.com/e-u-shapovalov/vscode-sftp/releases>
- 🐞 **Issues:** <https://github.com/e-u-shapovalov/vscode-sftp/issues>

---

## ✨ What's New · Что нового

**English — in short**
- **1.1.1** — rename & move: "Rename" a server file via right-click, auto-sync when you rename/move locally, and drag&drop between folders in the server tree. Plus a large dependency & toolchain update (minimum VS Code is now 1.66).
- **1.0.9** — open a server file by its full path with one button.
- **1.0.6** — newly created files show in the tree instantly, no manual Refresh (folders since 1.0.4).
- **1.0.2** — "Copy Path": copy a file/folder's server-side path.
- **1.0.0** — works on Node 22+; safe delete with a modal confirmation.

**Русский — коротко**
- **1.1.1** — переименование и перемещение: «Rename» по ПКМ на сервере, авто-синхрон при локальном переименовании/переносе, drag&drop между папками в дереве сервера. Плюс большое обновление зависимостей и движка (минимум VS Code теперь 1.66).
- **1.0.9** — открыть файл на сервере по полному пути одной кнопкой.
- **1.0.6** — созданные файлы сразу видны в дереве без «Обновить» (папки — ещё с 1.0.4).
- **1.0.2** — «Copy Path»: копировать серверный путь файла/папки.
- **1.0.0** — работает на Node 22+; безопасное удаление с модальным подтверждением.

> Full release notes / полный список изменений: the **CHANGELOG** tab in the extension, or
> [CHANGELOG.md](https://github.com/e-u-shapovalov/vscode-sftp/blob/develop/CHANGELOG.md).

---

## 🚀 Features

- 🗂 **Remote Explorer** — browse the remote server right inside VS Code (see the section below).
- 🔎 **Open Remote File by Path** — jump straight to any server file by its full path. _(new in 1.0.9)_
- 📋 **Copy Path** — copy a file/folder's server-side path to the clipboard. _(new in 1.0.2)_
- ⬆️ ⬇️ **Upload / Download** files, folders or the whole project — to one profile or to all profiles at once.
- 🔁 **Sync** a directory: local → remote, remote → local, or both ways.
- 🔍 **Diff** a local file against its remote counterpart.
- 💾 **Upload on save** and a **File Watcher**.
- 🧩 **Multiple configurations** and **switchable profiles**.
- 🪜 **Connection hopping** — reach a target server through one or more SSH proxies.
- 🗑 **Safe delete** — deleting in the Remote Explorer asks first and sends the local copy to the OS Trash.

---

## 📦 Installation

### From the Marketplace
Search for **“SFTP Link”** in the Extensions view (`Ctrl/Cmd + Shift + X`), or open the
[Marketplace page](https://marketplace.visualstudio.com/items?itemName=EvgeniiShapovalov.sftp-link) and click **Install**.
If you're replacing another SFTP extension, disable or uninstall it first.

### From a VSIX
1. Open **Extensions** (`Ctrl/Cmd + Shift + X`).
2. If you're replacing another SFTP extension, uninstall or disable it first.
3. Download the `.vsix` from the [releases page](https://github.com/e-u-shapovalov/vscode-sftp/releases).
4. In the **⋯ (More Actions)** menu, choose **Install from VSIX…**.
5. Select the file, then reload VS Code.

---

## ⚡ Quick start

1. Open the local folder you want to sync (or an empty folder to download a remote project into).
2. `Ctrl/Cmd + Shift + P` → run **SFTP: Config**. This creates `.vscode/sftp.json`.
3. Fill in your server details, for example:
   ```json
   {
       "name": "Profile Name",
       "host": "name_of_remote_host",
       "protocol": "ftp",
       "port": 21,
       "secure": true,
       "username": "username",
       "remotePath": "/public_html/project", // <--- downloaded when you run "Download Project"
       "password": "password",
       "uploadOnSave": false
   }
   ```
   `password` is optional — you'll be prompted on sync if it's left out. _Note:_ backslashes and other special characters must be escaped with a backslash.
4. Save and close `sftp.json`.
5. `Ctrl/Cmd + Shift + P` → type **sftp** to see all commands (also available from the file-explorer context menus).
6. To pull an existing remote project, run **SFTP: Download Project** — it downloads `remotePath` into your local folder.
7. Edit locally; with `uploadOnSave` enabled, every save syncs to the server. 🎉

---

## ⚙️ Configuration

The simplest possible `sftp.json`:

```json
{
  "host": "host",
  "username": "username",
  "remotePath": "/remote/workspace"
}
```

More setups — **profiles**, **multiple contexts**, **connection hopping** (through an SSH proxy) and reading credentials from **User Settings** — are covered in the docs:

- [Full configuration reference](https://github.com/e-u-shapovalov/vscode-sftp/blob/develop/docs/configuration.md)
- [SFTP configuration](https://github.com/e-u-shapovalov/vscode-sftp/blob/develop/docs/sftp_configuration.md) · [FTP configuration](https://github.com/e-u-shapovalov/vscode-sftp/blob/develop/docs/ftp_configuration.md)

---

## 🗂 Remote Explorer

![Remote Explorer preview](./assets/showcase/remote-explorer.png)

Browse remote files without leaving the editor. Open the Remote Explorer via:

1. the command **View: Show SFTP**, or
2. the **SFTP** icon in the Activity Bar.

By default, double-clicking only **views** a file's content; run **SFTP: Edit in Local** to edit it locally. You can also use the **Open Remote File by Path** toolbar button to jump straight to a file by its server path.

**Multiple select** — hold `Ctrl` or `Shift` to select several files/folders at once for upload or download, just like the regular Explorer.

**Order** — sort the Remote Explorer with the `remoteExplorer.order` parameter in `sftp.json`:

```json
{
  "remoteExplorer": {
    "order": 1 // <-- Default value is 0.
  }
}
```

---

## 🐞 Debug

1. Open **Settings** (`File → Preferences → Settings`, or `Code → Preferences → Settings` on macOS).
2. Set **`sftp.debug`** to `true` and reload VS Code.
3. View the logs in **View → Output → sftp**.

---

## 📚 Documentation & FAQ

- [Home](https://github.com/e-u-shapovalov/vscode-sftp/blob/develop/docs/home.md) ·
  [Settings](https://github.com/e-u-shapovalov/vscode-sftp/blob/develop/docs/setting.md) ·
  [Common configuration](https://github.com/e-u-shapovalov/vscode-sftp/blob/develop/docs/common_configuration.md) ·
  [SFTP configuration](https://github.com/e-u-shapovalov/vscode-sftp/blob/develop/docs/sftp_configuration.md) ·
  [FTP configuration](https://github.com/e-u-shapovalov/vscode-sftp/blob/develop/docs/ftp_configuration.md) ·
  [Commands](https://github.com/e-u-shapovalov/vscode-sftp/blob/develop/docs/commands.md)
- ❓ [Frequently Asked Questions](https://github.com/e-u-shapovalov/vscode-sftp/blob/develop/FAQ.md)

---

## 📄 License

MIT — see [`LICENSE`](https://github.com/e-u-shapovalov/vscode-sftp/blob/develop/LICENSE). The original copyright notice is retained per the MIT terms; fork copyright © 2026 Evgenii Shapovalov.
