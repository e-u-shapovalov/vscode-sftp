## Setting

There are a handful of settings available for SFTP, and they can be changed:

- On Windows/Linux: File --> Preferences --> Settings
- On macOS: Code --> Preferences --> Settings

### sftp.debug
Adds debugging output to the SFTP output panel. <br>
You can view the log in `View --> Output --> SFTP`. Changing this requires VS Code to be reloaded.

| Key | Value | Default |
| --- | --- | --- |
| *sftp.debug* | *boolean* | *false* |

```json
{
  "sftp.debug": true
}
```

### sftp.downloadWhenOpenInRemoteExplorer
Change the default behavior from `View Content` to `Edit in Local` when opening files in the Remote Explorer.

| Key | Value | Default |
| --- | --- | --- |
| *sftp.downloadWhenOpenInRemoteExplorer* | *boolean* | *false* |

```json
{
  "sftp.downloadWhenOpenInRemoteExplorer": true
}
```
