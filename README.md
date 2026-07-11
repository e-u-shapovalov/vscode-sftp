# WireFerry — SFTP, FTP and FTPS Sync for Visual Studio Code

WireFerry is a Visual Studio Code extension for uploading, downloading, comparing and synchronizing project files with remote servers over SFTP, FTP or FTPS. It keeps routine website, shared-hosting and VPS file work inside VS Code, with upload on save and a built-in Remote Explorer.

[Русская версия](README.RU.md) · [Installation](INSTALL.md) · [Configuration](docs/configuration.md) · [Commands](docs/commands.md) · [FAQ](FAQ.md) · [Changelog](CHANGELOG.md)

## Download and install

WireFerry is published in the Visual Studio Code Marketplace. In VS Code, open **Extensions** (`Ctrl+Shift+X`) and search for `WireFerry`.

**[Open WireFerry in the Marketplace](https://marketplace.visualstudio.com/items?itemName=EvgeniiShapovalov.wireferry).**

Manual `.vsix` packages are also available from GitHub Releases for offline installs or rollback testing:

**[Download `wireferry-<version>.vsix` from the latest GitHub Release](https://github.com/e-u-shapovalov/vscode-sftp/releases/latest).**

> **If you are a regular user, do not use Code → Download ZIP. Download the ready-to-use release package from GitHub Releases instead.**

If you have not used GitHub before:

1. Open the [latest release](https://github.com/e-u-shapovalov/vscode-sftp/releases/latest).
2. Find the **Assets** section and expand it if necessary.
3. Download `wireferry-<version>.vsix`. Do not choose either **Source code** archive.
4. In desktop Visual Studio Code, open **Extensions** (`Ctrl+Shift+X`).
5. Open the **...** menu and select **Install from VSIX...**.
6. Select the downloaded `.vsix` file and reload VS Code if prompted.

Do not extract the `.vsix`. It is the extension package, not an archive that must be unpacked. WireFerry has no separate installer or standalone application. See the [installation guide](INSTALL.md) for terminal installation and common installation problems.

## What WireFerry is for

WireFerry maps a local folder in your VS Code workspace to a directory on a server. You can transfer one file, a folder or a complete configured project without repeatedly locating the same paths in a separate FTP client.

Typical uses include:

- publishing small website changes to shared hosting;
- editing files on a VPS over SFTP;
- keeping development, staging and production profiles in one project;
- downloading an existing remote project into a local workspace;
- comparing a local file with the server copy before replacing it;
- mirroring files to another local directory with the `local` protocol.

WireFerry is a direct file-transfer tool. It is not a CI/CD pipeline, a release-management system or a replacement for version control.

## Quick start

1. Open the local project **folder** in VS Code.
2. Open the Command Palette with `Ctrl+Shift+P`.
3. Run **WireFerry: Config**.
4. Complete the setup wizard. It asks for the protocol, host, port, username, remote path and authentication method, and verifies the connection.
5. After a successful check, the wizard creates `.vscode/wireferry.json` and the server appears in **Remote Explorer**.
6. Use `WireFerry:` commands, Explorer context menus or Remote Explorer to upload, download, compare and synchronize files.

The wizard supports SFTP and FTP connections. Existing `.vscode/sftp.json` files are still recognized as a legacy format. Advanced options such as FTPS, profiles, jump hosts and local mirroring are configured in JSONC.

![WireFerry first-server setup in Visual Studio Code](assets/showcase/setup-wizard-welcome-2.5.4.png)

## Key features

- Upload or download a file, folder, active file, active folder or configured project.
- Synchronize local to remote, remote to local or in both directions.
- Upload files when they are saved in VS Code.
- Watch files changed by external tools and optionally upload them.
- Compare a local file with its remote version.
- Browse remote files in a dedicated VS Code Remote Explorer.
- Create, rename, move and delete remote files and folders.
- Inspect sizes and permissions; calculate folder sizes and compare local/remote size and MD5.
- Use multiple profiles and upload the same files to all configured profiles.
- Connect over SFTP/SSH, FTP or FTPS, or mirror to another local folder.
- Use SSH jump hosts and open an SSH terminal for SFTP configurations.
- Authenticate with an SSH key, an OS-backed VS Code secret store or a password prompt.
- Pass keyboard-interactive challenges on servers that require 2FA (`interactiveAuth`).
- Generate and deploy an SSH key from the server context menu.
- Recover from SFTP permission errors by staging an edited copy; on compatible SSH servers, apply it through `su`.
- Change owner, group and permissions on the server, see the owner and group in tooltips, and spot files you cannot write as read-only in the tree.
- Draw an ASCII tree of a server or local folder from the folder context menu, with an optional depth limit and file sizes.
- Move files and folders on the server by dragging them inside the Remote Explorer.
- Follow uploads and downloads with a byte progress bar and a Cancel button; large files (over 10 MB) and binaries ask before they open.
- Read an operation report after each right-click transfer or delete — an `upload.log`, `download.log` or `delete.log` tab listing every file with its size, date and permissions.
- Transfer atomically by default: each file is staged into a temporary copy and renamed into place, so an interrupted transfer never truncates the original.
- Recognize symbolic links in the server tree and open their real target.
- Apply local deletions, renames and moves to the server after a confirmation.
- Download the server copy automatically when you open a mapped local file (`downloadOnOpen`).
- Give each profile its own tree root and its own upload-on-save, and delete from every profile's server plus the local copy in one action.
- Open any server file by its absolute path, even outside the configured `remotePath`.
- Migrate an old `sftp.*` setup: a startup doctor finds legacy settings and `sftp.json` and offers to convert them.
- Update through VS Code Marketplace, and connect to legacy SSH servers that only offer old Diffie-Hellman key exchange.
- Copy a Windows path in Git Bash form (`/c/…`).

![WireFerry Remote Explorer](assets/showcase/remote-explorer-overview-2.5.4.png)

## Latest release highlights

The latest release switches updates to the standard VS Code Marketplace flow. WireFerry no longer runs its own background GitHub release check, no longer asks for update-check consent on startup, and no longer downloads `.vsix` files beside the workspace config. **WireFerry: Check for Updates** now opens the extension page and asks VS Code to refresh Marketplace updates. GitHub Releases remain available for manual, offline or rollback installs.

See the [Changelog](CHANGELOG.md) for release-specific details and previous versions.

## Configuration

WireFerry reads JSON with comments and trailing commas from `.vscode/wireferry.json`. The setup wizard creates the first configuration, and VS Code provides field descriptions and validation from the bundled schema.

A minimal manually edited SFTP configuration:

```json
{
  "name": "Production",
  "host": "example.com",
  "protocol": "sftp",
  "port": 22,
  "username": "deploy",
  "password": "prompt",
  "remotePath": "/var/www/site",
  "uploadOnSave": false,
  "ignore": [".vscode", ".git", "node_modules"]
}
```

`context` selects the local directory to map; `remotePath` selects the corresponding server directory. Ignore patterns are not automatically inferred from `.gitignore`: set `ignoreFile` explicitly if you want WireFerry to read it.

Before the first project upload or synchronization, verify:

- `context` and `remotePath`;
- `ignore` and `ignoreFile`;
- the active profile;
- `syncOption`, especially any deletion behavior.

Read the [configuration reference](docs/configuration.md) for SFTP, FTP/FTPS, `local`, profiles, jump hosts, watchers and all supported fields.

## Main commands

Open the Command Palette with `Ctrl+Shift+P` and type `WireFerry`.

| Command | Purpose |
| --- | --- |
| `WireFerry: Config` | Run the setup wizard or open the existing configuration |
| `WireFerry: Upload Active File` | Upload the file open in the editor |
| `WireFerry: Upload Changed Files` | Upload Git working-tree changes; default shortcut: `Ctrl+Alt+U` |
| `WireFerry: Upload Project` | Upload everything under the configured `context` |
| `WireFerry: Download Project` | Download the configured remote project |
| `WireFerry: Sync Local -> Remote` | Synchronize from the local folder to the server |
| `WireFerry: Sync Remote -> Local` | Synchronize from the server to the local folder |
| `WireFerry: Sync Both Directions` | Copy the newer version of each file in both directions |
| `WireFerry: Diff Active File with Remote` | Compare the active local file with its remote copy |
| `WireFerry: Open SSH in Terminal` | Open an SSH session for an SFTP configuration |
| `WireFerry: Cancel All Transfers` | Stop current upload and download operations |

The [command reference](docs/commands.md) covers context-menu actions, Remote Explorer and multi-profile commands.

## Authentication and safety

- Prefer SSH keys for SFTP when the server supports them.
- `"password": "secretStorage"` stores the password through VS Code SecretStorage instead of in the project file.
- `"password": "prompt"` asks on each connection and does not save the password.
- A literal password in `.vscode/wireferry.json` is plaintext. Do not commit it.
- The setup wizard writes `.vscode`, `.git` and `.DS_Store` to its initial `ignore` list. A hand-written configuration must define its own ignore rules.
- Synchronization can overwrite or delete files depending on `syncOption`. Test a new configuration with non-critical data and keep backups.
- WireFerry does not run in VS Code Restricted Mode. Trust only workspaces whose contents you have reviewed.

## Known limitations

- Desktop Visual Studio Code 1.66 or newer is required.
- WireFerry runs inside VS Code; there is no standalone GUI or WireFerry CLI.
- Browser-based VS Code environments are not documented as supported.
- `remoteTimeOffsetInHours` exists in the schema but is not currently applied by the transfer pipeline.
- FTP transfer concurrency is forced to `1`.
- Enabling both `uploadOnSave` and `watcher.autoUpload` for the same files can cause duplicate uploads.
- Server permissions, storage quotas, SSH/FTP policy and available shell commands remain controlled by the server.

Known bugs and inherited technical debt are tracked in [ROADMAP.md](ROADMAP.md).

## Troubleshooting

### I downloaded Source code instead of the extension

Delete the ZIP or TAR.GZ, return to the [latest release](https://github.com/e-u-shapovalov/vscode-sftp/releases/latest), expand **Assets** and download `wireferry-<version>.vsix`. Source archives cannot be installed as the packaged extension.

### WireFerry commands or the server tree do not appear

Confirm that the extension is installed and enabled, reload VS Code, open a folder rather than an individual file, and ensure the workspace is trusted. Run **WireFerry: Config** to create a configuration. Transfer-specific menus remain unavailable until a valid configuration is loaded.

### `Config Not Found`

Open the project root rather than a single file. Confirm that `.vscode/wireferry.json` is inside the opened workspace and that the current file is under the configured `context`.

### Files are transferred to the wrong directory

Check both `context` and `remotePath`. They are the local and remote roots that WireFerry maps to each other.

### Unwanted files were uploaded

Add gitignore-style patterns to `ignore`, or set `ignoreFile` to a suitable file. Changing Remote Explorer's `filesExclude` only hides items in the tree; it does not exclude them from transfers.

### The connection closes on an old SSH server

The server may require a legacy key-exchange or host-key algorithm. Add only the algorithm required by that server with the `algorithms` setting; see the [FAQ](FAQ.md#the-sftp-connection-closes-or-reports-unknown-dh-group).

### I need diagnostic logs

Enable `wireferry.debug`, reload the VS Code window, then open **View → Output → WireFerry**. Remove passwords and sensitive paths before sharing logs.

More solutions are in the [FAQ and troubleshooting guide](FAQ.md).

## For developers

The repository contains a TypeScript extension bundled by Webpack. The source entry point is `src/extension.ts`; `npm run compile` writes `dist/extension.js`. The project does not declare an exact minimum Node.js/npm version, so use a current supported Node.js release.

```bash
git clone https://github.com/e-u-shapovalov/vscode-sftp.git
cd vscode-sftp
npm ci
npm run compile
npm test
npx tsc --noEmit
```

Development watch mode:

```bash
npm run dev
```

Build an installable package:

```bash
npx @vscode/vsce package
code --install-extension wireferry-<version>.vsix
```

The `code` command is optional; the resulting package can also be installed through **Extensions → ... → Install from VSIX...**. See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution checks.

## FAQ

### What should I download?

Install WireFerry from the [Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=EvgeniiShapovalov.wireferry). For offline/manual installs, download `wireferry-<version>.vsix` from **Assets** in the [latest GitHub Release](https://github.com/e-u-shapovalov/vscode-sftp/releases/latest). Do not download a source archive for normal installation.

### Does WireFerry have a standalone FTP client or CLI?

No. WireFerry runs inside desktop Visual Studio Code. `code --install-extension` is a VS Code installation command, not a WireFerry CLI.

### Can it upload a website whenever I save a file?

Yes. Set `uploadOnSave` for the relevant configuration or profile. Check `context`, `remotePath` and ignore rules before enabling it.

### Can it download an existing website?

Yes. Open an empty local folder, configure the correct `remotePath`, and run **WireFerry: Download Project**. Back up important data before testing synchronization options.

### Is this the original `vscode-sftp` extension?

No. WireFerry is an independently maintained fork and is not presented as the original project. Its lineage is Natizyskunk/vscode-sftp ← liximomo/vscode-sftp; this fork started from upstream `v1.16.3` and now uses a different name and publisher.

## Support, attribution and license

- Report bugs or request features in [GitHub Issues](https://github.com/e-u-shapovalov/vscode-sftp/issues).
- Install from the [Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=EvgeniiShapovalov.wireferry), or download manual packages from [GitHub Releases](https://github.com/e-u-shapovalov/vscode-sftp/releases).
- Review user-visible changes in the [Changelog](CHANGELOG.md).

WireFerry is maintained by [Evgenii Shapovalov](https://github.com/e-u-shapovalov) and licensed under the [MIT License](LICENSE). Required original copyright and attribution notices are preserved in `LICENSE`.
