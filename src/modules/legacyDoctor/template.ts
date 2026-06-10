// A fully-commented JSONC config template created for fresh workspaces (Part 6). Required fields
// carry example values; optional fields are shown commented-out with their defaults and a short
// note pulled from schema/definitions.json. Because configs are now parsed as JSONC
// (config.ts readConfigsFromFile), these comments load fine.
export const CONFIG_TEMPLATE = `{
    // WireFerry configuration — replace the example values below with your real server details.
    // Hover any field for its full description (a JSON schema is attached). Optional settings are
    // listed commented-out with their defaults; uncomment the ones you need.

    "name": "my_server",            // Label shown in the status bar and Remote Explorer.
    "host": "192.168.0.1",          // Hostname or IP address of the server.
    "port": 22,                     // Port number (SFTP/SSH: 22, FTP: 21).
    "username": "user",             // Username for authentication.
    "password": "",                 // Password. Leave "" to be prompted, or use a key (see below).
    "protocol": "sftp",             // "sftp" | "ftp" | "local".
    "remotePath": "/var/www/",      // Absolute base path on the server.
    "context": "./",                // Local folder (relative to the workspace) mapped to remotePath.
    "uploadOnSave": true            // Upload a file to the server every time you save it.

    // ---- Authentication (SFTP) -----------------------------------------------------------
    // "privateKeyPath": "~/.ssh/id_rsa", // Absolute path to your private key.
    // "passphrase": true,             // Key passphrase; true = prompt instead of storing it here.
    // "agent": "pageant",             // ssh-agent socket; on Windows "pageant" for Pageant.
    // "interactiveAuth": false,       // true to enable keyboard-interactive (2FA) prompts.
    // "sshConfigPath": "~/.ssh/config", // Read connection settings from an SSH config file.

    // ---- Transfer behaviour --------------------------------------------------------------
    // "useTempFile": false,           // Upload to a temp file then rename (avoids partial reads).
    // "openSsh": false,               // Atomic uploads on OpenSSH servers (requires useTempFile).
    // "downloadOnOpen": false,        // true | false | "confirm" — download when a file opens.
    // "concurrency": 4,               // Parallel transfers (FTP is always forced to 1).
    // "connectTimeout": 10000,        // Connection timeout in milliseconds.

    // ---- Files to ignore -----------------------------------------------------------------
    // "ignore": [".vscode", ".git", ".DS_Store"], // gitignore-style patterns to skip.
    // "ignoreFile": ".gitignore",     // Use patterns from an ignore file.

    // ---- Sync command --------------------------------------------------------------------
    // "syncOption": {
    //     "delete": true,             // Delete files on dest that are missing on src.
    //     "skipCreate": false,        // Don't create new files on dest.
    //     "ignoreExisting": false,    // Don't overwrite files already present on dest.
    //     "update": false             // Only overwrite when the src file is newer.
    // },

    // ---- Remote Explorer -----------------------------------------------------------------
    // "remoteExplorer": {
    //     "filesExclude": [],         // Patterns to hide in the Remote Explorer tree.
    //     "order": 0                  // Sort order among multiple configured roots.
    // },

    // ---- Multiple servers ----------------------------------------------------------------
    // "profiles": {                   // Named overrides; switch with "WireFerry: Set Profile".
    //     "staging": { "host": "staging.example.com", "remotePath": "/var/www/staging" },
    //     "production": { "host": "example.com", "remotePath": "/var/www/html" }
    // },
    // "defaultProfile": "staging",

    // ---- Legacy migration ----------------------------------------------------------------
    // "keepLegacyConfigFormat": false // Set true to stop prompts about renaming sftp.json.
}
`;
