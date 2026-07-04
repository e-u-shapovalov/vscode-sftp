# Install WireFerry in Visual Studio Code

[Русская версия](INSTALL.RU.md) · [Main README](README.md) · [FAQ](FAQ.md)

WireFerry is distributed through [GitHub Releases](https://github.com/e-u-shapovalov/vscode-sftp/releases) as a `.vsix` extension package. It requires desktop Visual Studio Code 1.66 or newer.

## Download the correct file

1. Open the [latest WireFerry release](https://github.com/e-u-shapovalov/vscode-sftp/releases/latest).
2. Locate the **Assets** section. Expand it if GitHub has collapsed the list.
3. Download `wireferry-<version>.vsix`.

> **If you are a regular user, do not use Code → Download ZIP. Download the ready-to-use release package from GitHub Releases instead.**

Do not download:

- `Source code (zip)`;
- `Source code (tar.gz)`;
- an archive from **Code → Download ZIP**.

Those files contain project sources for developers. The `.vsix` file is the ready-to-install extension package. Do not unzip or rename it.

## Install through the VS Code interface

1. Open Visual Studio Code.
2. Open **Extensions** with `Ctrl+Shift+X`.
3. Select **...** in the top-right corner of the Extensions panel.
4. Select **Install from VSIX...**.
5. Choose the downloaded `wireferry-<version>.vsix`.
6. Reload VS Code if prompted.

## Install from a terminal

If the VS Code `code` command is available, run this from the directory containing the package:

```bash
code --install-extension wireferry-<version>.vsix
```

You can also provide the full path to the `.vsix`. This is a VS Code installation command; WireFerry does not provide its own CLI.

## First run

1. Open a local project folder in VS Code.
2. Trust the workspace only if you trust its contents. WireFerry does not run in Restricted Mode.
3. Press `Ctrl+Shift+P` and run **WireFerry: Config**.
4. Complete the server setup wizard.
5. After the connection is verified, use Remote Explorer or a `WireFerry:` command to transfer files.

The wizard creates `.vscode/wireferry.json`. If a current or legacy configuration already exists, **WireFerry: Config** opens it instead. Legacy `.vscode/sftp.json` configurations remain recognized.

## Update or remove WireFerry

To install a newer GitHub Release, download its `.vsix` and repeat **Install from VSIX...**. VS Code replaces the installed extension with the selected package.

To remove WireFerry, open **Extensions**, find **WireFerry — SFTP & FTP Sync**, select the gear menu and choose **Uninstall**.

## Common installation problems

### I downloaded a ZIP or TAR.GZ

You downloaded source code, not the extension. Delete the archive, return to the [latest release](https://github.com/e-u-shapovalov/vscode-sftp/releases/latest), expand **Assets** and download `wireferry-<version>.vsix`.

### VS Code says the extension is incompatible

WireFerry requires desktop Visual Studio Code 1.66 or newer. Update VS Code and install the `.vsix` again.

### `code` is not recognized

Use **Extensions → ... → Install from VSIX...** instead. The terminal command is optional.

### VS Code does not offer “Install from VSIX...”

Make sure you are using desktop Visual Studio Code rather than a browser-based editor. Open the **Extensions** view and use its top-right **...** menu.

### WireFerry commands are missing after installation

Check that the extension is enabled, reload VS Code, open a project folder rather than an individual file, and leave Restricted Mode only if you trust the workspace. Then run **WireFerry: Config**.

### There is no `.vsix` under Assets

A release without `wireferry-<version>.vsix` is not ready for regular installation. Do not substitute a Source code archive. Wait for a corrected release or build the package from source.

## Build from source

Building is intended for contributors and advanced users. The project does not declare an exact minimum Node.js/npm version; use a current supported Node.js release.

```bash
git clone https://github.com/e-u-shapovalov/vscode-sftp.git
cd vscode-sftp
npm ci
npm run compile
npm test
npx tsc --noEmit
npx @vscode/vsce package
```

Install the resulting package:

```bash
code --install-extension wireferry-<version>.vsix
```

Alternatively, use **Extensions → ... → Install from VSIX...**. The repository does not build a standalone executable, installer or WireFerry CLI; its user-facing build artifact is a VS Code extension package.
