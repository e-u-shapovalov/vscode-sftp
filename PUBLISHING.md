# Publishing

How to release **SFTP Sync** (`EvgeniiShapovalov.sftp-sync`).

## One-time setup (first publish only)

1. **Microsoft account** — any account works (https://account.microsoft.com); a Gmail address can be
   used as a Microsoft account.
2. **Azure DevOps organization** — sign in at https://dev.azure.com with that account and create a
   (free) organization. The Marketplace verifies publishers through Azure DevOps.
3. **Create the publisher** — https://marketplace.visualstudio.com/manage → *Create publisher*.
   - Publisher **ID must equal** the `publisher` field in `package.json` (`EvgeniiShapovalov`).
4. **Personal Access Token (PAT)** — in Azure DevOps: *User settings → Personal Access Tokens → New
   Token*.
   - **Organization:** *All accessible organizations*.
   - **Scopes:** *Show all* → **Marketplace → Manage**.
   - Copy the token immediately (shown once). Keep it secret.

## Publish

From the project root:

```bash
npx @vscode/vsce login EvgeniiShapovalov   # paste the PAT once
npx @vscode/vsce publish                    # builds (npm run compile) and uploads
```

The extension appears in the Marketplace within ~5–15 min. Install via the Extensions panel
("SFTP Sync") or `ext install EvgeniiShapovalov.sftp-sync`.

## Releasing a new version

`vsce publish` reads the version from `package.json`. To bump + tag + publish:

```bash
npm version patch       # or: minor / major — bumps package.json and creates a git tag
npx @vscode/vsce publish
git push --follow-tags
```

## Test before publishing

A published version is public and a re-release requires a version bump, so verify the packaged build
locally first:

```bash
npx @vscode/vsce package
code --install-extension sftp-sync-<version>.vsix
```

Then sanity-check the critical paths: connect to a server, download/upload, Remote Explorer **Delete**,
local delete → "delete on server?" prompt, and the refresh button.

## Checklist (already satisfied, here for future edits)

`package.json` has `publisher`, `name`, `version`, `engines`, `repository`, `icon`, `categories`;
`LICENSE`, `README.md`, `CHANGELOG.md` exist. Keep them in sync when changing identity.
