# WireFerry Command Reference

[Русская версия](commands.RU.md) · [Main README](../README.md) · [Configuration](configuration.md) · [FAQ](../FAQ.md)

Open the Command Palette with `Ctrl+Shift+P` and type `WireFerry`. Many transfer commands also appear in the local Explorer, editor, Source Control or Remote Explorer context menu.

Commands that need a server are available after a valid `.vscode/wireferry.json` or legacy `.vscode/sftp.json` has been loaded.

## Setup and connection

| Command | Purpose |
| --- | --- |
| `WireFerry: Config` | Run the setup wizard when no config exists, or open the current config |
| `WireFerry: Set Profile` | Select the active profile for commands without an explicit profile context |
| `WireFerry: Open SSH in Terminal` | Open an SSH terminal for the current SFTP connection |
| `WireFerry: Check for Updates` | Query the latest GitHub Release and offer an update when one is available |
| `WireFerry: Open Extension Page` | Open the extension page in VS Code |
| `WireFerry: Cancel All Transfers` | Stop current upload and download tasks |

`Open SSH in Terminal` applies only to SFTP/SSH configurations.

## Upload

| Command | Purpose |
| --- | --- |
| `Upload File` | Upload the selected local or mapped file |
| `Upload Active File` | Upload the file open in the editor |
| `Upload Folder` | Upload the selected folder |
| `Upload Active Folder` | Upload the folder containing the active file |
| `Upload Project` | Upload everything under the configured `context` |
| `Force Upload` | Upload while bypassing ignore rules; exposed as an alternate context-menu action |
| `Upload Changed Files` | Apply Git working-tree/index additions, modifications and renames to the server; asks before server deletions |

The default shortcut for **Upload Changed Files** is `Ctrl+Alt+U`.

When `profiles` are configured, file, active-file, folder, active-folder, project and force-upload commands also have **To All Profiles** variants.

## Download

| Command | Purpose |
| --- | --- |
| `Download File` | Download the selected remote version and replace the mapped local file |
| `Download Active File` | Download the remote version of the active local file |
| `Download Folder` | Download the selected folder |
| `Download Active Folder` | Download the folder containing the active file |
| `Download Project` | Download the configured remote project |
| `Force Download` | Download while bypassing ignore rules; exposed as an alternate context-menu action |

Transfers can overwrite existing files. Verify `context`, `remotePath`, the selected profile and ignore rules first.

## Synchronization and comparison

| Command | Purpose |
| --- | --- |
| `Sync Local -> Remote` | Use the local tree as source and the server as destination |
| `Sync Remote -> Local` | Use the server as source and the local tree as destination |
| `Sync Both Directions` | Compare modification times and place the newer version on both sides |
| `Diff with Remote` | Compare a selected local file with its remote copy |
| `Diff Active File with Remote` | Compare the active editor file with its remote copy |
| `List` | List a remote folder and choose a file |
| `List Active Folder` | List the remote folder mapped to the active file's folder |
| `List All` | List remote files reachable below `remotePath` |

`syncOption` controls creation, update and deletion behavior. Review it before synchronizing important data. For **Sync Both Directions**, only `skipCreate` and `ignoreExisting` apply.

## Remote Explorer

| Command | Purpose |
| --- | --- |
| `Edit in Local` | Download a remote file and open the mapped local copy for editing |
| `View Content` | Open a remote file read-only without saving it into the workspace |
| `Open Remote File by Path` | Enter an absolute remote path and open the file |
| `Open Symlink Target` | Resolve a remote symlink and offer to open its target |
| `Reveal in Explorer` | Reveal a remote item's local counterpart |
| `Reveal in Remote Explorer` | Reveal a local file in the server tree |
| `Copy Path` | Copy the remote path |
| `Refresh` | Reload the Remote Explorer tree |
| `Refresh Active Remote File` | Reload the remote entry for the active file |
| `Show Sizes` / `Hide Sizes` | Toggle sizes in the tree |
| `Sort by Size` / `Sort by Name` | Change the tree sort mode |
| `Size & MD5...` | Report server/local size and, when available, MD5 for a file or folder |
| `Show Tree...` | Render an ASCII tree of the selected folder into a text tab, with optional file sizes and a depth limit |

With `wireferry.downloadWhenOpenInRemoteExplorer: true`, clicking a remote file downloads it with progress and then opens it. When the setting is `false`, WireFerry opens a read-only preview instead.

Folder size uses a server-side `du` command when available over SFTP and otherwise falls back to walking the remote tree. Server-side MD5 requires suitable shell commands and is unavailable on FTP.

`Show Tree...` first asks how to draw the tree (folders only, with files, or with files and sizes) and a maximum depth (empty or `0` means no limit). The tree opens in a text tab and stops at 20000 entries for very large folders. It is available on folders in both the Remote Explorer and the local Explorer.

You can also **drag and drop** items inside the Remote Explorer to move or rename them on the server; a matching local copy is updated after a confirmation. Moves stay within a single connection — dragging across different profiles is not performed.

## Remote file management

| Command | Purpose |
| --- | --- |
| `Create File` / `Create Folder` | Create an item below the selected remote directory |
| `Rename` | Rename or move a selected remote item |
| `Delete (server / local / both)...` | Choose whether to delete the server copy, local copy or both |
| `Change Permissions (chmod)` | Change remote Unix mode; folders can be handled recursively |
| `Change Owner / Group (chown, as root)` | Run `chown` through `su` on a compatible SSH server |

When profiles exist, the delete dialog can also remove the server copy from every profile and move the one local copy to the operating-system trash.

WireFerry requests the operating-system trash for a local deletion. If trash is unavailable, for example on some network or substituted drives, the implementation falls back to permanent deletion.

Privileged `chmod` retry and `chown` require SFTP/SSH, a working `su` command and valid root credentials.

## Credentials

| Command | Purpose |
| --- | --- |
| `Generate SSH Key...` | Create an SSH key, deploy the public key and switch after a verified key login |
| `Save Password to Keychain...` | Store a password through VS Code SecretStorage and update the config |
| `Delete Saved Password...` | Remove selected passwords or passphrases from SecretStorage |

SSH key generation is SFTP-only. Password storage is available for main configurations and profiles; jump-host credentials are not stored in SecretStorage.

## Operation reports

After a right-click upload, download or delete, WireFerry opens an `upload.log`, `download.log` or `delete.log` tab that lists each file with its size, modification date and permissions, plus an "N ok, M failed" tally. For deletes it also shows where the local and server copies differ, and a multi-profile run tags each row with its server.

## Local Explorer integration

The local Explorer context menu provides upload, download, sync, diff, delete, size/MD5 and Show Tree actions for mapped items.

`Copy Path (Git Bash)` converts selected Windows paths such as `C:\project\file` to Git Bash form such as `/c/project/file`.

Local rename and move events can be applied to the server after confirmation. Local deletions made through VS Code can likewise be deleted on the server after confirmation; external filesystem changes do not trigger those two confirmation handlers.
