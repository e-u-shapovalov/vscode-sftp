## Setting

There are a handful of settings available for WireFerry, and they can be changed:

- On Windows/Linux: File --> Preferences --> Settings
- On macOS: Code --> Preferences --> Settings

### wireferry.debug
Adds debugging output to the WireFerry output panel. <br>
You can view the log in `View --> Output --> WireFerry`. Changing this requires VS Code to be reloaded.

| Key | Value | Default |
| --- | --- | --- |
| *wireferry.debug* | *boolean* | *false* |

```json
{
  "wireferry.debug": true
}
```

### wireferry.downloadWhenOpenInRemoteExplorer
Change the default behavior from `View Content` to `Edit in Local` when opening files in the Remote Explorer.

| Key | Value | Default |
| --- | --- | --- |
| *wireferry.downloadWhenOpenInRemoteExplorer* | *boolean* | *false* |

```json
{
  "wireferry.downloadWhenOpenInRemoteExplorer": true
}
```
