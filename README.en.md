# WireFerry — SFTP/FTP Sync and Deploy for Visual Studio Code

**WireFerry** is a VS Code extension for uploading, downloading, comparing and syncing project files with remote servers over **SFTP**, **FTP** and **FTPS**. It keeps common remote-development and deploy tasks inside the editor, so you do not need to switch to a separate FTP client for every change.

[![Latest release](https://img.shields.io/github/v/release/e-u-shapovalov/vscode-sftp)](https://github.com/e-u-shapovalov/vscode-sftp/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Project lineage: WireFerry is a fork of [Natizyskunk/vscode-sftp](https://github.com/Natizyskunk/vscode-sftp), which itself is a fork of [liximomo/vscode-sftp](https://github.com/liximomo/vscode-sftp).

## Download

Most users need the ready-to-install VS Code extension package:

**[`wireferry-2.0.5.vsix`](https://github.com/e-u-shapovalov/vscode-sftp/releases/download/v2.0.5/wireferry-2.0.5.vsix)**

Install it in VS Code:

1. Download the `.vsix` from [GitHub Releases](https://github.com/e-u-shapovalov/vscode-sftp/releases/latest).
2. Open VS Code.
3. Open **Extensions** (`Ctrl+Shift+X`).
4. Click **...** in the top-right corner of the Extensions panel.
5. Choose **Install from VSIX...**.
6. Select `wireferry-2.0.5.vsix` and reload VS Code if prompted.

> If you are not developing the extension itself, do **not** use `Code -> Download ZIP` and do **not** download `Source code`. Install the `.vsix` file from the release **Assets** section.

CLI install:

```bash
code --install-extension wireferry-2.0.5.vsix
```

## Quick Start

1. Open your local project folder in VS Code.
2. Run **WireFerry: Config** from the command palette (`Ctrl+Shift+P`).
3. Fill `.vscode/wireferry.json`:

```json
{
  "name": "Production",
  "host": "example.com",
  "protocol": "sftp",
  "port": 22,
  "username": "deploy",
  "remotePath": "/var/www/site",
  "uploadOnSave": false
}
```

4. Run a WireFerry command from the command palette, Explorer context menu, or Remote Explorer.

Legacy `.vscode/sftp.json` configs are still supported.

## What WireFerry Does

- Upload or download a file, folder, active editor file, active folder, or the whole project.
- Sync local to remote, remote to local, or both directions.
- Upload on save.
- Watch files changed outside VS Code and upload them.
- Compare a local file with its remote version.
- Browse remote files in a dedicated VS Code side panel.
- Create, rename, delete, move and open remote files.
- Work with multiple profiles such as `dev`, `stage` and `production`.
- Upload to all configured profiles.
- Use SFTP over SSH, FTP, FTPS, or `local` folder-to-folder sync.
- Connect through SSH jump hosts.

## Remote Explorer

![WireFerry Remote Explorer in VS Code](assets/showcase/remote-explorer.png)

Remote Explorer gives you a server-side file tree inside VS Code. You can view remote files, download them for local editing, upload local changes, copy remote paths, open a file by full remote path, and move items between folders.

## Example Configs

### SFTP with a private key

```json
{
  "name": "VPS",
  "host": "203.0.113.10",
  "protocol": "sftp",
  "port": 22,
  "username": "deploy",
  "privateKeyPath": "~/.ssh/id_rsa",
  "passphrase": true,
  "remotePath": "/var/www/app",
  "uploadOnSave": true,
  "ignore": [".git", "node_modules", "*.log"]
}
```

### FTPS

```json
{
  "name": "Hosting",
  "host": "ftp.example.com",
  "protocol": "ftp",
  "port": 21,
  "secure": true,
  "passive": true,
  "username": "user",
  "remotePath": "/public_html"
}
```

## Useful Commands

| Command | Purpose |
| --- | --- |
| `WireFerry: Config` | create or open `.vscode/wireferry.json` |
| `WireFerry: Upload Active File` | upload the current file |
| `WireFerry: Upload Changed Files` | upload files changed in Git; default shortcut `Ctrl+Alt+U` |
| `WireFerry: Upload Project` | upload the whole project |
| `WireFerry: Download Project` | download the remote project folder |
| `WireFerry: Sync Local -> Remote` | sync local files to the server |
| `WireFerry: Sync Remote -> Local` | sync server files to the local folder |
| `WireFerry: Sync Both Directions` | keep the newest files on both sides |
| `WireFerry: Diff Active File with Remote` | compare the current file with the remote version |
| `WireFerry: Open SSH in Terminal` | open an SSH terminal to the configured server |

Full command list: [docs/commands.md](docs/commands.md).

## Important Notes

- `password` in `.vscode/wireferry.json` is stored as plain text. Prefer SSH keys or leave the password out so WireFerry prompts for it.
- `remoteTimeOffsetInHours` is currently documented but not applied by the transfer pipeline.
- FTP always forces `concurrency` to `1`.
- Avoid enabling `uploadOnSave` and `watcher.autoUpload` for the same files at the same time.
- Be careful with `syncOption.delete`: verify `context`, `remotePath` and `ignore` rules first.

## Developer Setup

```bash
git clone https://github.com/e-u-shapovalov/vscode-sftp.git
cd vscode-sftp
npm install
npm run compile
npm test
npx @vscode/vsce package
```

The packaged extension is `wireferry-<version>.vsix`.

## Links

- Russian README: [README.md](README.md)
- Installation guide: [INSTALL.md](INSTALL.md)
- FAQ: [FAQ.md](FAQ.md)
- Changelog: [CHANGELOG.md](CHANGELOG.md)
- Issues: <https://github.com/e-u-shapovalov/vscode-sftp/issues>

## License

WireFerry is an independently maintained fork of [Natizyskunk/vscode-sftp](https://github.com/Natizyskunk/vscode-sftp), which itself is a fork of [liximomo/vscode-sftp](https://github.com/liximomo/vscode-sftp). It is based on upstream `v1.16.3` and developed separately from there.

Licensed under [MIT](LICENSE).
