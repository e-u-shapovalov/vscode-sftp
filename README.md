# WireFerry — SFTP, FTP and FTPS Sync for Visual Studio Code

**WireFerry is a VS Code SFTP extension for uploading, downloading, comparing and synchronizing project files with remote servers.** It brings SFTP, FTP and FTPS transfers, upload on save and a remote file explorer into Visual Studio Code, reducing the need to switch to a separate FTP client for routine website and server-file updates.

[Русская версия](README.RU.md) · [Installation](INSTALL.md) · [Configuration](docs/configuration.md) · [FAQ](FAQ.md) · [Changelog](CHANGELOG.md)

## Download and install

WireFerry is distributed as a ready-to-install Visual Studio Code extension package through GitHub Releases.

**Download [`wireferry-<version>.vsix` from the latest release](https://github.com/e-u-shapovalov/vscode-sftp/releases/latest).**

> **If you are a regular user, do not use Code → Download ZIP. Download the ready-to-use release package from GitHub Releases instead.**

If you are new to GitHub:

1. Open the [latest release](https://github.com/e-u-shapovalov/vscode-sftp/releases/latest).
2. Find the **Assets** section.
3. Download the file named `wireferry-<version>.vsix`. Do not download either **Source code** archive.
4. Open Visual Studio Code and select **Extensions** (`Ctrl+Shift+X`).
5. Open the **...** menu in the Extensions panel and select **Install from VSIX...**.
6. Select the downloaded `.vsix` file and reload VS Code if prompted.

The `.vsix` is the extension package; do not extract it. There is no separate installer or standalone WireFerry application. See [INSTALL.md](INSTALL.md) for terminal installation and common installation problems.

## Quick start

1. Open your local project **folder** in VS Code.
2. Open the Command Palette (`Ctrl+Shift+P`) and run **WireFerry: Config**.
3. Follow the setup wizard. It asks for the protocol, server, port, username, remote path and authentication method, then verifies the connection.
4. After a successful connection, WireFerry creates `.vscode/wireferry.json` and shows the server in **Remote Explorer**.
5. Use the Command Palette, Explorer context menu or Remote Explorer to upload, download, compare or synchronize files.

The wizard supports SFTP and FTP connections. Existing `.vscode/sftp.json` configurations remain supported as a legacy format.

![WireFerry first-server setup prompt in Visual Studio Code](assets/showcase/setup-wizard-welcome-2.5.4.png)

## What's new

**2.5.5 — safer configuration validation and refreshed documentation.** The runtime validator was updated from `joi` 10.6.0 to 17.13.4, removing the vulnerable `joi` / `hoek` / `topo` chain; `npm audit --omit=dev` now reports 0 production vulnerabilities. The real configuration schema is isolated in a pure module with 13 direct tests, while JSONC, compatibility fields, strict no-coercion validation and SFTP/FTP/local support remain intact. Installation guidance and versioned screenshots were refreshed in English and Russian.

See the [Changelog](CHANGELOG.md) for technical details and previous releases.

## What WireFerry does

- Upload or download one file, a folder, the active file or folder, or the configured project.
- Synchronize local to remote, remote to local, or in both directions.
- Upload files when they are saved, or watch for changes made outside VS Code.
- Compare a local file with its remote version.
- Browse and manage remote files in a dedicated VS Code Remote Explorer.
- Create, rename, move and delete remote files and folders.
- Use multiple profiles for environments such as development, staging and production.
- Upload to every configured profile when the same files must reach multiple servers.
- Connect over SFTP/SSH, FTP or FTPS; a `local` protocol can mirror files to another local folder.
- Use SSH jump hosts for SFTP connections.
- Store passwords and key passphrases through VS Code SecretStorage, prompt on each connection, or use an SSH private key.
- Generate and deploy an SSH key from the server context menu.

![WireFerry Remote Explorer](assets/showcase/remote-explorer-overview-2.5.4.png)

WireFerry is useful for website maintenance, shared hosting, VPS file updates, staging environments and other workflows where files must be transferred directly from a VS Code workspace. It is a file-transfer tool, not a CI/CD or release-management system.

## Configuration

WireFerry uses a JSON-with-comments configuration file at `.vscode/wireferry.json`. The setup wizard creates it, and VS Code provides field descriptions and validation from the bundled schema.

A minimal manually edited SFTP configuration looks like this:

```json
{
  "name": "Production",
  "host": "example.com",
  "protocol": "sftp",
  "port": 22,
  "username": "deploy",
  "password": "prompt",
  "remotePath": "/var/www/site",
  "uploadOnSave": false
}
```

`context` selects the local directory to map, while `remotePath` selects the corresponding directory on the server. Add `ignore` rules before transferring a project if local-only files are not already covered by the defaults or your `.gitignore`.

For SFTP, FTP/FTPS, profiles, jump hosts and all supported fields, read the [configuration guide](docs/configuration.md).

## Main commands

Open the Command Palette with `Ctrl+Shift+P` and type `WireFerry`.

| Command | Purpose |
| --- | --- |
| `WireFerry: Config` | Run the setup wizard or open the existing configuration |
| `WireFerry: Upload Active File` | Upload the file open in the editor |
| `WireFerry: Upload Changed Files` | Upload files changed in Git; default shortcut: `Ctrl+Alt+U` |
| `WireFerry: Upload Project` | Upload everything under the configured `context` |
| `WireFerry: Download Project` | Download the configured remote project |
| `WireFerry: Sync Local -> Remote` | Synchronize from the local folder to the server |
| `WireFerry: Sync Remote -> Local` | Synchronize from the server to the local folder |
| `WireFerry: Sync Both Directions` | Copy newer files in both directions |
| `WireFerry: Diff Active File with Remote` | Compare the active local file with its remote copy |
| `WireFerry: Open SSH in Terminal` | Open an SSH session for the configured SFTP server |
| `WireFerry: Cancel All Transfers` | Stop current upload and download operations |

See [docs/commands.md](docs/commands.md) for the full command and context-menu reference.

## Authentication and safety

- Prefer an SSH key for SFTP where the server supports it.
- `"password": "secretStorage"` stores the password through VS Code SecretStorage instead of in the project file.
- `"password": "prompt"` asks for the password on each connection and does not save it.
- A literal password in `.vscode/wireferry.json` is plaintext. Do not commit it.
- Review `context`, `remotePath`, `ignore` and `syncOption` before enabling deletion during synchronization.
- Workspace Trust is required; the extension declares untrusted workspaces unsupported.

The server context menu also provides commands to generate an SSH key, save a password to SecretStorage and delete saved credentials.

## Known limitations

- Visual Studio Code 1.66 or newer is required.
- WireFerry runs inside desktop VS Code; it is not a standalone GUI or command-line client.
- `remoteTimeOffsetInHours` is present in the configuration schema but is not currently applied by the transfer pipeline.
- FTP transfers force `concurrency` to `1`.
- Enabling both `uploadOnSave` and `watcher.autoUpload` for the same files can cause duplicate uploads.
- Synchronization can overwrite or delete files depending on `syncOption`; test a new configuration on non-critical data first.

Known bugs and inherited technical debt are tracked in [ROADMAP.md](ROADMAP.md).

## Troubleshooting

### WireFerry commands do not appear

Confirm that the extension is installed and enabled, a trusted project folder is open, and the project contains `.vscode/wireferry.json` or legacy `.vscode/sftp.json`. Run **WireFerry: Config** to create a configuration.

### `Config Not Found`

Open the project root rather than a single file. The configuration must be inside the opened folder, and the current file must be within the configured `context`.

### Files are transferred to the wrong directory

Check both `context` and `remotePath`: they define the local and remote roots that WireFerry maps to each other.

### Unwanted files were uploaded

Add patterns such as `.git`, `node_modules` and `*.log` to `ignore`, or point `ignoreFile` at an appropriate gitignore-format file.

### I need connection details

Enable `wireferry.debug` in VS Code settings, reload the window and open **View → Output → WireFerry**. The detailed [FAQ](FAQ.md) covers common SFTP errors, old SSH servers, ignore rules and macOS file-watch limits.

## For developers

The repository contains a TypeScript extension bundled by Webpack. Its runtime entry point is `src/extension.ts`, compiled to `dist/extension.js`. The exact minimum Node.js/npm version is not declared; use a current supported Node.js release.

```bash
git clone https://github.com/e-u-shapovalov/vscode-sftp.git
cd vscode-sftp
npm install
npm run compile
npm test
npx tsc --noEmit
```

Development watch mode:

```bash
npm run dev
```

Build and install a local package:

```bash
npx @vscode/vsce package
code --install-extension wireferry-<version>.vsix
```

`npx @vscode/vsce package` creates the same package type used by GitHub Releases. See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution checks.

## FAQ

### What should I download?

Download `wireferry-<version>.vsix` from the **Assets** section of the [latest GitHub Release](https://github.com/e-u-shapovalov/vscode-sftp/releases/latest). Source archives are for development and cannot be installed as the packaged extension.

### Does WireFerry include a standalone FTP client or CLI?

No. WireFerry runs inside Visual Studio Code. The optional `code --install-extension` command only asks VS Code to install the `.vsix`.

### Can it upload a website when I save a file?

Yes. Set `uploadOnSave` for the relevant configuration or profile. Check `context`, `remotePath` and `ignore` first so the intended local files map to the intended server directory.

### Can it download an existing website?

Yes. Open an empty local folder, configure the correct remote root, and run **WireFerry: Download Project**. Back up important remote data before experimenting with synchronization options.

### Is this the original `vscode-sftp` extension?

No. WireFerry is an independently maintained fork and is not presented as the original project. Its lineage is `Natizyskunk/vscode-sftp` ← `liximomo/vscode-sftp`; this fork started from upstream `v1.16.3` and has since developed separately under a new name and publisher.

## Support and license

- Report bugs or request features in [GitHub Issues](https://github.com/e-u-shapovalov/vscode-sftp/issues).
- Download releases from [GitHub Releases](https://github.com/e-u-shapovalov/vscode-sftp/releases).
- Review user-visible changes in the [Changelog](CHANGELOG.md).

WireFerry is maintained by [Evgenii Shapovalov](https://github.com/e-u-shapovalov) and licensed under the [MIT License](LICENSE). The original copyright and attribution notices are preserved in `LICENSE`.
