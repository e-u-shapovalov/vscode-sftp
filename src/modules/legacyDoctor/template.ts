// Fully-commented JSONC config templates created for fresh workspaces (Part 6). Required fields
// carry example values; optional fields are listed commented-out with their defaults. Localised by
// wireferry.alertLanguage (see getConfigTemplate). Configs are parsed as JSONC
// (config.ts readConfigsFromFile), so these comments load fine.

const TEMPLATE_EN = `{
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

const TEMPLATE_RU = `{
    // Конфигурация WireFerry — замените примеры реальными данными вашего сервера.
    // Наведите курсор на поле, чтобы увидеть полное описание (подключена JSON-схема). Необязательные
    // настройки приведены закомментированными со значениями по умолчанию; раскомментируйте нужные.

    "name": "my_server",            // Подпись в строке состояния и в дереве сервера.
    "host": "192.168.0.1",          // Имя хоста или IP-адрес сервера.
    "port": 22,                     // Порт (SFTP/SSH: 22, FTP: 21).
    "username": "user",             // Имя пользователя для входа.
    "password": "",                 // Пароль. Оставьте "", чтобы спрашивался, или используйте ключ (ниже).
    "protocol": "sftp",             // "sftp" | "ftp" | "local".
    "remotePath": "/var/www/",      // Абсолютный базовый путь на сервере.
    "context": "./",                // Локальная папка (относительно проекта), сопоставленная с remotePath.
    "uploadOnSave": true            // Выгружать файл на сервер при каждом сохранении.

    // ---- Аутентификация (SFTP) -----------------------------------------------------------
    // "privateKeyPath": "~/.ssh/id_rsa", // Абсолютный путь к приватному ключу.
    // "passphrase": true,             // Пароль ключа; true = спрашивать, а не хранить здесь.
    // "agent": "pageant",             // Сокет ssh-agent; в Windows "pageant" для Pageant.
    // "interactiveAuth": false,       // true для интерактивной аутентификации (2FA).
    // "sshConfigPath": "~/.ssh/config", // Брать настройки подключения из SSH-config.

    // ---- Поведение передачи --------------------------------------------------------------
    // "useTempFile": false,           // Выгружать во временный файл, затем переименовывать.
    // "openSsh": false,               // Атомарная выгрузка на OpenSSH (требует useTempFile).
    // "downloadOnOpen": false,        // true | false | "confirm" — скачивать при открытии файла.
    // "concurrency": 4,               // Параллельные передачи (для FTP всегда 1).
    // "connectTimeout": 10000,        // Таймаут подключения, мс.

    // ---- Файлы для игнорирования ---------------------------------------------------------
    // "ignore": [".vscode", ".git", ".DS_Store"], // Шаблоны в стиле gitignore.
    // "ignoreFile": ".gitignore",     // Использовать шаблоны из ignore-файла.

    // ---- Команда «Синхронизация» ---------------------------------------------------------
    // "syncOption": {
    //     "delete": true,             // Удалять на приёмнике файлы, которых нет в источнике.
    //     "skipCreate": false,        // Не создавать новые файлы на приёмнике.
    //     "ignoreExisting": false,    // Не перезаписывать уже существующие на приёмнике.
    //     "update": false             // Перезаписывать только если источник новее.
    // },

    // ---- Удалённый проводник -------------------------------------------------------------
    // "remoteExplorer": {
    //     "filesExclude": [],         // Шаблоны для скрытия в дереве сервера.
    //     "order": 0                  // Порядок сортировки среди нескольких корней.
    // },

    // ---- Несколько серверов --------------------------------------------------------------
    // "profiles": {                   // Именованные переопределения; «WireFerry: Выбрать профиль».
    //     "staging": { "host": "staging.example.com", "remotePath": "/var/www/staging" },
    //     "production": { "host": "example.com", "remotePath": "/var/www/html" }
    // },
    // "defaultProfile": "staging",

    // ---- Миграция со старого формата -----------------------------------------------------
    // "keepLegacyConfigFormat": false // true — больше не предлагать переименование sftp.json.
}
`;

// The commented JSONC template in the chosen alert language (wireferry.alertLanguage).
export function getConfigTemplate(lang: 'en' | 'ru'): string {
  return lang === 'ru' ? TEMPLATE_RU : TEMPLATE_EN;
}
