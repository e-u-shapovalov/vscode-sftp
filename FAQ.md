# WireFerry FAQ and Troubleshooting

[Русская версия](FAQ.RU.md) · [Main README](README.md) · [Installation](INSTALL.md) · [Configuration](docs/configuration.md)

## Download and installation

### What should I download?

Install WireFerry from the [Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=EvgeniiShapovalov.wireferry). For offline/manual installs, download `wireferry-<version>.vsix` from **Assets** in the [latest GitHub Release](https://github.com/e-u-shapovalov/vscode-sftp/releases/latest).

> **If you are a regular user, do not use Code → Download ZIP. Download the ready-to-use release package from GitHub Releases instead.**

`Source code (zip)`, `Source code (tar.gz)` and **Code → Download ZIP** are source archives for developers. They are not the installable extension package.

### How do I install from Marketplace?

In desktop VS Code, open **Extensions** (`Ctrl+Shift+X`), search for `WireFerry`, and select **Install**. VS Code handles future Marketplace updates automatically when extension auto-update is enabled.

### How do I install the VSIX?

In desktop VS Code, open **Extensions** (`Ctrl+Shift+X`), select **... → Install from VSIX...**, and choose the downloaded file.

If the VS Code `code` command is available:

```bash
code --install-extension wireferry-<version>.vsix
```

Do not unzip the `.vsix`.

### I downloaded Source code by mistake. Can I convert it to a VSIX?

Do not rename the ZIP. Return to the [latest release](https://github.com/e-u-shapovalov/vscode-sftp/releases/latest) and download the `.vsix` from **Assets**.

Developers can build a package from source with `npm ci`, `npm run compile` and `npx @vscode/vsce package`, but normal users should use the published asset.

## Setup and configuration

### WireFerry commands or the server tree do not appear

Check that:

- the extension is installed and enabled;
- desktop VS Code 1.66 or newer is running;
- a folder workspace is open, not only an individual file;
- the workspace is trusted;
- `.vscode/wireferry.json` or legacy `.vscode/sftp.json` is valid.

Reload VS Code and run **WireFerry: Config**. Transfer-specific menus are unavailable until a valid configuration is loaded.

### `Config Not Found`

WireFerry could not map the selected local file to a loaded configuration. Common causes:

- the wrong workspace folder is open;
- the configuration is not under the opened workspace's `.vscode` directory;
- `context` points to a different local subdirectory;
- the selected file is outside the configured `context`.

Open the project root and verify `.vscode/wireferry.json` plus `context`.

### Which configuration file should I use?

Use `.vscode/wireferry.json` for new projects. WireFerry also reads the legacy `.vscode/sftp.json` and can offer to rename it.

The format is JSONC: comments and trailing commas are accepted. VS Code uses the bundled schema to validate known fields.

### How do I upload a folder's contents without adding the folder itself?

Set `context` to that local folder and `remotePath` to the destination. For example, this maps the contents of `build` directly to `/var/www/site`:

```json
{
  "name": "Production",
  "host": "example.com",
  "protocol": "sftp",
  "port": 22,
  "username": "deploy",
  "password": "prompt",
  "context": "./build",
  "remotePath": "/var/www/site"
}
```

### How do I download an existing project from a server?

1. Open an empty local folder in VS Code.
2. Run **WireFerry: Config** and configure the correct server path.
3. Run **WireFerry: Download Project**.

Use a backup and verify `context`, `remotePath`, ignore rules and sync settings before working with important data.

## Authentication and connection problems

### How should I store a password?

Use one of these values:

- `"password": "secretStorage"` — store/read the password through VS Code SecretStorage;
- `"password": "prompt"` — ask on every connection without saving;
- a literal string — supported, but stored as plaintext in the project file.

For SFTP, prefer an SSH key where possible. `privateKeyPath` selects the key; an encrypted key can use `true` or `"secretStorage"` in `passphrase`. Do not commit plaintext secrets.

### The SFTP connection closes or reports `Unknown DH group`

An old SSH server may require an obsolete key-exchange or host-key algorithm. Add only the algorithm confirmed by the server administrator. For example:

```json
{
  "algorithms": {
    "kex": {
      "append": ["diffie-hellman-group1-sha1"]
    },
    "serverHostKey": {
      "append": ["ssh-rsa"]
    }
  }
}
```

Do not copy this example into every configuration: legacy algorithms weaken connection security and should be limited to servers that cannot be upgraded.

### The server reports `Permission denied`

Confirm that the configured user can write to `remotePath` and the target file or directory.

For SFTP, WireFerry can offer to stage the edited copy at a writable server path. On compatible SSH servers it can apply the staged file through `su`; this requires a working `su` command and valid root credentials. FTP does not support this recovery action.

### A folder is yellow, or I cannot read a root-owned file

The Remote Explorer marks a folder **yellow** when your login has no permission to list it. Right-click the item and choose **View / list as root**, then enter the owner's or root's password: WireFerry lists the folder in place, or opens an unreadable file as a read-only throwaway copy, through `su`. This needs an SFTP/SSH connection — FTP has no shell — and the password is kept in memory only. See [Root access](docs/commands.md#root-access-view-list-and-delete-as-root).

### The server reports `Error: Failure`

This is a generic SFTP status and does not identify one universal cause. Check:

- whether the remote path exists;
- file and directory permissions;
- server storage quotas and free space;
- filename restrictions;
- connection and channel limits.

Enable debug logging and inspect **View → Output → WireFerry**. If the server limits concurrent operations, lower `concurrency`. Use `limitOpenFilesOnRemote` only when a server-side file-descriptor limit is the confirmed problem.

## Transfers and synchronization

### Unwanted files are uploaded

Define gitignore-style patterns in `ignore`:

```json
{
  "ignore": [
    ".vscode",
    ".git",
    "node_modules",
    "*.log",
    "*.tmp"
  ]
}
```

To read patterns from a file, set it explicitly:

```json
{
  "ignoreFile": ".gitignore"
}
```

`remoteExplorer.filesExclude` only changes what the tree displays; it does not exclude files from transfers.

### Can WireFerry upload changes automatically?

For files saved in VS Code:

```json
{
  "uploadOnSave": true
}
```

For files changed by external tools:

```json
{
  "uploadOnSave": false,
  "watcher": {
    "files": "**/*",
    "autoUpload": true
  }
}
```

Do not enable `uploadOnSave` and `watcher.autoUpload` for the same files unless duplicate uploads are acceptable.

### Can synchronization delete files?

Yes. `syncOption.delete` can remove destination files that do not exist in the source. The source and destination change with the chosen sync direction.

Before enabling deletion, verify `context`, `remotePath`, the active profile and ignore rules. Test with non-critical data and keep a backup.

### Why does WireFerry ask me to type `yes` before deleting?

A server-side delete that would leave no safe copy behind asks you to type `yes` first. WireFerry skips that prompt only when the selected item still has an identical local backup, verified by matching size and MD5. Deleting on both sides, or across all profiles, always asks. Servers with no server-side MD5 tool — including FTP — can't be verified, so the prompt always appears there. See [Deleting safely](docs/commands.md#deleting-safely).

### Why does FTP use only one transfer at a time?

WireFerry forces FTP concurrency to `1`. The `concurrency` setting applies to other transfer modes but does not override this FTP behavior.

### Does `remoteTimeOffsetInHours` fix timestamp differences?

Not currently. The field is present in the schema, but the transfer pipeline does not apply it. Do not rely on it when deciding whether synchronization is safe.

## Diagnostics

### How do I enable debug logs?

Set `wireferry.debug` to `true` in VS Code settings, reload the window, then open **View → Output → WireFerry**.

Before posting logs in an issue, remove passwords, usernames, hostnames and sensitive paths.

### Where should I report a reproducible problem?

Open a [GitHub Issue](https://github.com/e-u-shapovalov/vscode-sftp/issues) and include:

- the WireFerry and VS Code versions;
- protocol and relevant configuration fields with secrets removed;
- exact steps to reproduce;
- the complete error text;
- sanitized debug output when available.

## Project identity

### Is WireFerry the original `vscode-sftp` extension?

No. WireFerry is an independently maintained fork and is not presented as the original extension. Its lineage is Natizyskunk/vscode-sftp ← liximomo/vscode-sftp; this fork began from upstream `v1.16.3` and now uses a different name and publisher.

### Is there a standalone application or WireFerry CLI?

No. WireFerry runs inside desktop Visual Studio Code. The optional `code --install-extension` command belongs to VS Code and only installs the package.
