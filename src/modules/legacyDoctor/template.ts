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

    // ---- Legacy SSH servers (since 2.2.1) ------------------------------------------------
    // Old servers may only support obsolete key-exchange algorithms (e.g. diffie-hellman-group1-sha1).
    // These are off by default; enable the one(s) your server needs. "append" keeps the modern
    // algorithms working for other servers. Since 2.2.1 WireFerry can compute these even though
    // VS Code's own crypto backend can't, so a server that failed with "Unknown DH group" now connects.
    // "algorithms": { "kex": { "append": ["diffie-hellman-group1-sha1"] } },

    // ---- Transfer behaviour --------------------------------------------------------------
    // "useTempFile": false,           // Upload to a temp file then rename (avoids partial reads).
    // "openSsh": false,               // Atomic uploads on OpenSSH servers (requires useTempFile).
    // "downloadOnOpen": false,        // When you open a LOCAL file that also exists on the server,
    //                                 // pull the server copy over it. true = always, "confirm" = ask
    //                                 // first, false = off. Files not on the server are left alone.
    // "concurrency": 4,               // Parallel transfers (FTP is always forced to 1).
    // "connectTimeout": 10000,        // Connection timeout in milliseconds.

    // ---- Files to skip (never transferred) -----------------------------------------------
    // Matching files are SKIPPED in every transfer — upload, download AND sync (not deleted, just
    // never sent). Patterns use .gitignore syntax, matched relative to "context" for local files
    // and to "remotePath" on the server.
    // "ignore": ["node_modules", ".git", "*.log"],
    // "ignoreFile": ".gitignore",     // Also read patterns from this file (.gitignore format, one
    //                                 // per line). Path relative to the project root, or absolute.

    // ---- "Sync" command behaviour --------------------------------------------------------
    // "source" and "destination" depend on the direction you run: "Sync Local -> Remote" makes your
    // computer the source and the server the destination; "Sync Remote -> Local" is the reverse.
    // "syncOption": {
    //     "delete": true,             // Delete files in the destination that don't exist in the source (mirror).
    //     "skipCreate": false,        // Don't create files that exist only in the source.
    //     "ignoreExisting": false,    // Don't touch files that already exist in the destination.
    //     "update": false             // Overwrite an existing file only when the source copy is newer.
    // },

    // ---- Server tree (Remote Explorer) — affects ONLY the panel's look, not transfers ----
    // "remoteExplorer": {
    //     "filesExclude": ["*.log", "cache"], // Hide these in the server tree (visual only).
    //                                 // .gitignore-style, relative to remotePath; .git/.svn/.hg/CVS/
    //                                 // .DS_Store are always hidden too.
    //     "order": 0                  // This server's position in the tree when you have several:
    //                                 // lower = higher up, ties sort by name. No effect for one server.
    // },

    // ---- Profiles: switchable presets for THIS one server (optional) ----------------------
    // A profile is an ALTERNATIVE set of values for the same connection (e.g. staging vs production).
    // Only ONE is active at a time — switch with "WireFerry: Set Profile" (or push to every profile
    // with the "...to All Profiles" commands). A profile may set any field; what it omits is inherited
    // from the top level. Activate one before transferring. For a SINGLE server you don't need
    // profiles at all — the top-level config above already IS that server.
    // "profiles": {
    //     "staging":    { "host": "staging.example.com", "username": "deploy", "remotePath": "/var/www/staging" },
    //     "production": { "host": "example.com", "username": "root", "remotePath": "/var/www/html" }
    // },
    // "defaultProfile": "staging",  // Profile activated automatically when the config loads.
    //
    // Want SEVERAL servers shown in the tree at once (not switchable — all visible)? Make the WHOLE
    // file a JSON array of configs: [ { "name": "A", ... }, { "name": "B", ... } ]; order them with
    // each server's "remoteExplorer": { "order": N }.

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

    // ---- Старые SSH-серверы (с версии 2.2.1) ---------------------------------------------
    // Старые серверы могут поддерживать только устаревший обмен ключами (напр. diffie-hellman-group1-sha1).
    // По умолчанию он выключен; включите нужный вашему серверу. "append" не ломает современные
    // алгоритмы для других серверов. С версии 2.2.1 WireFerry считает такой обмен ключами сам, даже
    // когда крипто-движок VS Code не умеет, — сервер, падавший с "Unknown DH group", теперь подключается.
    // "algorithms": { "kex": { "append": ["diffie-hellman-group1-sha1"] } },

    // ---- Поведение передачи --------------------------------------------------------------
    // "useTempFile": false,           // Выгружать во временный файл, затем переименовывать.
    // "openSsh": false,               // Атомарная выгрузка на OpenSSH (требует useTempFile).
    // "downloadOnOpen": false,        // При открытии ЛОКАЛЬНОГО файла, который есть и на сервере,
    //                                 // подтянуть серверную версию поверх. true = всегда, "confirm" =
    //                                 // спросить, false = выкл. Файлы, которых нет на сервере, не трогаются.
    // "concurrency": 4,               // Параллельные передачи (для FTP всегда 1).
    // "connectTimeout": 10000,        // Таймаут подключения, мс.

    // ---- Файлы, которые не передавать ----------------------------------------------------
    // Подходящие файлы ПРОПУСКАЮТСЯ при любой передаче — выгрузке, скачивании И синхронизации (не
    // удаляются, просто не передаются). Шаблоны — синтаксис .gitignore; путь сопоставляется
    // относительно "context" (для локальных файлов) и "remotePath" (на сервере).
    // "ignore": ["node_modules", ".git", "*.log"],
    // "ignoreFile": ".gitignore",     // Дополнительно брать шаблоны из этого файла (формат
    //                                 // .gitignore, по одному на строку). Путь от корня проекта
    //                                 // или абсолютный.

    // ---- Поведение команды «Синхронизация» -----------------------------------------------
    // «Источник» и «приёмник» зависят от направления: «Синхронизация: локально → сервер» — источник =
    // ваш компьютер, приёмник = сервер; «сервер → локально» — наоборот.
    // "syncOption": {
    //     "delete": true,             // Удалять в приёмнике файлы, которых нет в источнике (зеркало).
    //     "skipCreate": false,        // Не создавать файлы, которые есть только в источнике.
    //     "ignoreExisting": false,    // Не трогать файлы, которые уже есть в приёмнике.
    //     "update": false             // Перезаписывать существующий файл, только если в источнике он новее.
    // },

    // ---- Дерево сервера (Remote Explorer) — влияет ТОЛЬКО на вид панели, не на передачу ---
    // "remoteExplorer": {
    //     "filesExclude": ["*.log", "cache"], // Прятать это в дереве сервера (только визуально).
    //                                 // Шаблоны .gitignore, относительно remotePath; .git/.svn/.hg/
    //                                 // CVS/.DS_Store скрыты всегда.
    //     "order": 0                  // Позиция этого сервера в дереве, если серверов несколько:
    //                                 // меньше — выше, при равных — по имени. Для одного — не важно.
    // },

    // ---- Профили: переключаемые наборы для ЭТОГО сервера (необязательно) ------------------
    // Профиль — это АЛЬТЕРНАТИВНЫЙ набор значений для того же подключения (например staging и
    // production). Активен ТОЛЬКО ОДИН — переключение «WireFerry: Выбрать профиль» (или выгрузка во
    // все профили — команды «…во все профили»). Профиль задаёт любое поле; что не задано — берётся
    // сверху. Перед передачей активируйте профиль. Для ОДНОГО сервера профили не нужны — верхний
    // конфиг выше И ЕСТЬ этот сервер.
    // "profiles": {
    //     "staging":    { "host": "staging.example.com", "username": "deploy", "remotePath": "/var/www/staging" },
    //     "production": { "host": "example.com", "username": "root", "remotePath": "/var/www/html" }
    // },
    // "defaultProfile": "staging",  // Профиль, активируемый автоматически при загрузке конфига.
    //
    // Нужно показать в дереве СРАЗУ НЕСКОЛЬКО серверов (без переключения — все видны)? Сделайте ВЕСЬ
    // файл массивом конфигов: [ { "name": "A", ... }, { "name": "B", ... } ]; порядок — через
    // "remoteExplorer": { "order": N } у каждого.

    // ---- Миграция со старого формата -----------------------------------------------------
    // "keepLegacyConfigFormat": false // true — больше не предлагать переименование sftp.json.
}
`;

// The commented JSONC template in the chosen alert language (wireferry.alertLanguage).
export function getConfigTemplate(lang: 'en' | 'ru'): string {
  return lang === 'ru' ? TEMPLATE_RU : TEMPLATE_EN;
}
