# Publishing

How to release **WireFerry** (`EvgeniiShapovalov.wireferry`).

The Visual Studio Marketplace listing is active again: version 2.6.4 passed validation and is
available as `EvgeniiShapovalov.wireferry`. GitHub Releases remain the manual/offline package
channel.

## One-time setup

1. **Microsoft account** — any account works (https://account.microsoft.com); a Gmail address can be
   used as a Microsoft account.
2. **Azure DevOps organization** — sign in at https://dev.azure.com with that account and create a
   (free) organization. The Marketplace verifies publishers through Azure DevOps.
3. **Create the publisher** — https://marketplace.visualstudio.com/manage → *Create publisher*.
   - Publisher **ID must equal** the `publisher` field in `package.json` (`EvgeniiShapovalov`).
4. **Personal Access Token (PAT)** — in Azure DevOps: *User settings → Personal Access Tokens → New
   Token*. This is useful for `vsce publish`; manual portal upload also works.
   - **Organization:** *All accessible organizations*.
   - **Scopes:** *Show all* → **Marketplace → Manage**.
   - Copy the token immediately (shown once). Keep it secret.

## Publish to Marketplace

From the project root:

```bash
npx @vscode/vsce login EvgeniiShapovalov   # paste the PAT once
npx @vscode/vsce publish                    # builds (npm run compile) and uploads
```

Manual upload path: https://marketplace.visualstudio.com/manage → publisher
`EvgeniiShapovalov` → **New extension** → **Visual Studio Code** → upload
`wireferry-<version>.vsix`.

The extension appears in the Marketplace within ~5–15 min. Install via the Extensions panel
("WireFerry") or `ext install EvgeniiShapovalov.wireferry`.

## Releasing a new version

Use the project bump script first, then verify, package and publish:

```bash
npm run bump -- X.Y.Z
npm run compile
npx tsc --noEmit
npm test
npx @vscode/vsce package
```

Then upload `wireferry-X.Y.Z.vsix` to Marketplace and create the matching GitHub Release with the
same asset.

## Test before publishing

A published version is public and a re-release requires a version bump, so verify the packaged build
locally first:

```bash
npx @vscode/vsce package
code --install-extension wireferry-<version>.vsix
```

Then sanity-check the critical paths: connect to a server, download/upload, Remote Explorer **Delete**,
local delete → "delete on server?" prompt, and the refresh button.

## Checklist (already satisfied, here for future edits)

`package.json` has `publisher`, `name`, `version`, `engines`, `repository`, `icon`, `categories`;
`LICENSE`, `README.md`, `CHANGELOG.md` exist. Keep them in sync when changing identity.
