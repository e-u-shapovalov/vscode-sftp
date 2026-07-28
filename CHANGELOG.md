# Changelog

> **WireFerry** — независимо поддерживаемый форк [vscode-sftp](https://github.com/Natizyskunk/vscode-sftp) (Natizyskunk ← liximomo).
> Сверху — коротко о новом простым языком; технические детали каждого релиза спрятаны в блок **«Подробности»** (нажмите, чтобы развернуть).
> _Plain-language highlights up top; per-release specifics are tucked into **"Details"**. New entries: English first, then Russian (Russian kept in full); older entries below predate this order._

## ✨ What's New · Что нового

**English — in short**
- **2.8.2** — you decide where the operation log goes, and the extension does noticeably less work. The new **`wireferry.operationLog`** setting (issue #3) sends the upload/download/delete log to a **new tab** (default, as before), to the **WireFerry output channel** (no tab, no focus stolen, the panel doesn't pop up either) or **nowhere** — and a run that had errors still notifies you with a **Show log** button, so muting the log never mutes a failure. Under the hood: a transfer no longer asks the server for each file's size when it already knows it (on FTP that was a full directory listing per file), a save no longer throws away the whole tree's cached state, and the watcher uploads a batch several files at a time instead of one by one. Two of those turned up real bugs — **"Upload Modified" could quietly under-count** because every save wiped the pending content checks, and a watcher batch could **silently drop an edit** it thought was still downloading. Painting the tree is cheaper too (settings and language are no longer re-read for every row), with the sort order left exactly as it was.
- **2.8.0** — a big pass over the server tree. A new **"Upload Modified"** toolbar button uploads every changed (M) file from the tree at once — the ones you can write go the normal way, the root-owned ones are staged and applied via `su` after a single password; **"Recheck Modified Files"** on a folder re-scans it (even collapsed branches) to refresh the M badges. Status badges are clearer: **L** (local-only) is now **green**, **R** (remote-only) **blue**, an in-sync file drops its inline Download and shows a struck-through Download/Upload in the menu, a **🔒** marks a file you can't read (right-click "View as root"), and a folder you can't fully list shows a **"List not complete — Show all as root…"** row so one shared file no longer masquerades as the whole folder. **The yellow M no longer vanishes after Refresh**, and parent folders up to the root correctly light up. A **spinner** shows while a root (`su`) command runs, and **deleting a server folder that's fully backed up locally** no longer forces a typed "yes" (a local delete goes to the OS trash). Plus a large batch of correctness fixes from several code-review rounds: a trailing-slash `remotePath` no longer broke the parent-M badge / drag-and-drop / Open-by-Path, a mirror sync-delete no longer removed an ignored file on a sibling-prefixed path, the root batch-upload is hardened (0600 staging, refuses a vanished or symlinked target, always cleans up), and "View as root" listings now carry numeric ids so the read/write badges compute.
- **2.7.7** — the follow-up that makes the 2.7.0 unified tree solid, plus root-access uploads/downloads and content-accurate status. **Modified (M) now means the content really differs**: for two same-size files WireFerry checks **MD5 in the background** before flagging `M`, so a mere timestamp difference no longer shows as modified (a matching file has its local time aligned to the server, and that touch is kept from triggering auto-upload); **parent folders inherit `M`**, so you can see at a glance which folder holds an un-uploaded change. You can now **download / edit a root-owned file you can't read** (`su` fetches it into your local copy) and **upload a folder into a write-protected path as root** (staged to a temp dir, then moved into place via `su`). New files/folders **created in the tree** default to safe **644/755** (an upload keeps the local file's mode unless `filePerm` is set), and an existing config **gets `filePerm`/`dirPerm` written in** on startup so the setting is visible and tuneable (issue #2). Plus fixes carried over from the interim builds: the folder-size `du` retry-loop on local-only folders, a `Config Not Found` after a tree delete, and local-only rows no longer offering server-only actions.
- **2.7.0** — the server tree now shows your **local** files too, side by side with the server. Each row carries a status at a glance: **L** = only on your disk (not uploaded yet), **M** = differs from the server, **yellow** = no permission to read/list, plus sizes on both sides; local files appear instantly while the server side loads in the background, and a click opens the local copy when you have one. New files and folders you create in the tree now honour **`filePerm` / `dirPerm`** (New File/Folder, not just upload), and a fresh config seeds `644`/`755`. And you can now browse **root-owned paths you can't read**: a folder like `/root` shows yellow — right-click **View / list as root**, enter the owner's or root's password, and WireFerry lists it (or opens a file you can't read) via `su`. The password is kept in memory only. You can also **delete** a root-owned file/folder you can't remove — with a confirmation each time — via `su rm`.
- **2.6.6** — the right-click menus are tidied so it's clear which commands are WireFerry's and which are VS Code's. In the local Explorer and the editor-tab menu, the utility commands (Config, Reveal in Remote Explorer, Show Tree, Size & MD5, Diff, Delete server/local/both) are gathered under a single **WireFerry ▸** submenu, while the everyday **Sync / Upload / Download** stay top-level, one click away. "Copy Path (Git Bash)" stays next to the native Copy Path, and in the editor body all WireFerry actions sit together in one block. Menu-only change — nothing renamed or removed, every command still reachable where it was.
- **2.6.5** — drag & drop in the tree no longer fails on a name clash. If the destination folder already has a same-named file, WireFerry compares both (size, permissions, owner, MD5) and asks: **Overwrite**, **Rename**, **Do nothing** or **Cancel**. A byte-identical file (by MD5) moves silently — the source duplicate is just removed. Overwriting a folder asks again before the recursive delete.
- **2.6.4** — WireFerry is back on the Visual Studio Marketplace: version 2.6.4 passed validation and is published as `EvgeniiShapovalov.wireferry`. Updates now use VS Code Marketplace, with no separate background GitHub check. WireFerry no longer asks for startup GitHub-check consent, calls `api.github.com`, or downloads a `.vsix` next to the project. **WireFerry: Check for Updates** now opens the extension page and asks VS Code to refresh Marketplace updates. `wireferry.checkForUpdates` remains as a deprecated no-op for older user settings, and the docs now point to Marketplace as the primary install channel; GitHub Releases stay available for manual/offline installs.
- **2.6.3** — concurrency under control plus targeted reliability fixes. "Upload Changed Files" and simultaneous transfers no longer open connections beyond the configured `concurrency` (which could trip sshd limits or get you banned on shared hosting) — each connection now shares one bounded scheduler. A profile that sets one sub-key of `watcher`/`syncOption`/`remoteExplorer` no longer wipes the others. Deleting an unsupported remote file type (socket/device) is reported as a failure, not "deleted". Windows `~\` home paths for the key and ssh-config are expanded. The "couldn't set file time" warning now surfaces per server, not once per session.
- **2.6.2** — reliability and completeness from a code review. Delete "on server and locally": if the local file can't be removed (e.g. read-only) you now get an explicit warning instead of a silent "deleted" while the file stays on disk. After a recursive `chmod -R` the whole subtree refreshes, so nested files no longer keep a stale "read-only" badge. Plus a large documentation pass: the README now lists shipped features (drag & drop, operation reports, progress/cancel, symlinks, atomic transfers, migration doctor, update check), and the reference docs + JSON schema were aligned with the code (FTPS secure/secureOptions, `useTempFile`/`syncOption` defaults).
- **2.6.1** — a folder tree in one click. Right-click a folder (in the server tree or the local Explorer) and the new **"Show Tree"** command draws an ASCII tree into a text tab. Choose what to show — folders only, with files, or with files and sizes — and set a maximum depth (empty or 0 = no limit). The walk runs with a progress indicator and cancel, and very large folders stop cleanly at 20000 entries. Plus refreshed and expanded documentation.
- **2.6.0** — edit root-owned files straight from your editor and tidy up permissions. No permission to write a file? The recovery dialog now has an **"Apply as root now"** button — WireFerry stages your copy and applies it via `su -` (asking for the root password), keeping the target's owner and mode: ideal for editing root-owned nginx/php configs. A new **"Change Owner / Group (chown)"** command in the tree, and a denied `chmod` can be retried as root. The hover tooltip shows the **owner and group**, and files you **can't write** are dimmed with an **"RO"** badge and a reason. The root password never touches disk or logs. Hardened over three rounds of external review.
- **2.5.7** — no permission to write a file on the server? It's no longer just an error. WireFerry now offers to save your edited copy to a writable path (default `/tmp/<name>`) and hands you a ready root command to apply it in place: `cat '/tmp/file' > '/real/path' && rm -fv '/tmp/file'` — with **"Copy command"** and **"Copy path"** buttons. Ideal for editing root-owned configs (nginx, php) in a local editor and applying them as root. Plus two review fixes: the `local` protocol is no longer rejected by validation without `host`/`username` (meaningless for the local filesystem), and an SFTP channel leak is closed when the subsystem arrives after the request timed out.
- **2.5.6** — symlinks in the server tree are finally recognizable and openable. A symbolic link no longer looks like a regular file: it shows a link icon and a dimmed "→ target" (resolved in the background with one `readlink`). Clicking it no longer fails with a cryptic "unsafe target" error — instead a dialog explains it's a symlink and where it points, with **"Open Target"** (downloads and opens the REAL file, following the link chain to the end) and **"Copy Path"** (to navigate there yourself). Plus two fixes from external review: the rename preflight no longer mistakes a transient/permission `lstat` error for "destination free" (it could rename over an existing file), and a config save can't crash when the initial setup failed at startup.
- **2.5.5** — safer configuration validation and refreshed documentation. The runtime `joi` validator moves from the obsolete 10.6.0 to 17.13.4: the production audit no longer finds the vulnerable `joi` / `hoek` / `topo` chain (0 runtime vulnerabilities). The schema now lives in a pure module covered by 13 direct tests without starting the VS Code UI; JSONC, compatibility fields, strict no-coercion validation and SFTP/FTP/local support are preserved. The main README is now English with a natural standalone Russian version, clearer first-time installation and current screenshots.
- **2.5.4** — open **any** server file by path, even above your scope. "Open Remote File by Path" no longer refuses a path outside the configured `remotePath`: reading is allowed anywhere (over SSH your account can already read it). When opening such a file downloads a copy to local disk, a **once-per-session** notice explains where the copy landed and how to widen the scope (the `remotePath` setting). Plus review-round hardening: writes stay strict (a local path can't be coaxed into writing above the root) and preview verifies it's a regular file.
- **2.5.3** — reliability from three rounds of code review + one feature. **Atomic upload/download by default**: a file is staged into a temp copy beside the target and atomically renamed into place — an interrupted transfer (network, cancel, unreadable source) no longer blanks or half-overwrites the existing file; if the directory isn't writable it falls back to a direct write automatically. A new **"Copy Path (Git Bash)"** command in the local Explorer context menu: `C:\path\file` → `/c/path/file` (multi-select supported). Plus a batch of fixes from three external review rounds: `authorized_keys` deploy via append (a dropped connection can't blank the file), atomic `~/.ssh/config` writes, a large-file preview OOM guard, connection dedup, a confirm before server-side deletes in "Upload Changed Files", safe symlink transfer — and a fixed relative-`remotePath` regression (the default `./` works again).
- **2.5.2** — first-server setup wizard. With no config, the panel hides every button and shows a single **"Create Configuration"**. The wizard asks, step by step, for the protocol (SFTP/FTP), host, port, username, remote path and **how to store the password** (default **🔑 key**, plus **🪟 OS keychain** and **📄 plaintext**), then **actually connects** — the config is created only after a successful login and the server shows up in the tree at once. With the key option you can generate a new one (log in with the password once → key onto the server → switch to the key) or point at an existing key.
- **2.5.0** — safe auth: keys and passwords without hand-editing JSON. Three new right-click commands on a server. **"Generate SSH Key…"** — creates a key (ed25519/rsa-4096), deploys the public half to the server (`authorized_keys`), registers it in `~/.ssh/config`, and switches the profile to key auth **only after a verified login** (optionally for every server in the config at once). **"Save Password to Keychain…"** — stores the password in the OS keychain (Windows Credential Manager / macOS Keychain / Linux libsecret) and sets `"password": "secretStorage"` — no more plaintext password in JSON; if a key is present it offers to drop it (a clean key↔password switch in one click). **"Delete Saved Password…"** — list saved credentials and remove them from the keychain. Sentinels: `"secretStorage"` reads/saves via the keychain, `"prompt"` asks every time; the new-config template now defaults to `"password": "prompt"`. Plus, from a large code review — a multi-hop fix (the chain was built in reverse order) and a batch of auth hardening.
- **2.4.18** — delete from all servers. The delete dialog gains an **"All servers + computer"** button (shown when the config defines `profiles`): it removes the file/folder from **every** profile's server and the local copy in one action — the mirror of "Upload to All Profiles". Each host is deleted independently (an unreachable server doesn't stop the rest), every `delete.log` row is tagged with its server (`← host`), and the local copy goes to the trash once.
- **2.4.17** — multi-profile + polish. **Each profile is its own root in the server tree**: see every server at once and browse any without switching the active profile (label = profile name, host alongside; `profilesAsRoots` setting). **`uploadOnSave` is now per-profile** — each profile has its own `true`/`false` (or inherits the base), and a save uploads to **every profile whose effective value is `true`** (a base `true` reaches all — a fleet of mirrors; set a profile's to `false` to skip it). A save to several profiles now **names the server that failed right away** (a partial success is a warning, not "everything failed"), and SFTP errors gained hints for **Permission denied** and "no such path". Plus a batch of follow-up-review fixes: a temp-file leak from `diff` is gone, FTP symlinks no longer "silently vanish", and a quote-based bypass of the `sshCustomParams` guard is closed.
- **2.4.13** — sizes & MD5 in the tree + a save fix for symlinked / subst drives. The server explorer gains two toggles: **show sizes** for files and folders and **sort by size** (folder sizes via one server-side `du`, in the background — the tree never blocks). A new **"Size & MD5"** report on right-click (in the server tree and the local Explorer): size on both sides + **MD5** locally and on the server + a **✓/✗** verdict; folder MD5 is opt-in; a clear "NOT FOUND on server". Our **Delete (server / local / both)** is now available from the local Explorer too — idempotent, with a permanent-delete fallback when the OS trash is unavailable. And the headline fix: **`uploadOnSave` no longer fails with "Config Not Found"** on projects opened through a symlink (Linux/macOS) or a subst / mapped drive (Windows).
- **2.3.1** — operation visibility. A **byte progress bar** for right-click uploads/downloads: it shows "45 MB / 200 MB" with a **Cancel** button — a big file no longer transfers in silence. After a download, text files open at once while binaries (exe/video/archives) and files **over 10 MB** ask first — VS Code no longer freezes. An **operation report** tab `delete/upload/download.log` after right-click actions: what and where, size, date, permissions; for deletes it shows where the local and server copies differ. Optional skipping of files over a set size during folder transfers (`maxFileSize`). Folder delete now runs file-by-file, with progress and cancel. Upload-on-save is untouched.
- **2.2.1** — connecting to **legacy SSH servers**. Servers that only speak the obsolete `diffie-hellman-group1-sha1` key exchange (and friends) used to fail with `Unknown DH group`: VS Code's crypto backend (Electron/BoringSSL) doesn't implement classic Diffie-Hellman. The extension now computes the key exchange itself (via `BigInt`) whenever the backend refuses. Modern connections are untouched; the legacy algorithm is enabled explicitly in the config — `"algorithms": { "kex": { "append": ["diffie-hellman-group1-sha1"] } }`.
- **2.2.0** — reliability & security. Fixed **Sync Both Directions**: files and folders that are newer or exist only on the server now actually download to your computer (that half used to silently do nothing). An upload no longer empties the file on the server when the local source can't be read. A case-only rename (`foo`→`Foo`) works on case-insensitive servers. Connections from every profile are closed when the config changes. Security hardening: `CR`/`LF` rejected in names (guards against FTP command injection), passwords masked in logs including nested profiles and hops, and updates download only from GitHub over HTTPS. The tree hover now shows **permissions**; names are validated when creating a file/folder.
- **2.1.0** — permissions: a **"Change Permissions (chmod)"** command in the tree context menu (presets `644`/`755`/… + recursive for folders) and a hover tooltip with **size and date** on files. Fixed: explicit Create/Delete are no longer blocked by the `ignore` filter (files matched by a rule like `*.txt` create/delete again), and a new folder shows as a folder, not a file.
- **2.0.9** — removed the redundant "download?" prompt when opening a file from the server tree: the click already fetched it via "Edit in Local", so the duplicate question (with a useless "No") is gone.
- **2.0.8** — fixed download-on-open (`downloadOnOpen`): it no longer tries to download the config itself or files absent on the server (no more "No such file"), and asks only when there is something to fetch. The config field descriptions (template + hover) are now clear (`ignore`, `syncOption`, `profiles`, `remoteExplorer`, `downloadOnOpen`).
- **2.0.7** — the config is created **on request**: WireFerry asks whether a project needs SFTP/FTP (with a "don't ask in this project" option) instead of creating it silently; delete the config and it asks again. The template follows `wireferry.alertLanguage`. Right-click a folder in the Explorer → **WireFerry: Config**.
- **2.0.6** — legacy `sftp.*` compatibility: old settings work again (read as `wireferry.*`). On startup WireFerry checks your `settings.json` and config and points out, with line numbers, what to rename (`sftp.*` → `wireferry.*`) or remove; it can fix `settings.json` automatically and offer to rename `.vscode/sftp.json` to `wireferry.json`. Configs now allow comments (JSONC), and a fully-commented template is created for new projects. Added an opt-in GitHub update check (one HTTPS request, only after you agree, no telemetry) and a **"Check for Updates"** command. Plus a `wireferry.alertLanguage` setting and a persistent report tab for the config doctor.
- **2.0.5** — deleting from the server tree now asks *where* to delete: **on the server**, **on the computer**, or **on both** (the local copy goes to the OS trash, it is not erased). Creating a folder whose name already exists now shows a clear message instead of "Failure". SFTP errors are more readable: status 4 is decoded and the failing operation and path are appended. Manuals updated (README/INSTALL/FAQ).
- **2.0.4** — fixed `ignore` rules on mixed-case Windows paths (a 2.0.3 regression — `node_modules`/`.git` could be uploaded to the server); the `local` protocol is now in the config schema; documentation clarifications.
- **2.0.3** — fixed upload-on-save on Windows network (UNC) paths (`\\server\…`): no more "Config Not Found". Sync now waits for file deletions to finish; documentation & settings-schema fixes.
- **2.0.2** — Russian localization of commands & settings (for Russian VS Code) + an "Open Extension Page" item in the server context menu.
- **2.0.1** — new side-panel icon (Activity Bar / Remote Explorer).
- **2.0.0** — new name: **WireFerry**. New icon, commands & settings moved to the `wireferry.*` prefix, and config is now `.vscode/wireferry.json` (legacy `.vscode/sftp.json` still read). Update any custom `sftp.*` keybindings/settings to `wireferry.*`.
- **1.1.2** — maintenance release: security hardening (validates server-sent filenames and SSH connection fields).
- **1.1.1** — rename & move: "Rename" on the server via right-click, auto-sync when you rename/move a file locally, and drag&drop files between folders right in the server tree. Plus a large dependency & toolchain update (minimum VS Code is now 1.66).
- **1.0.9** — open a server file by its full path with one button.
- **1.0.6** — newly created files show in the tree instantly, no manual Refresh (folders since 1.0.4).
- **1.0.2** — "Copy Path" command: copy a file/folder's server-side path.
- **1.0.0** — works on Node 22+; safe delete with a modal confirmation.

**Русский — коротко**
- **2.8.2** — вы сами решаете, куда девать журнал операций, а расширение делает заметно меньше лишней работы. Новая настройка **`wireferry.operationLog`** (issue #3) отправляет журнал выгрузки/скачивания/удаления в **новую вкладку** (по умолчанию, как и раньше), в **канал вывода WireFerry** (без вкладки, без кражи фокуса, панель тоже сама не всплывает) или **никуда** — при этом операция с ошибками всё равно даёт уведомление с кнопкой **«Показать журнал»**, так что отключение журнала никогда не заглушает сбой. Под капотом: передача больше не спрашивает у сервера размер каждого файла, когда уже знает его (на FTP это был полный листинг папки на каждый файл), сохранение файла больше не выбрасывает кэш всего дерева, а вотчер выгружает пачку по несколько файлов сразу, а не по одному. Два из этих мест оказались настоящими багами — **«Выгрузить изменённые» могла молча недосчитаться файлов**, потому что каждое сохранение сбрасывало очередь фоновых проверок, а пачка вотчера могла **молча потерять правку**, посчитав файл всё ещё скачивающимся. Отрисовка дерева тоже подешевела (настройки и язык больше не перечитываются на каждую строку), причём порядок сортировки остался ровно прежним.
- **2.8.0** — большая доработка дерева сервера. Новая кнопка на панели **«Выгрузить изменённые»** заливает все изменённые (M) файлы из дерева разом — те, что можно писать, идут обычным путём, root-овые ставятся во временную папку и применяются через `su` по одному паролю; **«Перечитать изменённые файлы»** по ПКМ на папке пересканирует её (даже свёрнутые ветки) и обновляет метки M. Метки статуса понятнее: **L** (только локально) теперь **зелёный**, **R** (только на сервере) **синий**, синхронный файл теряет inline-кнопку Download и показывает зачёркнутые Download/Upload в меню, **🔒** помечает файл, который вы не можете прочитать (ПКМ → «Показать от root»), а папка, которую не удаётся прочитать целиком, показывает строку **«Список неполный — Показать всё от root…»**, чтобы один общий файл не выдавал себя за всю папку. **Жёлтое M больше не пропадает после «Обновить»**, и папки-родители вплоть до корня подсвечиваются корректно. При выполнении root-команды (`su`) показывается **индикатор**, а **удаление серверной папки, полностью забэкапленной локально**, больше не требует ввода «yes» (локальное удаление — в корзину ОС). Плюс большой пакет исправлений из нескольких раундов ревью: `remotePath` со слэшем в конце больше не ломал метку M на родителях / drag-and-drop / «Открыть по пути», зеркальная синхронизация с удалением больше не стирала игнорируемый файл на пути-соседе, batch-загрузка от root закалена (staging 0600, отказ для исчезнувшей/симлинк-цели, всегда чистит за собой), а листинги «от root» теперь несут числовые id, так что метки чтения/записи вычисляются.
- **2.7.7** — доводка: объединённое дерево из 2.7.0 стало надёжным, плюс загрузка/скачивание от root и статус по реальному содержимому. **Статус M теперь означает, что содержимое действительно различается**: для файлов одного размера WireFerry сверяет **MD5 в фоне**, прежде чем ставить `M`, — простое расхождение по времени больше не помечается как изменение (у совпадающего файла локальное время выравнивается по серверу, и это касание не вызывает авто-выгрузку); **папки-предки наследуют `M`**, так что сразу видно, в какой папке лежит невыгруженное изменение. Появилась возможность **скачать / править root-овый файл, который вы не можете прочитать** (`su` читает его в вашу локальную копию) и **загрузить папку в путь без прав записи от root** (стейдж во временный каталог, затем перенос на место через `su`). Новые файлы/папки, **созданные в дереве**, по умолчанию с безопасными **644/755** (выгрузка сохраняет режим локального файла, если `filePerm` не задан), а существующему конфигу при старте **дописываются `filePerm`/`dirPerm`**, чтобы настройка была видна и настраиваема (issue #2). Плюс фиксы из промежуточных сборок: цикл `du` на локальных-только папках, `Config Not Found` после удаления в дереве и серверные действия у локальных-только строк.
- **2.7.0** — дерево сервера теперь показывает и ваши **локальные** файлы, бок о бок с серверными. У каждой строки виден статус: **L** — только на вашем диске (ещё не выгружен), **M** — отличается от сервера, **жёлтый** — нет прав на чтение/листинг, плюс размеры обеих сторон; локальные файлы появляются мгновенно, а серверная часть подгружается в фоне, и клик открывает локальную копию, если она есть. Новые файлы и папки, созданные в дереве, теперь учитывают **`filePerm` / `dirPerm`** (не только при выгрузке), а свежий конфиг сразу с `644`/`755`. И появился доступ к **root-овым путям, которые вы не можете прочитать**: папка вроде `/root` подсвечивается жёлтым — ПКМ → **Показать / открыть от root**, введите пароль владельца или root, и WireFerry покажет её содержимое (или откроет нечитаемый файл) через `su`. Пароль хранится только в памяти. Также можно **удалять** root-owned файлы/папки, которые не удаляются — с подтверждением каждый раз — через `su rm`.
- **2.6.6** — контекстные меню причёсаны, чтобы сразу было видно, где команды WireFerry, а где — самого VS Code. В локальном проводнике и в меню вкладки редактора служебные команды (Config, Показать в Remote Explorer, Показать дерево, Размер и MD5, Diff, Удаление сервер/локально/оба) собраны в одно подменю **WireFerry ▸**, а повседневные **Синхронизация / Выгрузка / Скачивание** остались на верхнем уровне, в один клик. «Копировать путь (Git Bash)» остался рядом с нативным Copy Path, а в теле редактора все команды WireFerry идут одним блоком. Изменение только в меню — ничего не переименовано и не удалено, каждая команда доступна там же, где и была.
- **2.6.5** — перетаскивание в дереве больше не падает при совпадении имён. Если в целевой папке уже есть файл с таким же именем, WireFerry сравнит оба (размер, права, владелец, MD5) и спросит: **Перезаписать**, **Переименовать**, **Ничего не делать** или **Отмена**. Полностью идентичный по MD5 файл переносится тихо — исходный дубликат просто удаляется. Перезапись папки дополнительно переспрашивает перед рекурсивным удалением.
- **2.6.4** — WireFerry снова доступен в Visual Studio Marketplace: версия 2.6.4 прошла проверку и опубликована как `EvgeniiShapovalov.wireferry`. Обновления теперь идут через VS Code Marketplace, без отдельного фонового GitHub-чека. WireFerry больше не спрашивает при запуске разрешение на проверку GitHub, не ходит в `api.github.com` и не скачивает `.vsix` рядом с проектом. Команда **WireFerry: Check for Updates** теперь открывает страницу расширения и просит сам VS Code проверить Marketplace-обновления. Настройка `wireferry.checkForUpdates` оставлена как устаревшая no-op для совместимости со старыми настройками, а документация теперь ведёт на Marketplace как основной канал установки; GitHub Releases остаются для ручной/offline-установки.
- **2.6.3** — параллельность под контролем и точечные фиксы надёжности. «Выгрузить изменённые файлы» и одновременные передачи больше не открывают соединения сверх заданного `concurrency` (могло упереться в лимиты sshd или поймать бан на shared-хостинге) — у каждого подключения теперь один общий ограниченный планировщик. Профиль, задающий одну под-настройку (`watcher`/`syncOption`/`remoteExplorer`), больше не затирает остальные. Удаление файла неподдерживаемого типа (сокет/устройство) честно сообщается как ошибка, а не «удалено». Пути с `~\` (Windows) для ключа и ssh-config разворачиваются. Предупреждение «не удалось выставить время файла» — по каждому серверу, а не раз за сессию.
- **2.6.2** — надёжность и полнота по итогам код-ревью. Удаление «на сервере и локально»: если локальный файл убрать не удалось (например, read-only), теперь вы увидите явное предупреждение, а не молчаливое «удалено» при файле, оставшемся на диске. После рекурсивного `chmod -R` дерево целиком обновляется — у вложенных файлов больше не висит устаревшая пометка «только чтение». Плюс большая доработка документации: витрина README пополнена реально работающими возможностями (drag & drop, отчёты операций, прогресс/отмена, симлинки, атомарные передачи, доктор миграции, проверка обновлений), а справочники и JSON-схема приведены в соответствие с кодом (secure/secureOptions для FTPS, дефолты `useTempFile`/`syncOption`).
- **2.6.1** — дерево папки одним кликом. По правому клику на папке (в дереве сервера или в локальном проводнике) новая команда **«Показать дерево»** рисует ASCII-дерево в текстовой вкладке. Можно выбрать, что показывать — только папки, с файлами или с файлами и размерами, — и задать максимальную глубину (пусто или 0 = без ограничения). Обход идёт с индикатором прогресса и отменой, а очень большие папки аккуратно обрываются на 20000 записях. Плюс обновлённая и расширенная документация.
- **2.6.0** — правьте root-овые файлы прямо из редактора и наводите порядок с правами. Нет прав записать файл? В окне восстановления теперь есть кнопка **«Применить от root сейчас»** — WireFerry сохранит копию и применит её через `su -` (запросив пароль root), сохранив владельца и права цели: идеально для правки root-овых конфигов nginx/php. Новая команда **«Сменить владельца / группу (chown)»** в дереве, а отклонённый `chmod` можно повторить от root. В подсказке при наведении видно **владельца и группу**, а файлы, в которые вы **не можете писать**, приглушены серым с бейджем **«RO»** и объяснением причины. Пароль root не пишется на диск и в логи. Упрочнено тремя раундами внешнего ревью.
- **2.5.7** — нет прав записать файл на сервере? Теперь это не просто ошибка. WireFerry предложит сохранить вашу изменённую копию в доступный для записи путь (по умолчанию `/tmp/<имя>`) и выдаст готовую команду для root, чтобы применить её на месте: `cat '/tmp/файл' > '/реальный/путь' && rm -fv '/tmp/файл'` — с кнопками **«Копировать команду»** и **«Копировать путь»**. Идеально для правки root-овых конфигов (nginx, php) в локальном редакторе и применения их рутом. Плюс два фикса по ревью: протокол `local` больше не отвергается валидацией без `host`/`username` (для локальной ФС они не нужны), и закрыта утечка SFTP-канала, когда подсистема приходит уже после таймаута.
- **2.5.6** — симлинки в дереве сервера теперь видно и можно открыть по-человечески. Символическая ссылка больше не выглядит как обычный файл: у неё иконка-ссылка и серое «→ цель» (путь подтягивается в фоне одним `readlink`). Клик по ней больше не падает с непонятной ошибкой «unsafe target» — вместо этого окно объясняет, что это симлинк и куда он указывает, с кнопками **«Открыть цель»** (скачивает и открывает РЕАЛЬНЫЙ файл, проходя цепочку ссылок до конца) и **«Скопировать путь»** (чтобы перейти самому). Плюс два фикса по итогам внешнего ревью: preflight переименования больше не принимает временную/permission-ошибку `lstat` за «цель свободна» (мог переименовать поверх существующего файла), а сохранение конфигурации не падает, если первичная инициализация сорвалась на старте.
- **2.5.5** — безопасная валидация конфигурации и обновлённая документация. Runtime-валидатор `joi` обновлён с устаревшей 10.6.0 до 17.13.4: production-аудит больше не находит уязвимую цепочку `joi` / `hoek` / `topo` (0 runtime-уязвимостей). Схема вынесена в отдельный pure-модуль и проверяется 13 прямыми тестами без запуска UI VS Code; сохранены JSONC, legacy-поля, запрет неявного преобразования типов и поддержка SFTP/FTP/local. README теперь основной на английском с отдельной естественной русской версией, установка для новичка и актуальные скриншоты приведены в порядок.
- **2.5.4** — открыть на сервере **любой** файл по пути, даже выше вашего скоупа. «Открыть файл на сервере по полному пути» больше не отказывает, если путь вне настроенного `remotePath`: чтение разрешено где угодно (по SSH ваш аккаунт это и так видит). Когда открытие такого файла качает копию на диск — **один раз за сессию** показывается уведомление: куда именно легла копия и как расширить скоуп (`remotePath`). Плюс упрочнение по итогам ревью: запись осталась строгой (локальный путь нельзя завернуть на запись выше корня), а предпросмотр проверяет, что это обычный файл.
- **2.5.3** — надёжность по итогам трёх раундов код-ревью + одна фишка. **Атомарная выгрузка/скачивание по умолчанию**: файл пишется во временную копию рядом и атомарно переименовывается на место — прерванная передача (сеть, отмена, нечитаемый источник) больше не обнуляет и не оставляет «половину» существующего файла; если в каталог писать нельзя — автоматический фоллбэк на прямую запись. Новая команда **«Копировать путь (Git Bash)»** в контекстном меню локального проводника: `C:\путь\файл` → `/c/путь/файл` (с множественным выбором). Плюс пакет фиксов трёх раундов внешнего ревью: ключ в `authorized_keys` добавляется через append (обрыв связи не обнулит файл), атомарная запись `~/.ssh/config`, защита предпросмотра больших файлов от OOM, дедуп соединений, подтверждение перед удалением на сервере в «Upload Changed Files», безопасные symlink'и при переносе — и устранена регрессия относительного `remotePath` (дефолтный `./` снова работает).
- **2.5.2** — мастер настройки первого сервера. Нет конфига — панель прячет все кнопки и показывает одну **«Создать конфигурацию»**. Мастер по шагам спросит протокол (SFTP/FTP), хост, порт, пользователя, путь и **как хранить пароль** (по умолчанию **🔑 ключ**, ещё **🪟 хранилище ОС** и **📄 открытым текстом**), затем **реально подключится** — конфиг создаётся только после успешного входа, сервер сразу появляется в дереве. При выборе ключа можно сгенерировать новый (вход по паролю один раз → ключ на сервер → переключение на ключ) или указать существующий.
- **2.5.0** — безопасная авторизация: ключи и пароли без правки JSON. По ПКМ на сервере три новых команды. **«Создать SSH-ключ…»** — генерит ключ (ed25519/rsa-4096), заливает публичную часть на сервер (`authorized_keys`), прописывает `~/.ssh/config` и переключает профиль на ключ **только после проверенного входа** (можно сразу на все серверы конфига). **«Сохранить пароль в хранилище…»** — кладёт пароль в системное хранилище ОС (Windows Credential Manager / macOS Keychain / Linux libsecret) и ставит `"password": "secretStorage"` — пароль больше не лежит открытым в JSON; при наличии ключа предложит его убрать (чистый переход ключ↔пароль одной кнопкой). **«Удалить сохранённый пароль…»** — список сохранённых, удаление из хранилища. Sentinel-значения: `"secretStorage"` — через хранилище, `"prompt"` — спрашивать каждый раз; шаблон нового конфига теперь по умолчанию `"password": "prompt"`. Плюс по итогам большого код-ревью — починен multi-hop (цепочка строилась в обратном порядке) и пакет hardening авторизации.
- **2.4.18** — удаление со всех серверов. В окне удаления добавлена кнопка **«Все серверы + ПК»** (видна, когда в конфиге есть `profiles`): удаляет файл/папку с сервера **каждого** профиля и локальную копию за одно действие — зеркало «Upload to All Profiles». Удаление по каждому хосту независимое (недоступный сервер не стопорит остальных), в `delete.log` каждая строка помечена сервером (`← host`), локальная копия уходит в Корзину один раз.
- **2.4.17** — мультипрофиль + полировка. **Каждый профиль — отдельный корень в дереве сервера**: видно все серверы сразу, заходишь в любой без переключения активного профиля (подпись — имя профиля, рядом хост; настройка `profilesAsRoots`). **`uploadOnSave` теперь по-профильно** — у каждого профиля свой `true`/`false` (не указан — наследует базовый), и сохранение уходит **во все профили, где итог `true`** (базовый `true` = во все, ферма зеркал; `false` в профиле — исключить). При сохранении в несколько профилей **имя упавшего сервера видно сразу** (частичный успех — предупреждение, а не «всё упало»), а у ошибок SFTP появились подсказки для **Permission denied** и «нет такого пути». Плюс пачка фиксов по итогам повторного ревью: устранена утечка временных файлов от `diff`, FTP-симлинки больше не «молча пропадают», закрыт обход проверки `sshCustomParams` через кавычки.
- **2.4.13** — размеры и MD5 в дереве + фикс сохранения на симлинках/subst-дисках. В проводнике сервера две кнопки: **показать размеры** файлов и папок и **сортировать по размеру** (размер папок — серверным `du`, в фоне, дерево не залипает). Новый отчёт **«Размер и MD5»** по ПКМ (в дереве сервера и в локальном проводнике): размер обеих сторон + **MD5** локально и на сервере + **✓/✗**; для папки MD5 по запросу; честное «НА СЕРВЕРЕ НЕ НАЙДЕН». Наше **удаление (сервер/локально/оба)** теперь и из локального проводника — идемпотентное и с фоллбэком на безвозвратное удаление, если Корзина недоступна. И главный фикс: **`uploadOnSave` больше не падает «Config Not Found»** на проектах через симлинк (Linux/macOS) или subst/подключённый диск (Windows).
- **2.3.1** — видимость операций. **Прогресс-бар по байтам** при выгрузке/скачивании по ПКМ: видно «45 МБ из 200» и кнопка **Отмена** — большой файл больше не качается в тишине. После скачивания текстовые файлы открываются сразу, а бинарные (exe/видео/архивы) и файлы **больше 10 МБ** спрашивают подтверждение — VS Code больше не виснет. **Отчёт** во вкладке `delete/upload/download.log` после ПКМ-действий: что и куда, размер, дата, права; при удалении видно расхождение локальной и серверной копий. Необязательный пропуск файлов больше заданного размера при передаче папки (`maxFileSize`). Удаление папки теперь идёт пофайлово — с прогрессом и отменой. Автовыгрузка при сохранении не затрагивается.
- **2.2.1** — подключение к **старым SSH-серверам**. Серверы, которые умеют только устаревший обмен ключами `diffie-hellman-group1-sha1` (и подобные), раньше падали с `Unknown DH group`: крипто-движок VS Code (Electron/BoringSSL) не реализует классический Diffie-Hellman. Теперь расширение считает обмен ключами само (на `BigInt`), когда движок отказывает. Современные подключения не затронуты; legacy-алгоритм включается явно в конфиге — `"algorithms": { "kex": { "append": ["diffie-hellman-group1-sha1"] } }`.
- **2.2.0** — надёжность и безопасность. Исправлена **синхронизация в обе стороны**: файлы и папки, которые новее или есть только на сервере, теперь действительно скачиваются на компьютер (раньше эта половина молча не работала). Выгрузка больше не обнуляет файл на сервере, если локальный источник не удалось прочитать. Переименование со сменой только регистра (`foo`→`Foo`) работает на регистронезависимых серверах. Соединения всех профилей закрываются при смене конфига. Усилена безопасность: запрет `CR`/`LF` в именах (защита от инъекций в FTP-команды), маскировка паролей в логах в т.ч. во вложенных профилях и хопах, обновления качаются только с GitHub по HTTPS. В подсказке дерева теперь видны **права доступа**; имена при создании файла/папки проверяются.
- **2.1.0** — права доступа: команда **«Изменить права (chmod)»** в контекстном меню дерева (пресеты `644`/`755`/… + рекурсивно для папок) и подсказка с **размером и датой** при наведении на файл. Исправлено: явные «Создать»/«Удалить» больше не блокирует фильтр `ignore` (файлы под правилом вроде `*.txt` снова создаются и удаляются), а новая папка сразу показывается папкой, а не файлом.
- **2.0.9** — убран лишний вопрос «скачать?» при открытии файла из дерева сервера: клик уже скачивал файл через «Edit in Local», и повторный вопрос (с бесполезным «Нет») больше не появляется.
- **2.0.8** — исправлено «скачивание при открытии» (`downloadOnOpen`): больше не качает сам конфиг и файлы, которых нет на сервере (конец ошибок «No such file»), спрашивает только когда есть что качать. Описания полей в шаблоне и в подсказках стали понятными (`ignore`, `syncOption`, `profiles`, `remoteExplorer`, `downloadOnOpen`).
- **2.0.7** — конфиг создаётся **по запросу**: расширение спрашивает, нужен ли в проекте SFTP/FTP (с вариантом «не спрашивать в этом проекте»), а не создаёт молча; после удаления конфига спросит снова. Шаблон — на языке `wireferry.alertLanguage`. ПКМ по папке в проводнике → **WireFerry: Config**.
- **2.0.6** — совместимость с легаси `sftp.*`: старые настройки снова работают (читаются как `wireferry.*`). При старте расширение проверяет `settings.json` и конфиг и подсказывает с номерами строк, что заменить (`sftp.*` → `wireferry.*`) или удалить; умеет починить `settings.json` автоматически и предложить переименовать `.vscode/sftp.json` в `wireferry.json`. Конфиг теперь допускает комментарии (JSONC), а для нового проекта создаётся подробный шаблон. Добавлена проверка обновлений на GitHub (с вашего согласия, один HTTPS-запрос, без телеметрии) и команда **«Проверить обновления»**. Появились настройка языка сообщений (`wireferry.alertLanguage`) и окно-отчёт диагностики, которое висит, пока не закроешь.
- **2.0.5** — удаление из дерева сервера теперь спрашивает, *где* удалять: **на сервере**, **на компьютере** или **и там и там** (локальная копия уходит в Корзину ОС, а не стирается). Создание папки с уже существующим именем показывает понятное сообщение вместо «Failure». Ошибки SFTP стали читаемее: код 4 расшифровывается, к сообщению добавляются операция и путь. Обновлены руководства (README/INSTALL/FAQ).
- **2.0.4** — исправлены правила `ignore` на Windows-путях со смешанным регистром (регрессия после 2.0.3 — `node_modules`/`.git` могли выгружаться на сервер); протокол `local` добавлен в схему конфига; уточнения в документации.
- **2.0.3** — исправлена выгрузка при сохранении на сетевых (UNC) путях Windows (`\\сервер\…`): больше нет «Config Not Found». Синхронизация теперь дожидается завершения удаления файлов; правки в документации и схеме настроек.
- **2.0.2** — русская локализация команд и настроек (для русского интерфейса VS Code) + пункт «Открыть страницу расширения» в контекстном меню сервера.
- **2.0.1** — новая иконка на боковой панели (Activity Bar / «Remote Explorer»).
- **2.0.0** — новое имя: **WireFerry**. Новая иконка, команды и настройки переехали на префикс `wireferry.*`, файл конфигурации теперь `.vscode/wireferry.json` (старый `.vscode/sftp.json` ещё читается). Свои горячие клавиши/настройки под `sftp.*` обновите на `wireferry.*`.
- **1.1.2** — технический релиз: усиление безопасности (проверка имён файлов, присланных сервером, и полей SSH-подключения).
- **1.1.1** — переименование и перемещение: «Rename» по ПКМ на сервере, авто-синхрон при переименовании/переносе файла локально, и drag&drop файлов между папками прямо в дереве сервера. Плюс большое обновление зависимостей и движка (минимум VS Code теперь 1.66).
- **1.0.9** — открыть файл на сервере по полному пути одной кнопкой.
- **1.0.6** — созданные файлы сразу видны в дереве без «Обновить» (папки — ещё с 1.0.4).
- **1.0.2** — команда «Copy Path»: копировать серверный путь файла/папки.
- **1.0.0** — работает на Node 22+; безопасное удаление с модальным подтверждением.

---

## 2.8.2 — where the operation log goes, and a speed pass · куда попадает журнал операций, и работа над скоростью

**English**

- **New setting `wireferry.operationLog`** (issue #3) — decides where the upload / download / delete log goes when a transfer finishes: `tab` (default, unchanged — a new editor tab), `output` (appended to the WireFerry output channel: no tab, no focus change, and the panel is not revealed either) or `off`. Read live, so switching applies to the next transfer without a window reload. Failures are never silenced by it: a run with errors still raises one notification with the tally and a **Show log** button. On-demand reports (`tree.txt`, `folder-size.txt`, the needs-root preview) always open a tab — those are the result you asked for.
- **No more extra network round trip per file.** With a progress bar active, every file was re-stated over the wire purely to tell the bar its size, although the caller already had it from the listing. On FTP that was far worse than one round trip: `lstat` there is a full `LIST` of the parent directory, and the FTP client is serialised — so a folder transfer paid one sequential parent listing per file.
- **A save no longer invalidates the whole tree.** Upload handlers refresh per file, and that refresh was running the global teardown first — every cached listing, in-flight fetch, failed-listing marker, elevated snapshot and the entire queue of pending content checks, for branches that had nothing to do with the saved file. Listing generations are now per directory. Two consequences were real bugs: dropping the MD5 queue on every save left files sitting at "Synced" with nothing queued to correct them, so **"Upload Modified" quietly under-counted**; and clearing the elevated keys threw away a **"View as root"** result just obtained on an unrelated folder.
- **Watcher uploads a batch with bounded parallelism** instead of strictly one at a time. The sequential loop dated from when every transfer built its own scheduler; the shared per-service gate removed that reason. Three defects were fixed first, since parallelism turns them from unlikely into routine: the queue deduplicated by `Uri` object identity rather than by path (two entries for one Ctrl+S — under a parallel batch, two concurrent writes to one remote path); the "is this file downloading" check used a stale snapshot that both missed newly started downloads and kept skipping finished ones, **silently dropping the user's edit**; and that check compared paths case-sensitively, missing on Windows.
- **Building a directory chain tolerates a concurrent creator** — `ensureDir` retried its `mkdir` after creating the parents and failed the whole transfer if someone else had created the directory in the meantime.
- **Cheaper tree rendering** — the settings snapshot and the alert language are cached and refreshed on configuration change (they were re-read per visible row, and the language on *every* translation, so a 500-row folder ran well over ten thousand configuration lookups to paint itself); ancestor keys are memoised per Modified source; sorting uses one shared collator and compares basenames. The visible sort order is unchanged — deliberately not the naive `<`/`>` comparison, which drops every Cyrillic name below every Latin one.
- **Removed the unused `async` dependency.**

**Русский**

- **Новая настройка `wireferry.operationLog`** (issue #3) — определяет, куда попадает журнал выгрузки / скачивания / удаления после завершения операции: `tab` (по умолчанию, как раньше — новая вкладка редактора), `output` (дописывается в канал вывода WireFerry: без вкладки, без смены фокуса, панель тоже сама не открывается) или `off`. Читается вживую, поэтому переключение действует на следующую операцию без перезагрузки окна. Ошибки при этом никогда не заглушаются: операция с ошибками всё равно даёт одно уведомление со сводкой и кнопкой **«Показать журнал»**. Отчёты по явному запросу (`tree.txt`, `folder-size.txt`, превью «нужен root») открываются вкладкой всегда — это и есть результат запрошенной команды.
- **Больше нет лишнего сетевого запроса на каждый файл.** При включённой полосе прогресса размер каждого файла заново спрашивался у сервера только чтобы сообщить его полосе, хотя вызывающая сторона уже получила его из листинга. На FTP это было гораздо дороже одного round-trip: `lstat` там — полный `LIST` родительской папки, а FTP-клиент работает строго последовательно, так что передача папки означала один последовательный листинг родителя на каждый файл.
- **Сохранение файла больше не обесценивает всё дерево.** Обработчики выгрузки обновляют дерево по каждому файлу, а это обновление сначала выполняло глобальный сброс — все кэшированные листинги, висящие запросы, метки неудачного листинга, снимки «от root» и всю очередь фоновых проверок содержимого, в том числе для веток, не имеющих к сохранённому файлу никакого отношения. Теперь поколения листингов ведутся по каждому каталогу отдельно. Два следствия были настоящими багами: сброс очереди MD5 на каждое сохранение оставлял файлы в состоянии «синхронизирован», и исправить их было уже некому — поэтому **«Выгрузить изменённые» молча недосчитывалась файлов**; а сброс ключей «от root» выбрасывал только что полученный результат **«Показать от root»** на посторонней папке.
- **Вотчер выгружает пачку с ограниченным параллелизмом** вместо строго по одному. Последовательный цикл появился, когда каждая передача создавала собственный планировщик; общий ограничитель на сервис эту причину устранил. Сначала пришлось починить три дефекта, потому что параллелизм превращает их из маловероятных в обычные: очередь дедуплицировала по идентичности объекта `Uri`, а не по пути (две записи на один Ctrl+S — при параллельной пачке это две одновременные записи в один и тот же путь на сервере); проверка «файл сейчас скачивается» работала по устаревшему снимку, который и не видел начавшихся скачиваний, и продолжал пропускать уже завершившиеся, **молча теряя правку пользователя**; и та же проверка сравнивала пути с учётом регистра, промахиваясь на Windows.
- **Построение цепочки каталогов терпимо к параллельному создателю** — `ensureDir` повторял `mkdir` после создания родителей и ронял всю передачу, если каталог за это время успел создать кто-то другой.
- **Отрисовка дерева стала дешевле** — снимок настроек и язык сообщений кэшируются и обновляются при изменении конфигурации (раньше они перечитывались на каждую видимую строку, а язык — на *каждый* перевод, так что папка из 500 строк тратила больше десяти тысяч обращений к конфигурации только на отрисовку); ключи предков запоминаются по каждому изменённому источнику; сортировка использует один общий коллятор и сравнивает имена, а не полные пути. Видимый порядок сортировки не изменился — намеренно не использовано наивное сравнение `<`/`>`, которое опускает все кириллические имена ниже всех латинских.
- **Удалена неиспользуемая зависимость `async`.**

---

## 2.8.0 — Upload Modified, clearer status colours, 🔒 read hint, listing completeness · Выгрузка изменённых, понятные цвета статуса, метка 🔒, полнота листинга

**English**
- **Upload Modified (from tree)** — a Remote Explorer toolbar button collects the tree's cached Modified (M) files, splits them into writable (normal serial upload) and read-only / root-owned (previewed in a tab, then staged to /tmp and applied via `su cat > dest` after one cached password), with a count-confirm before the normal group overwrites the server.
- **Recheck Modified Files** — right-click a folder (or root) to force a recursive re-listing of the whole subtree, even collapsed parts, so the M badges reflect the current bytes on both sides.
- **Refresh keeps M** — a refresh no longer throws away the confirmed-M state; folded parents keep their yellow, and the tree root now inherits descendant-M correctly.
- **Status colours** — L (local-only) → green, R (remote-only) → blue (a distinct badge, previously undrawn); an in-sync file has no inline Download and struck-through Download/Upload aliases in the menu (still functional). A **🔒** marks a file whose content your login can't read (distinct from RO = can't write); a folder you can't list shows a keyboard-accessible **"List not complete — Show all as root…"** row.
- **su progress** — a spinner shows while a root command runs on the server.
- **Delete a fully-backed-up server folder** without the typed "yes" (recursive size + MD5 check); a local delete goes to the OS trash cross-platform (incl. macOS).
- **Correctness (review rounds):** canonical `remotePath` (a trailing slash or `./` no longer splits the root identity → fixed parent-M, getParent, drag-self-move, Open-by-Path); `_createIgnoreFn` segment boundary (a mirror sync-delete no longer removes an ignored file under a sibling-prefixed path); root batch-upload hardened (0600 staging, `[ -f ] && [ ! -L ]` before `cat`, refuses `/`, always cleans up, aborts on a wrong password); elevated listings carry numeric uid/gid so the read/write hints compute; the local listing survives one child's ENOENT; profile isolation when `profilesAsRoots=false`.

**Русский**
- **Выгрузить изменённые (из дерева)** — кнопка на панели Remote Explorer собирает изменённые (M) файлы из кэша дерева, делит на записываемые (обычная серийная выгрузка) и только-чтение / root-овые (превью во вкладке, затем staging во /tmp и применение через `su cat > dest` по одному кэшированному паролю), со счётчиком-подтверждением перед перезаписью сервера обычной группой.
- **Перечитать изменённые файлы** — ПКМ по папке (или корню) форсирует рекурсивный пере-листинг всего поддерева, даже свёрнутых частей, чтобы метки M отражали текущие байты с обеих сторон.
- **Refresh сохраняет M** — обновление больше не выбрасывает подтверждённое M-состояние; свёрнутые родители держат жёлтое, и корень дерева теперь корректно наследует M изнутри.
- **Цвета статуса** — L (только локально) → зелёный, R (только на сервере) → синий (отдельная метка, раньше не рисовалась); синхронный файл без inline-Download и с зачёркнутыми Download/Upload в меню (рабочими). **🔒** помечает файл, содержимое которого ваш логин не может прочитать (в отличие от RO = нельзя писать); папка, которую нельзя листить, показывает клавиатурно-доступную строку **«Список неполный — Показать всё от root…»**.
- **Индикатор su** — крутилка при выполнении root-команды на сервере.
- **Удаление полностью забэкапленной серверной папки** без ввода «yes» (рекурсивная проверка размер + MD5); локальное удаление — в корзину ОС кросс-платформенно (вкл. macOS).
- **Корректность (раунды ревью):** canonical `remotePath` (слэш в конце или `./` больше не расщепляют идентичность корня → починены метка M на родителях, getParent, drag-само-в-себя, «Открыть по пути»); `_createIgnoreFn` граница сегмента (зеркальная синхронизация-удаление больше не стирает игнорируемый файл на пути-соседе); batch-загрузка от root закалена (staging 0600, `[ -f ] && [ ! -L ]` перед `cat`, отказ для `/`, всегда чистит, прерывание на неверном пароле); листинги «от root» несут числовые uid/gid; локальный листинг переживает ENOENT одного ребёнка; изоляция профилей при `profilesAsRoots=false`.

## 2.7.7 — Content-accurate M status, root-access uploads & downloads, permission backfill · Статус M по содержимому, загрузка/скачивание от root, дозапись прав

**English:**

The consolidation release that makes the 2.7.0 unified tree production-solid and adds the missing halves of root access. Since 2.7.0 was itself unstable, the interim fixes are folded in here.

- **Modified (M) now reflects content, not just timestamp.** For two same-size regular files whose modification times differ, WireFerry no longer shows `M` on the time alone — it verifies the bytes with **MD5 in the background** and marks `M` only when the content really differs. A matching file is shown as in-sync, and its local modification time is aligned to the server's so later listings don't re-hash it; that mtime touch is **suppressed from auto-upload** so it can't cause a spurious `uploadOnSave`. When server-side MD5 is unavailable (e.g. FTP), modification time stays the fallback.
- **Parent folders inherit `M`.** A folder now shows an `M` badge when any file inside it differs from the server, so an un-uploaded change is visible without expanding every folder. The **Size & MD5** report also lists both sides' modification timestamps (millisecond-precise, with the UTC offset).
- **Download / edit a root-owned file you can't read.** When a download or *Edit in Local* is refused for lack of permission, WireFerry offers **Download as root** — it reads the file via `su … head` (up to 10 MB) into your local copy so it opens for editing; saving your edits back uses the existing apply-as-root flow. Root is used because reading is non-destructive.
- **Upload a folder into a write-protected path as root.** Uploading a folder into a directory you can't write (e.g. `/root`) no longer just fails at `MKDIR`. WireFerry offers **Upload as root**: it stages the tree to a temporary path over ordinary SFTP, then moves it into place via `su` (`chown` to root, `cp -aT`, cleanup) — merging into an existing folder and always removing the staging copy. Its exit code is surfaced, and it cleans the staging dir up afterwards (as root when needed).
- **Safe permissions for new files, backfilled into your config.** New files/folders **you create in the tree** default to **644/755** when `filePerm`/`dirPerm` aren't set — an upload instead keeps the local file's mode unless `filePerm` is set (the server umask could otherwise leave a new file world-writable `666` — issue #2). On startup an existing config that predates these options **gets `filePerm: 644` / `dirPerm: 755` written straight in** (surgically, preserving your comments and formatting; array configs and each server handled; a `local`-protocol server skipped). It runs at most once per project and is never re-added if you remove the key, so it can't nag.
- **Unified-tree fixes carried over.** The folder-size `du` no longer retries forever on a **local-only** folder (which flickered the tree and starved other folders of the connection). A **`Config Not Found`** after deleting a tree node is fixed (the tree's root map is rebuilt after a refresh). **Local-only rows** no longer offer server-only actions (Download, Diff, server-side delete) or flash a stray download icon while the server side loads.
- Under the hood: new pure modules — `treeStatus` (content verdict, ancestor walk, safe mtime alignment) and the upload/download-as-root fallbacks — covered by unit tests; the elevation engine is reused throughout, and the root password stays in memory only.

**Русский:**

Консолидирующий релиз, который доводит объединённое дерево из 2.7.0 до боевого состояния и добавляет недостающие половины доступа от root. Поскольку сама 2.7.0 была нестабильной, промежуточные фиксы включены сюда.

- **Статус M теперь отражает содержимое, а не только время.** Для двух обычных файлов одного размера с разным временем изменения WireFerry больше не ставит `M` по одному лишь времени — он сверяет байты через **MD5 в фоне** и помечает `M`, только если содержимое действительно различается. Совпадающий файл показывается как синхронизированный, а его локальное время выравнивается по серверу, чтобы последующие обходы его не перехешировали; это касание mtime **исключается из авто-выгрузки**, поэтому не вызывает ложный `uploadOnSave`. Когда серверный MD5 недоступен (например, на FTP), время изменения остаётся запасным вариантом.
- **Папки-предки наследуют `M`.** Папка теперь показывает бейдж `M`, если любой файл внутри неё отличается от сервера, — невыгруженное изменение видно без разворачивания каждой папки. Отчёт **Размер и MD5** также показывает время изменения обеих сторон (с точностью до миллисекунд и смещением UTC).
- **Скачать / править root-овый файл, который вы не можете прочитать.** Когда скачивание или *Edit in Local* отклонено из-за прав, WireFerry предлагает **Скачать от root** — читает файл через `su … head` (до 10 МБ) в вашу локальную копию, чтобы он открылся на редактирование; сохранение правок назад идёт через существующий «применить от root». Используется root, потому что чтение неразрушительно.
- **Загрузить папку в путь без прав записи от root.** Выгрузка папки в каталог, куда нельзя писать (например `/root`), больше не падает просто на `MKDIR`. WireFerry предлагает **Загрузить от root**: стейджит дерево во временный путь обычным SFTP, затем переносит на место через `su` (`chown` в root, `cp -aT`, очистка) — с мержем в существующую папку и обязательным удалением промежуточной копии. Код возврата пробрасывается, а временный каталог чистится после (от root, если нужно).
- **Безопасные права для новых файлов, дописанные в конфиг.** Новые файлы/папки, **созданные в дереве**, по умолчанию **644/755**, когда `filePerm`/`dirPerm` не заданы — выгрузка вместо этого сохраняет режим локального файла, если `filePerm` не задан (иначе umask сервера мог оставить новый файл world-writable `666` — issue #2). При старте существующему конфигу, созданному до этих опций, **дописываются `filePerm: 644` / `dirPerm: 755`** (хирургически, с сохранением ваших комментариев и форматирования; массив конфигов и каждый сервер обрабатываются; сервер с протоколом `local` пропускается). Срабатывает не более одного раза на проект и не добавляется повторно, если удалить ключ, — не навязывается.
- **Фиксы объединённого дерева.** Серверный `du` больше не повторяется бесконечно на **локальной-только** папке (из-за чего дерево дёргалось, а другие папки голодали по соединению). Исправлен **`Config Not Found`** после удаления узла в дереве (карта корней дерева перестраивается после Refresh). **Локальные-только строки** больше не предлагают серверные действия (Скачать, Diff, удаление на сервере) и не мигают лишней иконкой скачивания, пока грузится серверная сторона.
- Под капотом: новые чистые модули — `treeStatus` (вердикт по содержимому, обход предков, безопасное выравнивание mtime) и фоллбэки загрузки/скачивания от root — покрыты юнит-тестами; движок повышения прав переиспользуется, пароль root хранится только в памяти.

## 2.7.0 — Unified local + server tree, configurable new-file permissions, browse root-owned paths · Объединённое дерево, права новых файлов, доступ к root-путям

**English:**

- **The server tree is now a unified local + server view.** Each entry is one row aware of both sides, with a status badge/colour that tells them apart at a glance: **L** (dimmed) = the file exists only on your disk and hasn't been uploaded; **M** = it exists on both sides but differs (by size or modified time); no badge = in sync, or a plain server file; **!** = a type clash (a file on one side, a folder on the other); **?** = the server state couldn't be read. Sizes show on both sides — an **M** file shows `server ↔ local`.
- **Local-first rendering.** Local files paint instantly and the server side is fetched in the background (with a status-bar spinner), so a slow server never blocks the tree. **Refresh** re-reads both sides.
- **A click opens your local copy** when the file exists locally (instant, nothing downloaded); a server-only file still downloads/previews as before. Use **Diff** / **Download** from the menu to compare or pull the server version.
- **Configurable permissions for newly-created files.** `filePerm` / `dirPerm` now apply to **New File / New Folder** in the tree, not only to uploads, via an explicit `chmod` (so the result is exact regardless of the server umask — the old default left them at `0o666`). A brand-new config seeds `"filePerm": 644` and `"dirPerm": 755`. Values are parsed strictly as octal, so a typo like `888` or `"0o644"` is skipped rather than applied as a garbage mode.
- **Browse and read root-owned paths.** A directory you have no permission to list (e.g. `/root`) is now marked **yellow** with a "no access — right-click" hint instead of showing empty. Right-click → **View / list as root** and enter the **owner's or root's** password: WireFerry lists it via `su … find` (or, for a file you can't read, opens it read-only via `su … head`). It reuses the same in-memory root-password mechanism as the write path — nothing is written to disk or logs. **Deleting** a root-owned file or folder you can't remove now offers **Delete as root** too — with an explicit confirmation every time (a delete is destructive, so it asks even when the password is already cached) — running `rm -rf` on the server via `su`.
- Under the hood: the elevation engine can now `su` to an arbitrary owner, not only root; new-file permission parsing is shared and strict; and this release folds in a round of external code-review fixes to the unified tree (case-insensitive local matching on Windows/macOS, the ignore filter applied to the local side, a listing-generation guard against stale post-refresh writes, symlink click routing, and type-aware status).

**Русский:**

- **Дерево сервера теперь объединяет локальную и серверную стороны.** Каждый элемент — одна строка, знающая про обе стороны, со статусом (бейдж/цвет), чтобы их сразу различать: **L** (приглушённый) — файл есть только на вашем диске и ещё не выгружен; **M** — есть с обеих сторон, но отличается (по размеру или времени изменения); без бейджа — синхронизирован либо обычный серверный файл; **!** — конфликт типов (с одной стороны файл, с другой папка); **?** — состояние на сервере не удалось прочитать. Размеры видны с обеих сторон — у **M**-файла показывается `сервер ↔ локально`.
- **Local-first рендер.** Локальные файлы отрисовываются мгновенно, а серверная часть подтягивается в фоне (со спиннером в статус-баре), поэтому медленный сервер не блокирует дерево. **Обновить** перечитывает обе стороны.
- **Клик открывает вашу локальную копию**, если файл есть локально (мгновенно, ничего не качается); файл только на сервере по-прежнему скачивается/показывается как раньше. Для сравнения или получения серверной версии — **Diff** / **Скачать** из меню.
- **Настраиваемые права для создаваемых файлов.** `filePerm` / `dirPerm` теперь применяются к **New File / New Folder** в дереве, а не только при выгрузке, через явный `chmod` (результат точный независимо от umask сервера — раньше оставалось `0o666`). Свежий конфиг сразу с `"filePerm": 644` и `"dirPerm": 755`. Значения читаются строго как восьмеричные, так что опечатка вроде `888` или `"0o644"` пропускается, а не применяется как мусорный режим.
- **Просмотр и чтение root-овых путей.** Каталог, который вы не можете листать (например `/root`), теперь подсвечивается **жёлтым** с подсказкой «нет доступа — ПКМ», а не показывается пустым. ПКМ → **Показать / открыть от root**, введите пароль **владельца или root**: WireFerry покажет содержимое через `su … find` (а для нечитаемого файла — откроет только на чтение через `su … head`). Используется тот же механизм пароля root в памяти, что и при записи — ничего не пишется на диск и в логи. **Удаление** root-owned файла или папки, которые вы не можете удалить, теперь тоже предлагает **«Удалить от root»** — с обязательным подтверждением каждый раз (удаление разрушительно, поэтому спрашивает, даже если пароль уже сохранён) — выполняется `rm -rf` на сервере через `su`.
- Под капотом: движок повышения прав теперь умеет `su` к произвольному владельцу, не только к root; разбор прав новых файлов вынесен и строг; и в этот релиз вошёл раунд внешнего код-ревью по объединённому дереву (регистронезависимое сопоставление на Windows/macOS, фильтр `ignore` на локальной стороне, generation-guard против устаревшей записи после Refresh, маршрутизация клика по симлинкам, статусы с учётом типа).

---

## 2.6.6 — WireFerry commands grouped in the right-click menus · Команды WireFerry сгруппированы в контекстных меню

**English:**

- **The right-click menus are reorganized so WireFerry's commands are easy to tell apart from VS Code's built-ins.** Before, they were interleaved with the native items and hard to spot.
- **Local Explorer:** the everyday transfer commands — **Sync Local → Remote / Remote → Local / Both**, **Upload** and **Download** — stay at the top level, one click away. The utility commands — **Config**, **Reveal in Remote Explorer**, **Show Tree**, **Size & MD5**, **Diff with Remote** and **Delete (server / local / both)** — now live under a single **WireFerry ▸** submenu.
- **Editor tab (right-click the tab):** **Reveal in Remote Explorer** and **Delete (server / local / both)** are gathered under the same **WireFerry ▸** submenu instead of being scattered across the native groups.
- **Editor body (right-click the text):** all WireFerry actions — Upload, Upload to All Profiles, Download, Diff with Remote and Edit in Local — now sit together in one contiguous block.
- **"Copy Path (Git Bash)" stays in the native copy cluster**, right next to Copy Path / Copy Relative Path, since it's a copy-path variant.
- Menu-only change: no command was renamed or removed, and every command stays reachable exactly where it applied before (including from the Command Palette).

**Русский:**

- **Контекстные меню перестроены так, чтобы команды WireFerry было легко отличить от встроенных в VS Code.** Раньше они шли вперемешку с нативными пунктами, и найти «свои» было тяжело.
- **Локальный проводник:** повседневные команды передачи — **Синхронизация Local → Remote / Remote → Local / В обе стороны**, **Выгрузка** и **Скачивание** — остались на верхнем уровне, в один клик. Служебные команды — **Config**, **Показать в Remote Explorer**, **Показать дерево**, **Размер и MD5**, **Diff с сервером** и **Удаление (сервер / локально / оба)** — теперь собраны в одно подменю **WireFerry ▸**.
- **Вкладка редактора (ПКМ по вкладке):** **Показать в Remote Explorer** и **Удаление (сервер / локально / оба)** собраны в то же подменю **WireFerry ▸**, а не разбросаны по нативным группам.
- **Тело редактора (ПКМ по тексту):** все команды WireFerry — Выгрузка, Выгрузка во все профили, Скачивание, Diff с сервером и Edit in Local — идут одним смежным блоком.
- **«Копировать путь (Git Bash)» остался в нативном copy-кластере**, прямо рядом с Copy Path / Copy Relative Path, потому что это вариант копирования пути.
- Изменение только в меню: ни одна команда не переименована и не удалена, каждая по-прежнему доступна там же, где применялась раньше (в т.ч. из палитры команд).

---

## 2.6.5 — Drag & drop move resolves name clashes instead of erroring · Перемещение drag & drop разбирает конфликт имён вместо ошибки

**English:**

- **A drag & drop move now handles a name clash instead of failing.** Dropping a file/folder onto a folder that already held a same-named entry used to abort with a raw `Remote target already exists` error dumped to the log. WireFerry now compares both items and asks what to do.
- **Identical files are de-duplicated silently.** When the destination already holds byte-identical content — verified by server-side MD5 after a size pre-check — the move collapses to removing the source duplicate, with a short notice and no prompt.
- **Different content opens a clear dialog.** It shows the size, permissions, owner and MD5 of both the existing target and the incoming item, with four choices: **Overwrite**, **Rename**, **Do nothing** (skip this item) and **Cancel** (stop the whole move). Overwriting a folder asks a second time before the recursive delete.
- **Rename retries safely.** Picking Rename suggests `name (2).ext` and re-checks the new name for its own clash, looping until it's free or you back out.
- Moves now run one at a time, so the conflict dialogs never overlap.

**Русский:**

- **Перемещение drag & drop теперь разбирает конфликт имён, а не падает.** Раньше, если бросить файл/папку в папку, где уже есть объект с таким именем, операция обрывалась сырой ошибкой `Remote target already exists` в логе. Теперь WireFerry сравнивает оба объекта и спрашивает, что делать.
- **Идентичные файлы — тихий дедуп.** Если в целевой папке уже лежит побайтово идентичная копия (проверка серверным MD5 после сверки размера), перемещение сводится к удалению исходного дубликата — с коротким уведомлением и без вопросов.
- **Разное содержимое — понятный диалог.** Показываются размер, права, владелец и MD5 обоих объектов (существующего и перемещаемого) и четыре варианта: **Перезаписать**, **Переименовать**, **Ничего не делать** (пропустить этот объект) и **Отмена** (прервать всё перемещение). Перезапись папки дополнительно переспрашивает перед рекурсивным удалением.
- **Переименование — с повторной проверкой.** Вариант «Переименовать» предлагает имя `name (2).ext` и заново проверяет его на конфликт, повторяя, пока имя не освободится или вы не откажетесь.
- Перемещения идут по одному, чтобы диалоги конфликтов не накладывались.

---

## 2.6.4 — Marketplace updates, no GitHub updater · Обновления через Marketplace без GitHub-updater

**English:**

- **Marketplace publication succeeded.** Version 2.6.4 passed Visual Studio Marketplace validation and is published as `EvgeniiShapovalov.wireferry`.
- **Marketplace is now the update path.** The startup GitHub release checker has been removed: no consent prompt, no `api.github.com` request and no downloaded `.vsix` left next to the workspace config.
- **The manual update command delegates to VS Code.** **WireFerry: Check for Updates** now asks VS Code to refresh Marketplace extension updates and opens the WireFerry extension page. If VS Code finds an update, the normal Extensions view shows the update action.
- **Old settings stay harmless.** `wireferry.checkForUpdates` is kept as a deprecated no-op so existing user settings remain valid instead of being reported as unsupported.
- **Install docs now match the distribution channel.** README, INSTALL, FAQ and command/configuration references use the Visual Studio Code Marketplace as the primary install/update channel, while GitHub Releases remain documented for manual, offline or rollback installs.

**Русский:**

- **Публикация в Marketplace прошла успешно.** Версия 2.6.4 прошла проверку Visual Studio Marketplace и опубликована как `EvgeniiShapovalov.wireferry`.
- **Основной путь обновления теперь Marketplace.** Стартовая проверка GitHub Releases удалена: больше нет запроса согласия, запроса к `api.github.com` и скачанного `.vsix` рядом с конфигом workspace.
- **Ручная команда передаёт работу VS Code.** **WireFerry: Check for Updates / Проверить обновления** теперь просит VS Code обновить сведения об обновлениях из Marketplace и открывает страницу WireFerry. Если VS Code найдёт новую версию, обычный раздел Extensions покажет действие обновления.
- **Старые настройки не ломаются.** `wireferry.checkForUpdates` оставлена как устаревшая no-op настройка, чтобы существующие пользовательские настройки оставались валидными и не считались неподдерживаемыми.
- **Документация соответствует каналу распространения.** README, INSTALL, FAQ и справочники команд/конфигурации теперь указывают Visual Studio Code Marketplace как основной канал установки и обновлений; GitHub Releases остаются для ручной, offline-установки или отката.

---

## 2.6.3 — Concurrency honoured globally + reliability fixes · Глобальный лимит параллельности + фиксы надёжности

**English:**

- 🐛 **`concurrency` is now a global limit.** Every transfer used to build its own scheduler, so N simultaneous operations — a watcher touching N files, "Upload Changed Files" over N git changes, or two folder uploads — could open up to N × `concurrency` parallel transfers, enough to trip sshd `MaxSessions`/`MaxStartups`, exhaust file descriptors, or get the IP banned on shared hosting. Each service now shares one bounded scheduler, and "Upload Changed Files" processes its changes one at a time.
- 🐛 **Profile options deep-merge.** A profile that overrode one sub-key of `watcher`, `syncOption` or `remoteExplorer` replaced the whole object, silently dropping the base's other sub-keys (a `syncOption.delete`-only profile wiped `skipCreate`/`ignoreExisting`/`update`; a `remoteExplorer.filesExclude`-only profile wiped `order`, later read as `NaN` by the tree sort). These nested objects now merge one level deep.
- 🐛 **Deleting an unsupported remote type is reported honestly.** Deleting a special file (socket, device, fifo) logged a warning but left the delete a no-op, while the report and tree still said "deleted". It now fails with a clear message and the tree isn't refreshed as if the file were gone.
- 🐛 **Windows `~\` home paths expand.** A `privateKeyPath` or `sshConfigPath` written with a backslash home prefix (`~\.ssh\id_rsa`) was passed through verbatim; `~\` now expands like `~/`.
- 🔧 **The "can't set modified time" warning is per connection.** It was gated by a session-global flag, so a second server with the same restriction never surfaced it; it now warns once per connection.

**Русский:**

- 🐛 **`concurrency` теперь глобальный лимит.** Раньше каждая передача создавала свой планировщик, и N одновременных операций — watcher на N файлов, «Выгрузить изменённые файлы» по N git-изменениям или две выгрузки папок — могли открыть до N × `concurrency` параллельных передач, достаточно, чтобы упереться в sshd `MaxSessions`/`MaxStartups`, исчерпать дескрипторы файлов или поймать IP-бан на shared-хостинге. Теперь у каждого сервиса один общий ограниченный планировщик, а «Выгрузить изменённые файлы» обрабатывает изменения по одному.
- 🐛 **Опции профиля объединяются вглубь.** Профиль, переопределявший один под-ключ `watcher`, `syncOption` или `remoteExplorer`, заменял объект целиком, молча теряя остальные под-ключи базы (профиль только с `syncOption.delete` ронял `skipCreate`/`ignoreExisting`/`update`; только с `remoteExplorer.filesExclude` — ронял `order`, который сортировка дерева затем читала как `NaN`). Теперь эти вложенные объекты сливаются на один уровень.
- 🐛 **Удаление неподдерживаемого типа сообщается честно.** Удаление специального файла (сокет, устройство, fifo) писало предупреждение, но операция оставалась пустой, а отчёт и дерево показывали «удалено». Теперь это падает с понятным сообщением, и дерево не обновляется, будто файл исчез.
- 🐛 **Пути `~\` (Windows) разворачиваются.** `privateKeyPath` или `sshConfigPath` с обратным слэшем (`~\.ssh\id_rsa`) передавался как есть; теперь `~\` разворачивается так же, как `~/`.
- 🔧 **Предупреждение «не удалось выставить время файла» — по подключению.** Оно было привязано к session-global флагу, поэтому второй сервер с той же проблемой его не показывал; теперь предупреждает один раз на подключение.

---

## 2.6.2 — Code-review reliability fixes + documentation and schema alignment · Надёжность по итогам ревью + выравнивание документации и схемы

**English:**

- 🐛 **A failed local delete is no longer silent.** When "Delete (server / local / both)" or "All servers + computer" removes the server copy but the local file can't be trashed *or* permanently deleted (a read-only or ACL-locked file), WireFerry now shows a warning naming the file left on disk, instead of reporting "deleted" while it remains.
- 🐛 **`chmod -R` refreshes the whole subtree.** A recursive permission change repainted only the clicked folder, leaving nested files with stale read-only badges until a manual refresh; it now re-reads the subtree so the decorations reset.
- 📚 **README lists the shipped feature set.** Key features gained capabilities that previously lived only in the changelog: drag & drop in the Remote Explorer, operation report tabs, byte progress + cancel, symlink handling, atomic transfers, applying local delete/rename to the server, `downloadOnOpen`, profiles-as-roots + per-profile upload-on-save + delete-all, open-by-path, the legacy migration doctor, the GitHub update check, legacy SSH key exchange and Copy Path (Git Bash); plus a keyboard-interactive/2FA bullet. `docs/commands.md` documents drag & drop and the operation-report tabs.
- 🔧 **Schema matches the code.** The FTP schema now exposes `secure`/`secureOptions` (FTPS) instead of SSH-only fields; `useTempFile` defaults to `true`, `syncOption.*` defaults to `false` (off unless set) and the misleading `ignoreFile: ".gitignore"` default is gone — VS Code hovers and autocomplete no longer contradict the runtime. `docs/configuration.md` warns about the `useTempFile: false` data-loss window and `docs/commands.md` documents how the root password is handled.
- 🧹 **Doc consistency.** `CONTRIBUTING.md` now leads with English (matching its own policy) and uses `npm ci`.

**Русский:**

- 🐛 **Неудачное локальное удаление больше не молчит.** Когда «Удалить (сервер / локально / оба)» или «Все серверы + ПК» удаляет копию на сервере, но локальный файл не удаётся отправить в Корзину *и* безвозвратно удалить (read-only или заблокированный ACL), WireFerry показывает предупреждение с именем оставшегося на диске файла, а не сообщает «удалено».
- 🐛 **`chmod -R` обновляет всё поддерево.** Рекурсивная смена прав перерисовывала только выбранную папку, у вложенных файлов оставалась устаревшая пометка «только чтение» до ручного обновления; теперь поддерево перечитывается и пометки сбрасываются.
- 📚 **README перечисляет реальный набор возможностей.** В «Основные возможности» добавлены фичи, которые раньше жили только в changelog: drag & drop в Remote Explorer, вкладки отчётов операций, прогресс по байтам с отменой, работа с симлинками, атомарные передачи, применение локальных delete/rename на сервере, `downloadOnOpen`, профили-как-корни + per-profile upload-on-save + удаление со всех, открытие по пути, доктор миграции legacy, проверка обновлений на GitHub, устаревший обмен ключами SSH и Copy Path (Git Bash); плюс пункт про keyboard-interactive/2FA. В `docs/commands.md` описаны drag & drop и вкладки отчётов.
- 🔧 **Схема соответствует коду.** FTP-схема теперь показывает `secure`/`secureOptions` (FTPS) вместо SSH-полей; дефолт `useTempFile` — `true`, дефолты `syncOption.*` — `false` (выключено, пока не задано), убран вводящий в заблуждение дефолт `ignoreFile: ".gitignore"` — подсказки и автодополнение VS Code больше не противоречат рантайму. В `docs/configuration.md` — предупреждение о потере данных при `useTempFile: false`, в `docs/commands.md` — как обрабатывается пароль root.
- 🧹 **Консистентность документации.** `CONTRIBUTING.md` теперь начинается с английского раздела (по своей же политике) и использует `npm ci`.

---

## 2.6.1 — Show Tree: draw a folder tree from the right-click menu · «Показать дерево»: дерево папки из контекстного меню

**English:**

- ✨ **Draw a folder tree from the right-click menu.** A new **"Show Tree"** command on a folder — in the Remote Explorer (a server folder or root) or the local Explorer — renders a classic ASCII tree (├─ └─ │) into a text tab. It first asks what to draw (folders only, with files, or with files and sizes) and a maximum depth (empty or `0` = no limit). The server side is walked over the active connection; a local folder is read directly. In the sizes mode a file shows its own size and a folder shows the accumulated size of what was walked.
- 🔎 **Built for large trees.** The walk shows a progress indicator with a Cancel button and stops cleanly at 20000 entries, marking the output truncated, so a runaway `node_modules` or a huge server directory can't hang the report. An unreadable subdirectory is skipped rather than aborting the whole tree.
- 📚 **Refreshed and expanded documentation.** The README, the command and configuration references and the FAQ were reworked, each with a full standalone Russian version, with clearer install steps and more of the feature set covered.

**Русский:**

- ✨ **Дерево папки из контекстного меню.** Новая команда **«Показать дерево»** на папке — в Remote Explorer (папка или корень сервера) либо в локальном проводнике — рисует классическое ASCII-дерево (├─ └─ │) в текстовой вкладке. Сначала спрашивает, что рисовать (только папки, с файлами или с файлами и размерами) и максимальную глубину (пусто или `0` = без ограничения). Сервер обходится по активному соединению, локальная папка читается напрямую. В режиме с размерами у файла показан свой размер, у папки — суммарный размер обойдённого.
- 🔎 **Рассчитано на большие деревья.** Обход показывает индикатор прогресса с кнопкой отмены и аккуратно обрывается на 20000 записях с пометкой, чтобы разросшийся `node_modules` или огромный серверный каталог не подвесили отчёт. Нечитаемый подкаталог пропускается, а не рушит всё дерево.
- 📚 **Обновлённая и расширенная документация.** README, справочники команд и конфигурации и FAQ переработаны — у каждого есть полноценная самостоятельная русская версия, с более понятными шагами установки и полнее раскрытым набором возможностей.

---

## 2.6.0 — Edit root-owned files via su, owner/group + read-only hints in the tree · Правка root-файлов через su, владелец/группа и пометки «только чтение» в дереве

**English:**

- ✨ **Apply an edited file as root.** When an upload is denied for lack of permission, the recovery dialog gains an **"Apply as root now"** button (SSH only). WireFerry stages your edited copy to a writable path over SFTP, then runs `cat staged > target` as root over an SSH PTY using `su -`, prompting for the root password. The `cat >` keeps the target's existing owner and mode — exactly right for editing a root-owned nginx/php config in your local editor and applying it in place. The pasteable command stays available as a fallback.
- ✨ **Change owner/group as root.** A new **"Change Owner / Group (chown)"** command in the server tree runs `chown [-R] owner:group` as root via `su -` (owner-only and `:group`-only are accepted). And when a plain SFTP `chmod` is denied on a root-owned file, WireFerry offers to retry it as root — setuid/setgid/sticky bits are preserved.
- ✨ **Owner and group in the hover tooltip.** The Remote Explorer tooltip now shows a file's owner and group. Names come free from the directory listing (the server's `ls -l` line); a server that only reports numbers falls back to the numeric uid/gid.
- ✨ **Files you can't write are dimmed.** WireFerry reads your identity once per connection (`id`) and works out, per file, whether you can write it. A file you can't edit is dimmed with a small **"RO"** badge — the same native mechanism VS Code uses for git colors — and the tooltip explains why (e.g. "read-only — not the owner and not in group `www-data`"). No more discovering a file is read-only only when the save fails.
- 🔒 **The root password never touches disk or logs.** It is kept in memory only for the window, keyed to the connection's real host:port (so two servers behind the same hostname can't share it), fed to `su` over the PTY only, and stripped out of any command output before it can reach the UI or the log. `su` runs under `LC_ALL=C` with a POSIX shell so the prompt, errors and exit code are read reliably.
- 🔎 **Hardened over three rounds of external code review** before release (command-injection audit, password-handling, prompt/exit-code parsing, decoration lifecycle).

**Русский:**

- ✨ **Применить изменённый файл от root.** Когда выгрузка отклонена из-за отсутствия прав, в окне восстановления появляется кнопка **«Применить от root сейчас»** (только для SSH). WireFerry сохраняет вашу изменённую копию в доступный для записи путь по SFTP, а затем выполняет `cat staged > target` от root по SSH-PTY через `su -`, запросив пароль root. `cat >` сохраняет владельца и права цели — ровно то, что нужно для правки root-ового конфига nginx/php в локальном редакторе и применения на месте. Готовая команда для копирования остаётся как запасной вариант.
- ✨ **Сменить владельца/группу от root.** Новая команда **«Сменить владельца / группу (chown)»** в дереве сервера выполняет `chown [-R] владелец:группа` от root через `su -` (допускаются только владелец и только `:группа`). А если обычный SFTP-`chmod` отклонён на root-овом файле, WireFerry предложит повторить его от root — спец-биты setuid/setgid/sticky сохраняются.
- ✨ **Владелец и группа в подсказке при наведении.** Подсказка в Remote Explorer теперь показывает владельца и группу файла. Имена берутся бесплатно из листинга каталога (строка `ls -l` сервера); если сервер отдаёт только числа — фоллбэк на числовые uid/gid.
- ✨ **Файлы без прав на запись — приглушены.** WireFerry один раз за соединение читает вашу личность (`id`) и по каждому файлу вычисляет, можете ли вы в него писать. Файл, который нельзя редактировать, приглушается серым с маленьким бейджем **«RO»** — тем же нативным механизмом, что VS Code использует для цветов git — а подсказка объясняет причину (например, «только чтение — не владелец и не в группе `www-data`»). Больше не нужно узнавать о «только чтение» лишь в момент неудачного сохранения.
- 🔒 **Пароль root не попадает ни на диск, ни в логи.** Он хранится в памяти только на время окна, привязан к реальному host:port соединения (два сервера за одним именем хоста не разделят его), подаётся `su` только через PTY и вырезается из любого вывода команды до того, как попадёт в UI или лог. `su` запускается под `LC_ALL=C` с POSIX-оболочкой, чтобы приглашение, ошибки и код возврата читались надёжно.
- 🔎 **Упрочнено тремя раундами внешнего код-ревью** перед релизом (аудит command-injection, обращение с паролем, разбор prompt/кода возврата, жизненный цикл декораций).

---

## 2.5.7 — Save an edited copy elsewhere when a write is denied + two review fixes · Сохранить изменённую копию в другое место при отказе в записи + два фикса по ревью

**English:**

- ✨ **Save the edited copy where you can write, then apply it as root.** When an upload is rejected for lack of permission (SFTP "permission denied"), WireFerry no longer just reports the error. It shows a prompt — defaulting to `/tmp/<name>` — asking where on the server to put your edited copy, then streams your local file straight to that path over the same connection. A follow-up dialog hands you one pasteable command to apply it and clean up: `cat '/tmp/file' > '/etc/nginx/.../file' && rm -fv '/tmp/file'`, with **"Copy command"** and **"Copy path"** buttons (paths are shell-quoted, so spaces and special characters survive). This is the everyday workflow for editing root-owned configs (nginx, php) in your local editor and applying them as root. The prompt also shows the target's current mode (e.g. `644`) so the reason for the rejection is obvious. Only one dialog appears at a time, so a bulk upload of many root-owned files can't bury you in modals. SFTP only — the apply command is meaningless on a pure-FTP server, so FTP keeps the plain error.
- 🛠️ **The `local` protocol validates again without host/username.** `host` and `username` were required for every protocol, so a `"protocol": "local"` config (local filesystem only, no credentials) failed validation outright. They are now required only for the remote protocols (sftp/ftp, and an absent protocol, which defaults to sftp).
- 🔒 **Closed an SFTP channel leak on a timed-out subsystem request.** When opening the SFTP subsystem timed out and the server's response arrived afterwards anyway, the now-orphaned channel was never closed — leaking one of the connection's small pool of channels on flaky links. It is now closed.

**Русский:**

- ✨ **Сохранить изменённую копию туда, где есть права, и применить от root.** Когда выгрузка отклонена из-за отсутствия прав (SFTP «permission denied»), WireFerry больше не ограничивается ошибкой. Он показывает поле ввода — по умолчанию `/tmp/<имя>` — с вопросом, куда на сервере положить вашу изменённую копию, и стримит локальный файл прямо в этот путь по тому же соединению. Следом окно выдаёт одну готовую команду, чтобы применить копию и убрать за собой: `cat '/tmp/файл' > '/etc/nginx/.../файл' && rm -fv '/tmp/файл'`, с кнопками **«Копировать команду»** и **«Копировать путь»** (пути экранированы для shell — пробелы и спецсимволы не ломаются). Это повседневный сценарий правки root-овых конфигов (nginx, php) в локальном редакторе и применения их рутом. В подсказке показаны текущие права цели (например, `644`), чтобы причина отказа была понятна. Одновременно открывается только одно окно — массовая выгрузка кучи root-овых файлов не завалит вас модалками. Только для SFTP — на чистом FTP-сервере команда применения бессмысленна, поэтому для FTP остаётся обычная ошибка.
- 🛠️ **Протокол `local` снова проходит валидацию без host/username.** `host` и `username` требовались для всех протоколов, поэтому конфиг `"protocol": "local"` (только локальная ФС, без учётных данных) падал на валидации. Теперь они обязательны только для удалённых протоколов (sftp/ftp и отсутствующий protocol, который по умолчанию sftp).
- 🔒 **Закрыта утечка SFTP-канала при таймауте запроса подсистемы.** Когда открытие подсистемы SFTP истекало по таймауту, а ответ сервера всё-таки приходил позже, осиротевший канал никогда не закрывался — на нестабильной связи это утекало одним из немногих каналов соединения. Теперь он закрывается.

---

## 2.5.6 — Symlinks in the server tree: clear marking and opening the real target · Симлинки в дереве сервера: понятная пометка и открытие реальной цели

**English:**

- ✨ **A symlink is now obvious in the tree.** A symbolic link in the Remote Explorer is drawn with a dedicated link icon and a dimmed `→ target` description (the target is resolved in the background with a single `readlink` per link — like folder sizes, it never blocks expanding a folder). The hover tooltip names it as a symbolic link and shows where it points. Previously a link was indistinguishable from a regular file, so it was easy to spend minutes wondering why "the file" wouldn't open.
- ✨ **Click a symlink to reach the real file.** A symlink can't be "downloaded" the way a file is — recreating an absolute link on disk is refused for safety (it would plant a link to `/etc/...`), which surfaced as a cryptic `Refusing to create symlink … unsafe target` error followed by a failed open. Now a click instead opens a clear dialog: it states the entry is a symbolic link, shows the path it points to, and offers **"Open Target"** and **"Copy Path"**. "Open Target" follows the link chain (bounded, so a cyclic link can't loop) to the real file, reveals it in the tree and opens it; a broken link or a target outside the configured root is reported plainly. "Open Remote File by Path" routes a typed symlink path through the same flow.
- 🛠️ **Two fixes from an external review pass.** The Rename preflight that checks whether the destination already exists no longer treats *every* `lstat` failure as "destination free" — only a genuine not-found does; a permission/timeout error is surfaced instead of silently proceeding to rename over a possibly-existing target (matching the guard create/delete already use). And the tree refresh after a config save is now guarded, so editing `wireferry.json` can't crash with "cannot read properties of undefined" when the extension's initial setup failed at activation.

**Русский:**

- ✨ **Симлинк теперь сразу виден в дереве.** Символическая ссылка в Remote Explorer рисуется отдельной иконкой-ссылкой и серым описанием `→ цель` (цель подтягивается в фоне одним `readlink` на ссылку — как и размеры папок, это не блокирует раскрытие каталога). В подсказке при наведении написано, что это символическая ссылка и куда она ведёт. Раньше ссылку нельзя было отличить от обычного файла — и легко было потратить минуты, гадая, почему «файл» не открывается.
- ✨ **Клик по симлинку открывает реальный файл.** Симлинк нельзя «скачать», как файл: воссоздание абсолютной ссылки на диске отклоняется ради безопасности (иначе получили бы ссылку на `/etc/...`), и это вылезало непонятной ошибкой `Refusing to create symlink … unsafe target` и затем неудачным открытием. Теперь клик показывает понятное окно: это символическая ссылка, вот её путь, и кнопки **«Открыть цель»** и **«Скопировать путь»**. «Открыть цель» проходит цепочку ссылок (с защитой от зацикливания) до реального файла, показывает его в дереве и открывает; битая ссылка или цель вне настроенного корня — с внятным сообщением. «Открыть файл на сервере по пути» при вводе пути-симлинка идёт тем же маршрутом.
- 🛠️ **Два фикса по итогам внешнего ревью.** Preflight переименования, проверяющий, занята ли цель, больше не считает *любую* ошибку `lstat` за «цель свободна» — только подлинное «не найдено»; ошибка прав/таймаута теперь всплывает, а не приводит молча к переименованию поверх возможно существующего файла (как уже сделано в создании/удалении). И обновление дерева после сохранения конфигурации теперь под guard'ом — правка `wireferry.json` не падает с «cannot read properties of undefined», если первичная инициализация расширения сорвалась при активации.

---

## 2.5.5 — Безопасная валидация конфигурации и документация · Safer config validation & documentation

**Русский:**

- 🔒 **Устранена уязвимая runtime-цепочка в валидаторе.** Прямая зависимость `joi` обновлена с 10.6.0 до 17.13.4; старые транзитивные `hoek` и `topo` удалены. `npm audit --omit=dev` теперь сообщает 0 production-уязвимостей вместо трёх. На Joi 18 проект намеренно не переходит: эта ветка требует Node.js 20, тогда как минимальный VS Code 1.66 работает на Node.js 16.
- 🧪 **Валидация стала изолированной и проверяемой.** Удалён снятый в Joi 17 API `Joi.validate()`: схема компилируется один раз и валидирует через schema instance. Она вынесена из UI-зависимого `config.ts` в pure-модуль, поэтому реальные production-правила проверяются напрямую. Добавлено 13 тестов протоколов, портов, watcher, ignore, passphrase, interactive auth, `uploadOnSave` и sentinel-паролей. Совместимость сохранена: неизвестные legacy-поля разрешены, неявное преобразование типов выключено.
- 📚 **Документация для пользователя переработана.** `README.md` стал основным английским руководством, добавлен самостоятельный `README.RU.md`, а `INSTALL.md` объясняет установку `.vsix`, первый запуск, типичные ошибки и сборку. Везде явно указано не скачивать `Code → Download ZIP` вместо готового релиза. Скриншоты Remote Explorer, мастера и контекстного меню обновлены и получили versioned-имена для сброса кеша GitHub.

**English:**

- 🔒 **Removed the vulnerable runtime validation chain.** The direct `joi` dependency moves from 10.6.0 to 17.13.4, removing the old transitive `hoek` and `topo` packages. `npm audit --omit=dev` now reports 0 production vulnerabilities instead of three. Joi 18 is deliberately not used: that line requires Node.js 20, while the minimum VS Code 1.66 runs on Node.js 16.
- 🧪 **Configuration validation is isolated and directly tested.** The removed Joi 17 API `Joi.validate()` is replaced with a compiled schema instance. The schema moves out of UI-dependent `config.ts` into a pure module, so tests exercise the actual production rules. Thirteen cases cover protocols, port bounds, watcher, ignore, passphrase, interactive auth, `uploadOnSave` and password sentinels. Compatibility remains intact: unknown legacy fields stay allowed and implicit type conversion stays disabled.
- 📚 **User documentation was rebuilt.** `README.md` is now the canonical English guide, with a standalone natural Russian `README.RU.md`; `INSTALL.md` covers VSIX installation, first run, common errors and source builds. It explicitly prevents regular users from choosing `Code → Download ZIP` instead of the packaged release. Remote Explorer, setup and context-menu screenshots are current and use versioned filenames to invalidate GitHub caches.

---

## 2.5.4 — Открыть любой файл на сервере по пути · Open any server file by path

**Русский:**

- ✨ **Чтение где угодно на сервере.** «Открыть файл на сервере по полному пути» (кнопка в панели дерева) больше не отвергает путь вне настроенного `remotePath`. Абсолютный путь выше всех корней теперь открывается: расширение выбирает сервер для соединения, проверяет файл и скачивает его через Edit in Local (показать в дереве нельзя — узел выше корня, поэтому файл просто открывается). Смысл: по своему SSH-аккаунту вы и так читаете всё, что он видит, — запирать предпросмотр корнем смысла не было.
- ✨ **Уведомление-ликбез при записи вне скоупа.** Открытие файла выше корня скачивает его копию на локальный диск (вне папки проекта). **Один раз за сессию** показывается понятное уведомление: какой файл, куда именно на диск легла копия, что это выше вашего скоупа, как называется параметр (`remotePath`), что в нём сейчас — и как его расширить. Без блокирующих вопросов.
- 🔒 **Запись осталась строгой.** Послабление касается только чтения удалённых путей. Локальный → серверный маппинг по-прежнему запрещён выше корня — локальный URI нельзя завернуть на запись вне папки/корня, даже под флагом послабления. Авто-синхронизация, выгрузка и watcher держат границу как раньше. Предпросмотр дополнительно проверяет, что цель — обычный файл (директория больше не читается как «текст-мусор»).

**English:**

- ✨ **Read anywhere on the server.** "Open Remote File by Path" (the tree-panel button) no longer rejects a path outside the configured `remotePath`. An absolute path above every root now opens: the extension picks a server for the connection, checks the file, and downloads it via Edit in Local (it can't be revealed in the tree — the node is above the root — so it just opens). The point: over your SSH account you can already read anything it can, so confining preview to the root added friction without protection.
- ✨ **A plain-language notice for writes outside the scope.** Opening a file above the root downloads a copy to your local disk (outside the project folder). **Once per session** a clear notice explains: which file, where exactly the copy landed, that it's above your scope, the setting's name (`remotePath`), its current value — and how to widen it. No blocking prompts.
- 🔒 **Writes stay strict.** The relaxation covers only reading remote paths. The local → remote mapping is still forbidden above the root — a local URI can't be coaxed into writing outside the folder/root, even under the relaxation flag. Auto-sync, upload and the watcher keep the boundary as before. Preview additionally verifies the target is a regular file (a directory is no longer read as "text" garbage).

---

## 2.5.3 — Атомарные передачи, копирование пути для Git Bash и три раунда ревью · Atomic transfers, Git Bash path copy & three review rounds

**Русский:**

- ✨ **Атомарная выгрузка и скачивание по умолчанию.** Файл больше не пишется поверх существующего напрямую: он сначала уходит в **уникальную** временную копию рядом с целью (`<файл>.wf-…tmp`), затем **атомарно переименовывается** на место. Прерванная передача — сетевой сбой, отмена пользователем, нечитаемый источник — больше не обнуляет и не оставляет «половину» рабочего файла; оригинал цел, пока новая копия не готова целиком. Если в каталог писать нельзя (файл доступен на запись, а папка — нет), включается автоматический фоллбэк на прямую запись. Уникальное имя temp также убирает гонку двух одновременных выгрузок одного файла. Управляется `useTempFile` (по умолчанию теперь `true`; `false` форсит прямую перезапись).
- ✨ **Команда «Копировать путь (Git Bash)»** в контекстном меню локального проводника (рядом с «Copy Path»). Переводит путь в формат Git Bash / MSYS2: `C:\Users\me\proj` → `/c/Users/me/proj`, UNC `\\host\share` → `//host/share`. Поддерживает множественный выбор (по одному пути на строку).
- 🔒 **Безопасность по итогам ревью.** Добавление публичного ключа в `~/.ssh/authorized_keys` теперь идёт **append**, а не перезаписью всего файла — обрыв соединения во время записи больше не обнулит файл и не заблокирует вход. Запись `~/.ssh/config` — атомарная (temp + rename); ошибка чтения, отличная от «нет файла», больше не затирает конфиг пустышкой. Предпросмотр серверного файла защищён от OOM (отказ при неизвестном размере + жёсткий лимит по байтам). Имя релиз-тега санитизируется перед путём `.vsix`. Symlink при переносе с сервера отклоняется, если его цель — абсолютный путь (защита от ссылок на `/etc/passwd`, `~/.ssh/id_rsa`). Пароль не «осиротеет» в хранилище ОС при сбое записи индекса (rollback).
- 🐛 **Надёжность.** Устранена **регрессия относительного `remotePath`**: проверка границ пути ошибочно отклоняла дефолтный `./`, и все операции падали с «Refusing local path…»; теперь относительный корень работает, а защита от `../` сохранена (с юнит-тестом). Планировщик передач не зависает, если обработчик события бросает исключение. Отмена потока не выбрасывает синхронную ошибку вместо штатной остановки. `connectionIdentity` не расщепляет один сервер на два соединения из-за `undefined`-полей. **«Upload Changed Files»** теперь **спрашивает подтверждение** перед удалением файлов на сервере и работает с правильным репозиторием в multi-root. Битый/удалённый `ignoreFile` не валит все операции и не применяется из устаревшего кэша. Профиль без `ignore` в базе больше не роняет конфиг. Файл с именем `__proto__` не выпадает из синхронизации. `concurrency` ограничен сверху. Зависший FTP/локальный поток записи завершается корректно.

**English:**

- ✨ **Atomic upload and download by default.** A file is no longer written over the existing one in place: it is first staged into a **unique** temp copy next to the target (`<file>.wf-…tmp`), then **atomically renamed** into place. An interrupted transfer — a network drop, a user cancel, an unreadable source — no longer blanks or half-overwrites the working file; the original stays intact until the new copy is complete. If the directory isn't writable (the file is writable but its folder isn't), it falls back to a direct write automatically. The unique temp name also removes the race between two concurrent uploads of the same file. Controlled by `useTempFile` (now `true` by default; `false` forces a direct overwrite).
- ✨ **A "Copy Path (Git Bash)" command** in the local Explorer context menu (next to "Copy Path"). It converts the path to Git Bash / MSYS2 form: `C:\Users\me\proj` → `/c/Users/me/proj`, UNC `\\host\share` → `//host/share`. Multi-select is supported (one path per line).
- 🔒 **Security from the review.** Deploying the public key to `~/.ssh/authorized_keys` now uses **append** instead of rewriting the whole file — a dropped connection mid-write can no longer blank the file and lock you out. `~/.ssh/config` is written atomically (temp + rename); a read error other than "missing file" no longer overwrites the config with an empty one. Server-file preview is OOM-guarded (refuse on unknown size + a hard byte cap). The release tag is sanitised before it becomes a `.vsix` path. A symlink transferred from the server is rejected when its target is absolute (guards against links to `/etc/passwd`, `~/.ssh/id_rsa`). A password is no longer orphaned in the OS keychain when the index write fails (rollback).
- 🐛 **Reliability.** Fixed a **relative-`remotePath` regression**: the path-containment check wrongly rejected the default `./`, so every operation failed with "Refusing local path…"; the relative root works now, with the `../` escape guard kept (and a unit test). The transfer scheduler no longer wedges when an event listener throws. Cancelling a stream no longer throws a synchronous error instead of stopping cleanly. `connectionIdentity` no longer splits one server into two connections over `undefined` fields. **"Upload Changed Files"** now **confirms** before deleting files on the server and acts on the correct repository in a multi-root workspace. A broken/deleted `ignoreFile` no longer breaks every operation or lingers from a stale cache. A profile with no `ignore` in the base config no longer crashes config loading. A file named `__proto__` is no longer dropped from sync. `concurrency` is now upper-bounded. A stuck FTP/local write stream now settles correctly.

---

## 2.5.2 — Мастер настройки первого сервера · First-server setup wizard

**Русский:**

- ✨ **Пошаговый мастер вместо правки JSON.** Если в проекте ещё нет конфига (или ни одного сервера), панель WireFerry прячет всю панель инструментов и показывает одну кнопку **«Создать конфигурацию»**. По ней открывается мастер: протокол (SFTP/FTP) → хост/IP → порт → пользователь → путь на сервере → **как хранить пароль**. Три варианта хранения, по умолчанию ключ: **🔑 SSH-ключ** (рекомендуется), **🪟 хранилище ОС (Windows)**, **📄 открытым текстом**.
- ✨ **Проверка соединения до записи конфига.** Мастер сначала реально подключается; конфиг `.vscode/wireferry.json` создаётся **только после успешного входа**, сервер сразу появляется в дереве, панель инструментов возвращается. Если вход не удался — показывается ошибка, конфиг не пишется.
- ✨ **SSH-ключ прямо из мастера (SFTP).** При выборе «Ключ» можно **сгенерировать новый** (вход по паролю один раз → генерация ed25519 → заливка на сервер → проверка входа по ключу → профиль на ключ) или **указать существующий** приватный ключ. Пароль/passphrase при выборе хранилища ОС кладутся в системное хранилище, в конфиг идёт `"secretStorage"`.
- 🐛 **Исправления по результатам код-ревью.** **hop + ключ:** приватные ключи для прыжков и целевого хоста теперь читаются с локальной машины, а не через SFTP предыдущего прыжка (раньше hop с ключом аутентифицировался файлом, взятым с бастиона). **Отмена передачи** надёжна: Cancel в окне между чтением источника и записью больше не усекает и не перезаписывает файл назначения. **Конфиг расширения** определяется по точному пути `.vscode/wireferry.json|sftp.json`, а не по имени файла — посторонний `wireferry.json` в проекте больше не пересобирает активные сервисы. **`defaultProfile`** при нескольких папках проекта не перетирается гонкой. **Размер папки**: серверный `du` обёрнут в таймаут (зависший сервер не вешает отчёт). **FTP:** ошибка входного потока в очереди больше не прерывает чужую передачу; разовый сбой MFMT не отключает простановку времён до конца сессии. **Авто-выгрузка по watcher** последовательная (без «плавающих» промисов). **Мастер** пишет `ignore` (`.vscode`, `.git`, `.DS_Store`) — «Выгрузить проект» не отправит конфиг с паролем на сервер. Слушатели save/open включаются после создания сервисов (первые сохранения после старта не теряются). В лог не попадает TLS-материал (`key`/`pfx`) из `secureOptions`.

**English:**

- ✨ **A step-by-step wizard instead of editing JSON.** When a project has no config yet (or no servers), the WireFerry panel hides the whole toolbar and shows a single **"Create Configuration"** button. It opens a wizard: protocol (SFTP/FTP) → host/IP → port → username → remote path → **how to store the password**. Three storage options, key by default: **🔑 SSH key** (recommended), **🪟 OS keychain (Windows)**, **📄 plaintext**.
- ✨ **Connection verified before the config is written.** The wizard actually connects first; `.vscode/wireferry.json` is created **only after a successful login**, the server appears in the tree at once, and the toolbar comes back. If the login fails the error is shown and no config is written.
- ✨ **An SSH key straight from the wizard (SFTP).** Choosing "Key" lets you **generate a new one** (log in with the password once → generate ed25519 → deploy to the server → verify a key login → switch the profile to the key) or **point at an existing** private key. A password/passphrase for the OS-keychain option is stored in the keychain, with `"secretStorage"` written to the config.
- 🐛 **Code-review fixes.** **hop + key:** private keys for the jumps and the target are now read from the local machine, not through the previous hop's SFTP (a hop+key target used to authenticate with a file pulled off the bastion). **Transfer cancel** is reliable: a Cancel in the window between reading the source and writing no longer truncates/overwrites the destination. **The extension config** is matched by its exact path `.vscode/wireferry.json|sftp.json`, not by filename — a stray `wireferry.json` elsewhere in the project no longer rebuilds the live services. **`defaultProfile`** is no longer clobbered by a startup race across multiple workspace folders. **Folder size:** the server-side `du` is wrapped in a timeout (a stuck server can't hang the report). **FTP:** a queued input-stream error no longer aborts a different transfer; a one-off MFMT failure no longer disables timestamping for the rest of the session. **Watcher auto-upload** runs sequentially (no floating promises). **The wizard** writes an `ignore` (`.vscode`, `.git`, `.DS_Store`) so "Upload Project" can't push the password-bearing config to the server. Save/open listeners start after services are created (the first saves after a cold start aren't lost). TLS material (`key`/`pfx`) from `secureOptions` is no longer printed to the log.

---

## 2.5.0 — Безопасная авторизация: ключи и пароли в системном хранилище · Safe auth: keys and OS-keychain passwords

**Русский:**

- ✨ **«Создать SSH-ключ…» (ПКМ по серверу).** Генерирует пару (ed25519 или rsa-4096, по желанию с passphrase), заливает публичный ключ на сервер в `~/.ssh/authorized_keys` (идемпотентно — без дублей), прописывает `Host`-блок в `~/.ssh/config` и переключает профиль на вход по ключу — **но только после реально проверенного входа этим ключом** (commit-after-verify: если вход не подтвердился, профиль не трогается, ключ-сирота не остаётся). Можно сгенерировать **сразу на все серверы** конфигурации (профили) одной командой. Только SFTP и только локальный extension host (не Remote-SSH/WSL).
- ✨ **«Сохранить пароль в хранилище…» (ПКМ по серверу).** Кладёт пароль в системное хранилище ОС (Windows Credential Manager / macOS Keychain / Linux Secret Service) и ставит серверу `"password": "secretStorage"` — пароль больше не лежит в открытом виде в `.vscode/wireferry.json`. Если у сервера сейчас ключ, команда предложит его убрать, чтобы переход на пароль был чистым (ssh2 предпочитает ключ паролю). Вместе с «Создать SSH-ключ…» это даёт переключение **ключ ↔ пароль одной ПКМ, без правки JSON**.
- ✨ **«Удалить сохранённый пароль…» (ПКМ по серверу).** Список сохранённых паролей/passphrase из хранилища с удалением выбранных (SecretStorage не умеет перечислять свои ключи — ведётся отдельный индекс).
- ✨ **Sentinel-значения для пароля и passphrase.** `"password": "secretStorage"` — брать/сохранять в хранилище; `"password": "prompt"` — спрашивать каждый раз и не сохранять; обычная строка — как раньше (back-compat). Аналогично для `"passphrase"`. Шаблон нового конфига теперь по умолчанию `"password": "prompt"` (а не пустая строка). Untrusted workspace: расширение объявлено там несовместимым (`capabilities.untrustedWorkspaces.supported: false`) плюс runtime-фоллбэк на обычный запрос — секреты из чужого конфига не читаются и не пишутся.
- 🐛 **Multi-hop починен.** Цепочка hop/jump-host строилась в обратном порядке (целевой хост шёл первым) — multi-hop был фактически сломан; теперь прыжки идут как префикс, целевой — последним. Заодно: путь к ключу внутри `hop` раскрывается (`~`/относительный), а введённый пароль hop больше не сохраняется в хранилище под identity целевого сервера.
- 🔒 **Hardening авторизации (по итогам большого внешнего код-ревью).** Секреты не попадают в идентификатор кеша соединений (глубокая рекурсивная очистка, включая `hop` и ответы `interactiveAuth`); удаление пароля из профиля затеняет и **унаследованный** из базового конфига; правка профиля в массиве серверов идёт по полной identity (протокол/хост/порт/пользователь), а не только хост+пользователь; деплой ключа не перезатирает `authorized_keys` при ошибке чтения (fail-closed); запись индекса хранилища сериализована (без потери записей при гонке).

**English:**

- ✨ **"Generate SSH Key…" (right-click a server).** Creates a pair (ed25519 or rsa-4096, optionally with a passphrase), deploys the public key to the server's `~/.ssh/authorized_keys` (idempotent — no duplicates), registers a `Host` block in `~/.ssh/config`, and switches the profile to key auth — **but only after a real login with that key is verified** (commit-after-verify: if the login isn't confirmed the profile is left untouched and no orphan key remains). It can provision **every server** in the config (profiles) in one go. SFTP only, local extension host only (not Remote-SSH/WSL).
- ✨ **"Save Password to Keychain…" (right-click a server).** Stores the password in the OS keychain (Windows Credential Manager / macOS Keychain / Linux Secret Service) and sets `"password": "secretStorage"` for the server — the password no longer sits in plaintext in `.vscode/wireferry.json`. If the server currently uses a key, the command offers to drop it so the switch to a password is clean (ssh2 prefers a key over a password). Together with "Generate SSH Key…" this makes switching **key ↔ password a single right-click, no JSON editing**.
- ✨ **"Delete Saved Password…" (right-click a server).** Lists saved passwords/passphrases from the keychain and removes the selected ones (SecretStorage can't enumerate its keys — a separate index is kept).
- ✨ **Password / passphrase sentinels.** `"password": "secretStorage"` reads/saves via the keychain; `"password": "prompt"` asks every time and never stores; a plain string behaves as before (back-compat). Same for `"passphrase"`. The new-config template now defaults to `"password": "prompt"` (instead of an empty string). Untrusted workspaces: the extension is declared unsupported there (`capabilities.untrustedWorkspaces.supported: false`), with a runtime fallback to a plain prompt — secrets from an attacker-supplied config are never read or written.
- 🐛 **Multi-hop fixed.** The hop/jump-host chain was built in reverse (the target connected first) — multi-hop was effectively broken; jumps are now the prefix and the target is last. Also: a key path inside a `hop` is expanded (`~`/relative), and a typed hop password is no longer saved to the keychain under the target's identity.
- 🔒 **Auth hardening (from a large external code review).** Secrets never enter the connection-cache identity (deep recursive stripping, including `hop` and `interactiveAuth` answers); removing a password from a profile also shadows one **inherited** from the base config; editing a server inside an array config matches on the full identity (protocol/host/port/user), not just host+user; key deploy won't overwrite `authorized_keys` on a read error (fail-closed); the keychain index is written serially (no lost rows under a race).

---

## 2.4.18 — Удаление со всех профилей · Delete from all profiles

**Русский:**

- ✨ **Кнопка «Все серверы + ПК» в окне удаления.** В модальном диалоге удаления (ПКМ → Delete, «выберите, где удалить») появилась четвёртая кнопка — **«Все серверы + ПК»**. Она удаляет файл/папку с сервера **каждого** профиля **и** локальную копию за одно действие — зеркало «Upload … To All Profiles». Кнопка показывается только когда в конфиге заданы `profiles` (без них она совпадала бы с «И там, и там»). Удаление по каждому серверу идёт независимо (недоступный хост не стопорит остальных), а в `delete.log` каждая строка помечена сервером назначения (`← host`). Локальная копия (одна на все профили) уходит в Корзину ОС один раз; если Корзина недоступна — безвозвратно (как и раньше).

**English:**

- ✨ **"All servers + computer" button in the delete dialog.** The delete confirmation (right-click → Delete, "choose where to delete it") gains a fourth button — **"All servers + computer"**. It removes the file/folder from **every** profile's server **and** the local copy in one action — the mirror of "Upload … To All Profiles". The button appears only when the config defines `profiles` (without them it would equal "On both"). Each server is deleted independently (an unreachable host doesn't stop the rest), and every `delete.log` row is tagged with its destination server (`← host`). The single shared local copy goes to the OS trash once (permanently when no trash is available, as before).

---

## 2.4.17 — Профили как корни дерева, per-profile upload-on-save, адресный отчёт + полировка · Profiles as tree roots, per-profile upload-on-save, addressed report + polish

**Русский:**

- ✨ **Каждый профиль — отдельный корень в дереве сервера.** Когда в конфиге заданы `profiles`, проводник показывает **все** профили сразу, каждый — свой раскрываемый корень. Заходишь на любой сервер и листаешь/качаешь/удаляешь с него **без** «Set Profile»: операция из узла идёт на тот сервер, которому принадлежит узел, а не на глобально активный профиль. Подпись корня — **имя профиля** (если `name` не задан — хост), рядом тускло хост. Подключение открывается лениво, при раскрытии. Drag&drop больше не пускает перенос между разными профилями одного конфига. Вернуть один корень активного профиля — `wireferry.remoteExplorer.profilesAsRoots: false`. Автовыгрузка и операции из локального проводника по-прежнему используют активный профиль (`Set Profile`).
- ✨ **`uploadOnSave` — теперь по-профильно.** Раньше сохранение грузило только в активный профиль. Теперь у каждого профиля свой `uploadOnSave`, а если он не задан — профиль наследует базовый; на сохранении файл уходит **во все профили, где итог `true`** (параллельно, недоступный хост не стопорит остальных). Базовый `uploadOnSave: true` → во все профили (ферма одинаковых серверов: web-ноды, зеркало prod+staging); исключить один — `"uploadOnSave": false` в этом профиле (или наоборот: база `false`, а нужным профилям `true`). Активный профиль выбирать не нужно. Конфиг без профилей работает как раньше.
- ✨ **Выгрузка во все профили говорит, куда смогла и куда нет.** При «Upload … To All Profiles» в `upload.log` у каждой строки виден **хост назначения** (`→ 1.2.3.4`), а неудачи идут отдельной строкой **`✖ ОШИБКА … — хост: причина`** (нет прав / нет места / сеть / таймаут — текст с сервера); сверху — итог **«успешно N, с ошибкой M»**. В сообщении об ошибке теперь назван **конкретный сервер** — без догадок «видимо, этот». Недостающие каталоги на сервере по-прежнему создаются автоматически (`mkdir -p`); «Permission denied» — это про права на сервере, а не про путь.
- 🔒 **Полировка по итогам повторного ревью.** Сохранение в несколько профилей: ошибка теперь логируется **с именем профиля и хоста**, а частичный успех («залилось 1 из 2, не удалось: eee») — это **предупреждение**, а не общий красный статус. У ошибок SFTP добавлены подсказки для **кода 3 (Permission denied → нет прав на пути; проверьте владельца/группу)** и **кода 2 (нет такого пути → нет родительской папки)**. `diff` больше **не оставляет временные копии** удалённых файлов на диске (включён `setGracefulCleanup`). FTP-симлинк больше не «успешен молча» — отклоняется и попадает в отчёт как ошибка, а не пропадает незаметно. `sshCustomParams`: закрыт обход проверки через кавычки/бэкслеш (`-oProx"yCommand=…` раньше проскакивал мимо чёрного списка). При `useTempFile`, если повторный `rename` падает, сообщение прямо указывает, что готовая копия осталась в `*.new`.

**English:**

- ✨ **Each profile is its own root in the server tree.** When the config defines `profiles`, the explorer shows **all** of them at once, each its own expandable root. Browse/download/delete from any server **without** "Set Profile": an action on a node runs against the server that node belongs to, not the globally-active profile. The root label is the **profile name** (or the host when `name` is unset), with the host dimmed alongside. Connections open lazily, on expand. Drag&drop no longer lets you move between different profiles of one config. Restore the single active-profile root with `wireferry.remoteExplorer.profilesAsRoots: false`. Upload-on-save and actions from the local Explorer still use the active profile (`Set Profile`).
- ✨ **`uploadOnSave` is now per-profile.** A save used to go to the active profile only. Now each profile takes its own `uploadOnSave`, inheriting the base value when it doesn't set one; a save then uploads to **every profile whose effective value is `true`** (in parallel; an unreachable host doesn't stop the rest). A base `uploadOnSave: true` reaches every profile (a fleet of identical servers: web nodes, a prod+staging mirror); exclude one with `"uploadOnSave": false` in that profile (or invert: base `false`, `true` only where you want it). No active profile needs to be selected. A config without profiles behaves as before.
- ✨ **Upload to All Profiles tells you where it went and where it didn't.** For "Upload … To All Profiles" the `upload.log` now shows each row's **destination host** (`→ 1.2.3.4`), and failures get their own line **`✖ FAILED … — host: reason`** (permission / no space / network / timeout — the server's text); an **"N ok, M failed"** tally sits up top. The error message now names the **specific server** that failed — no guessing. Missing server directories are still created automatically (`mkdir -p`); a "Permission denied" is about server-side rights, not the path.
- 🔒 **Polish from a follow-up review.** Saving to several profiles now logs a failure **with the profile name and host**, and a partial success ("uploaded to 1/2, failed: eee") is a **warning**, not a blanket red status. SFTP errors gained hints for **code 3 (Permission denied → no access to the path; check owner/group)** and **code 2 (no such path → a parent directory is missing)**. `diff` no longer **leaves temp copies** of remote files on disk (`setGracefulCleanup` enabled). An FTP symlink is no longer "silently successful" — it's rejected and reported as a failed entry instead of vanishing. `sshCustomParams`: a quote/backslash bypass of the guard is closed (`-oProx"yCommand=…` used to slip past the blocklist). With `useTempFile`, if the second `rename` fails the error states plainly that the finished copy is kept at `*.new`.

---

## 2.4.13 — Размеры, MD5 и фикс сохранения на симлинках/subst · Sizes, MD5 & save-on-symlink/subst fix

**Русский:**

- 🐛 **`uploadOnSave` больше не падает «Config Not Found» на симлинках и subst/подключённых дисках.** При сохранении путь канонизируется через `realpathSync.native`, и если результат отличался от пути, под которым зарегистрирован конфиг (симлинк на Linux/macOS развернулся; subst/mapped-диск на Windows раскрылся в реальный путь), сервис не находился → «Config Not Found». Теперь канонизация принимается, только если изменился **лишь регистр**; структурное изменение (симлинк/subst) отклоняется — конфиг находится, файл выгружается. Дополняет фикс 2.0.3 для UNC; покрыт регрессионным тестом.
- ✨ **Показ размеров в дереве сервера (кнопка).** В шапке проводника — переключатель **«Показать размеры»**: у файлов и папок постоянно виден размер. Размер папок берётся с сервера одной командой **`du`**, считается **в фоне** (имена видны сразу, размеры подставляются по готовности — дерево не блокируется), результат кэшируется (переключатели лёгкие; пере-меряет только «Обновить»). На FTP/без `du` папки остаются по имени. Есть и настройка `wireferry.remoteExplorer.showSize`.
- ✨ **Сортировка по размеру (кнопка).** Второй переключатель — **«Сортировать по размеру»**: файлы и папки сортируются по убыванию размера **раздельными группами** (папки сверху, файлы ниже, не вперемешку). Иконки кнопок отражают текущее состояние (отсортировано / размеры показаны).
- ✨ **Отчёт «Размер и MD5».** ПКМ по файлу/папке (в дереве сервера, **в локальном проводнике** и во вкладке редактора) → отчёт: путь, права, **размер на сервере и локально** и **MD5 обеих сторон** с вердиктом **✓ совпадает / ✗ различаются**. Для одиночного файла MD5 считается всегда; для **папки** спрашивается отдельно («Размер + MD5 / Только размер»), т.к. хеширование каждого файла рекурсивно может быть долгим. Если объекта нет на сервере — пишет прямо **«НА СЕРВЕРЕ НЕ НАЙДЕН»** (а не «(неизв.)»). MD5 сервера — через `md5sum`/`openssl`; на FTP/без exec — «н/д».
- ✨ **Удаление (сервер / локально / оба) из локального проводника и вкладки редактора.** Наша команда удаления (с выбором, где удалять) больше не только в дереве сервера. Сделана **идемпотентной**: если файла на сервере уже нет — это не ошибка (раньше падало «No such file»). Локальная копия уходит в Корзину ОС, а если Корзина недоступна (subst/сетевой диск) — **удаляется безвозвратно** (как нативный «Delete Permanently»), чтобы файл реально удалился.
- 🧹 **Полировка.** Диалог удаления при выборе **больше 5 файлов** показывает количество («Удалить N элементов?») вместо гигантского списка. Кнопка «Проверить обновления» убрана из тулбара дерева (осталась в ПКМ по корню сервера). Все новые подписи и сообщения — двуязычные.

**English:**

- 🐛 **`uploadOnSave` no longer fails with "Config Not Found" on symlinks and subst / mapped drives.** On save the path is canonicalized with `realpathSync.native`; when that differed from the path the config was registered under (a symlink resolved on Linux/macOS; a subst / mapped drive expanded to its real target on Windows) the service wasn't found → "Config Not Found". The canonical path is now adopted only when it differs by **case alone**; a structural change (symlink / subst) is rejected — the config is found and the file uploads. Complements the 2.0.3 UNC fix; covered by a regression test.
- ✨ **Show sizes in the server tree (toggle).** A **"Show Sizes"** toolbar button: files and folders display their size at all times. Folder sizes come from one server-side **`du`**, computed **in the background** (names show instantly, sizes fill in when ready — the tree never blocks) and cached (toggles are light; only Refresh re-measures). On FTP / without `du`, folders keep name order. There's also a `wireferry.remoteExplorer.showSize` setting.
- ✨ **Sort by size (toggle).** A second button — **"Sort by Size"**: files and folders sort by size, largest first, as **separate groups** (folders above, files below, never intermixed). The button icons reflect the current state (sorted / sizes shown).
- ✨ **"Size & MD5" report.** Right-click a file/folder (in the server tree, the **local Explorer**, or the editor tab) → a report: path, permissions, **size on the server and locally**, and **MD5 on both sides** with a **✓ match / ✗ differ** verdict. A single file always includes its MD5; for a **folder** you're asked first ("Size + MD5 / Size only") since hashing every file recursively can be slow. If the item isn't on the server it says **"NOT FOUND on server"** outright (instead of "(unknown)"). Server MD5 uses `md5sum`/`openssl`; on FTP / without exec it's "n/a".
- ✨ **Delete (server / local / both) from the local Explorer and editor tab.** Our scoped delete is no longer only in the server tree. It's now **idempotent**: if the server copy is already gone, that's not an error (it used to fail with "No such file"). The local copy goes to the OS trash, and when the trash is unavailable (subst / network drive) it **deletes permanently** (like the native "Delete Permanently") so the file is actually removed.
- 🧹 **Polish.** The delete confirmation shows a count past **5 files** ("Delete N items?") instead of a giant list. The "Check for Updates" button moved off the tree toolbar (still in the server-root menu). All new labels and messages are bilingual.

---

## 2.3.1 — Видимость операций · Operation visibility

**Русский:**

- **✨ Прогресс-бар по байтам при выгрузке/скачивании.** Явные передачи по ПКМ (файл/папка/проект/синхронизация) показывают всплывающий прогресс с **заполняющимся баром по байтам** («45 МБ из 200»), именем текущего файла, счётчиком и кнопкой **Отмена**. Главное — один большой файл (лог на 200 МБ) больше не качается «в тишине»: видно, что процесс жив и сколько осталось. Счётчик байтов снимается прямо с потока передачи, не вмешиваясь в саму запись.
- **✨ Умное открытие после скачивания.** Текстовые файлы и исходники (`.log`, `.php`, `.txt`, код, конфиги) открываются сразу, как раньше. А бинарные (`.exe`, `.wav`, видео, архивы, образы), **нераспознанные типы** (напр. `.cdr`) **и любые файлы больше 10 МБ** теперь спрашивают: «Открыть в VS Code? / Показать в проводнике / Отмена» — раньше открытие 45-мегабайтного exe или бинаря наглухо вешало редактор. Отказ оставляет файл скачанным, но не открывает.
- **✨ Клик по файлу в дереве теперь скачивает с прогрессом.** Простой клик по файлу на сервере скачивает его с тем же **баром по байтам** (без отчёта) и затем применяет умное открытие — а не тихо тянет содержимое в превью (где большой файл подвисал, а бинарь падал с «cannot be opened as text»). Стало поведением по умолчанию (`downloadWhenOpenInRemoteExplorer: true`); кому нужно прежнее превью без скачивания — поставьте настройку в `false`. Правый клик «Download» по-прежнему даёт прогресс **и** отчёт `download.log`.
- **✨ Отчёт операции (`delete.log` / `upload.log` / `download.log`).** После явного ПКМ-действия открывается вкладка-отчёт: по каждому файлу — что сделано и где (на сервере / на компьютере / и там и там), размер, дата, права. При **удалении** локальная и серверная стороны показаны рядом с пометкой, если они различаются — видно, что удалили обе копии, даже если они отличались. Автовыгрузка при сохранении (`uploadOnSave`) отчёт **не** открывает — чтобы не мешать.
- **✨ Пропуск слишком больших файлов при передаче папки.** Необязательная настройка `maxFileSize` (в мегабайтах): при выгрузке/скачивании папки/проекта/синхронизации файлы больше порога пропускаются, а в конце показывается сводка «Пропущено N файлов больше X МБ» — один гигантский файл больше не стопорит всю пачку. Одиночный файл, выбранный явно, передаётся всегда. По умолчанию выключено.
- **🔧 Пофайловое удаление папки.** Рекурсивное удаление на сервере теперь обходит дерево записями (а не одним «удали всё»), что даёт имена файлов в прогрессе, отмену посередине и данные для отчёта. Порядок — листья раньше родителя; симлинки удаляются как ссылки, без захода внутрь.
- **✨ «Узнать размер папки…».** Новый пункт в контекстном меню дерева (ПКМ по папке) открывает **отчёт-вкладку** (не исчезает, в отличие от всплывашки) со сводкой: путь и права на сервере, размер на сервере, и — если папка скачана локально — локальный путь, размер и разницу. На SFTP размер берётся одной серверной командой **`du -sb`** (точные байты, быстро даже на медленном канале), для FTP/серверов без `du` — рекурсивным обходом с живым счётчиком и Отменой; локальный размер считается через Node fs (работает на Windows/Linux/macOS). Размеры показаны и точными байтами с разделителем, и в человеческом виде — `12 000 000 000 байт (12 GB)`. Путь к папке безопасно экранируется перед отправкой в shell.
- **🔒 Усиление безопасности и надёжности (по итогам внешнего аудита).** Проверка `CR`/`LF`/`NUL` теперь во **всех** FTP-операциях (не только chmod) — защита управляющего канала от инъекции команд. Заблокирован флаг `-F` в `sshCustomParams` (мог подсунуть чужой ssh-конфиг с авто-командой). Поддельный серверный URI вне корня профиля отклоняется (нельзя выйти за пределы настроенной папки). Имена при переименовании отклоняют управляющие символы и Unicode-двойники разделителей (напр. fullwidth `／`). Предпросмотр файла больше **10 МБ** не читается в память целиком — редактор не виснет. Выгрузка во временный файл больше не удаляет оригинал при обрыве сети (только при явном отказе сервера переписать). Зависшая очередь файловых дескрипторов SFTP после обрыва соединения теперь завершается с ошибкой, а не висит вечно.

**English:**

- **✨ Byte-level progress bar for uploads/downloads.** Explicit right-click transfers (file/folder/project/sync) show a notification with a **byte-filling bar** ("45 MB / 200 MB"), the current file name, a counter and a **Cancel** button. Crucially, one large file (a 200 MB log) no longer transfers "in silence" — you can see it's alive and how much is left. Bytes are counted straight off the transfer stream without interfering with the write.
- **✨ Smart open after download.** Text files and source (`.log`, `.php`, `.txt`, code, configs) open immediately as before. Binaries (`.exe`, `.wav`, video, archives, images), **unrecognized types** (e.g. `.cdr`) **and any file over 10 MB** now ask first: "Open in VS Code? / Reveal in Explorer / Cancel" — opening a 45 MB exe or a binary used to freeze the editor solid. Declining leaves the file downloaded but unopened.
- **✨ A plain click in the tree now downloads with progress.** Single-clicking a server file downloads it with the same **byte progress bar** (no report tab) and then runs smart-open — instead of silently streaming the content into an in-memory preview (where a big file stalled and a binary failed with "cannot be opened as text"). This is the new default (`downloadWhenOpenInRemoteExplorer: true`); set it to `false` to get the old preview-without-download. Right-click "Download" still gives both progress **and** a `download.log` report.
- **✨ Operation report (`delete.log` / `upload.log` / `download.log`).** After an explicit right-click action a report tab opens: per file — what was done and where (server / computer / both), size, date, permissions. For **delete**, the local and server sides are shown side by side with a marker when they differ — so you can see both copies were removed even if they diverged. Upload-on-save does **not** open a report, to stay out of the way.
- **✨ Skip oversized files during folder transfers.** Optional `maxFileSize` setting (in megabytes): during a folder/project/sync transfer, files larger than the threshold are skipped, with an end summary "Skipped N files larger than X MB" — one giant file no longer stalls the whole batch. A single explicitly chosen file is always transferred. Off by default.
- **🔧 File-by-file folder delete.** Recursive remote delete now walks the tree entry by entry (instead of one bulk "remove everything"), which yields file names in the progress bar, mid-way cancellation, and the data for the report. Order is leaves before parent; symlinks are removed as links, not followed.
- **✨ "Get Folder Size…".** A new tree context-menu item (right-click a folder) opens a **report tab** (it stays, unlike a toast) summarizing: the server path and permissions, the server size, and — when the folder is downloaded locally — the local path, size and the difference. On SFTP the size comes from one server-side **`du -sb`** (byte-exact, fast even over a slow link); for FTP or servers without `du` it walks the tree with a live counter and Cancel; the local size is summed via Node fs (works on Windows/Linux/macOS). Sizes are shown both as exact grouped bytes and human-readable — `12,000,000,000 bytes (12 GB)`. The folder path is safely shell-escaped before it's sent.
- **🔒 Security & reliability hardening (from an external audit).** `CR`/`LF`/`NUL` is now rejected in **every** FTP operation (not just chmod) — guards the control channel against command injection. The `-F` flag is blocked in `sshCustomParams` (it could load an attacker's ssh config carrying an auto-run command). A forged server URI outside the profile's root is refused (no escaping the configured folder). Rename input rejects control characters and Unicode separator look-alikes (e.g. fullwidth `／`). A preview of a file over **10 MB** is no longer read into memory whole — the editor won't freeze. A temp-file upload no longer deletes the original on a network drop (only when the server explicitly refuses to overwrite). A wedged SFTP file-descriptor queue after a dropped connection now fails cleanly instead of hanging forever.

---

## 2.2.1 — Подключение к старым SSH-серверам · Legacy SSH key exchange

**Русский:**

- **✨ Подключение к серверам со старым обменом ключами (`diffie-hellman-group1-sha1` и др.).** Древние SSH-серверы поддерживают только устаревшие KEX-алгоритмы на базе фиксированных DH-групп. VS Code исполняет расширение на Electron, чей крипто-движок (BoringSSL) не реализует классический Diffie-Hellman, поэтому такое подключение падало с `Unknown DH group` — даже после явного включения алгоритма в конфиге. Теперь, когда движок отказывает, расширение выполняет сам обмен ключами на `BigInt` (`g^x mod p`): для именованных групп (`modp2`/`modp14`) используются зашитые RFC-константы, для group-exchange — присланное сервером простое число.
- **🔒 Безопасность по умолчанию не снижена.** Запасной путь срабатывает только если (а) пользователь сам включил legacy-KEX в конфиге профиля и (б) нативный движок отказал. Современные подключения (curve25519/ECDH) идут прежним, нативным путём без изменений.
- **ℹ️ Как включить.** Legacy-алгоритм по-прежнему нужно явно разрешить в конфиге — это часть согласования, а не дефолт: `"algorithms": { "kex": { "append": ["diffie-hellman-group1-sha1"] } }`. `append` добавляет старую группу к современным, не ломая нормальные серверы при общем конфиге.
- **🔧 Подсказки автодополнения в конфиге приведены к реальности.** Поле `algorithms` (`kex`/`cipher`/`hmac`/`serverHostKey`) теперь принимает в схеме и точный список, и форму `{ "append": [...] }` (раньше редактор подчёркивал её как ошибку, хотя подключение работало). Из автодополнения убраны шифры, которые `ssh2` уже не поддерживает (`arcfour*`, `blowfish-cbc`, `cast128-cbc`), и добавлены актуальные (`chacha20-poly1305`, `curve25519`, `group14-sha256` и др.).
- **🔧 Обновление с GitHub: файл рядом с конфигом и самоудаление.** Скачанный `.vsix` теперь кладётся в `.vscode` проекта (рядом с `wireferry.json`), а не в системную папку temp, и после успешной установки удаляется сам.

**English:**

- **✨ Connect to servers with legacy key exchange (`diffie-hellman-group1-sha1` and friends).** Ancient SSH servers only support obsolete KEX algorithms built on fixed DH groups. VS Code runs the extension on Electron, whose crypto backend (BoringSSL) does not implement classic Diffie-Hellman, so such connections failed with `Unknown DH group` — even after enabling the algorithm in the config. When the backend refuses, the extension now performs the key exchange itself via `BigInt` (`g^x mod p`): named groups (`modp2`/`modp14`) use built-in RFC constants, group-exchange uses the server-supplied prime.
- **🔒 Default security is not weakened.** The fallback only engages when (a) the user explicitly enabled a legacy KEX in the profile config and (b) the native backend refused. Modern connections (curve25519/ECDH) keep using the native path unchanged.
- **ℹ️ How to enable.** The legacy algorithm must still be opted into in the config — it's part of negotiation, not a default: `"algorithms": { "kex": { "append": ["diffie-hellman-group1-sha1"] } }`. `append` adds the old group to the modern ones, so a shared config still works against normal servers.
- **🔧 Config autocomplete now matches reality.** The `algorithms` field (`kex`/`cipher`/`hmac`/`serverHostKey`) accepts both an exact list and the `{ "append": [...] }` form in the schema (the editor used to flag the latter as an error even though the connection worked). Ciphers `ssh2` no longer supports (`arcfour*`, `blowfish-cbc`, `cast128-cbc`) were dropped from autocomplete and current ones added (`chacha20-poly1305`, `curve25519`, `group14-sha256`, …).
- **🔧 GitHub update: file next to the config, self-deleting.** The downloaded `.vsix` now lands in the project's `.vscode` folder (next to `wireferry.json`) instead of the OS temp dir, and is removed automatically after a successful install.

---

## 2.2.0 — Двусторонняя синхронизация, безопасность и надёжность · Two-way sync, security & reliability

**Русский:**

- **🐛 «Синхронизация в обе стороны» теперь действительно двусторонняя.** Половина функции молча не работала: файлы и папки, которые новее на сервере или есть **только** на сервере, не скачивались на компьютер. Причина — при передаче «сервер → компьютер» менялась только метка направления, а сами файловые системы не переставлялись местами, поэтому серверный путь читался из локальной ФС (его там нет) и тихо терялся. Теперь направление и файловые системы переключаются вместе — встречная половина синхронизации (включая папки, существующие только на сервере) приезжает на компьютер.
- **🐛 Выгрузка больше не обнуляет файл на сервере, если источник не прочитать.** При `useTempFile: false` (значение по умолчанию) целевой файл открывался на запись — то есть **усекался** — до того, как был прочитан локальный источник. Если источник внезапно недоступен (удалён, нет прав), на сервере оставался пустой файл, а прежняя копия пропадала. Теперь источник читается **до** усечения цели.
- **🐛 Соединения всех профилей закрываются при смене конфига.** Раньше `dispose()` вычислял, какое соединение закрыть, по **текущему** профилю, поэтому после переключения профиля старое SFTP/FTP-соединение оставалось висеть. Теперь расширение помнит все реально открытые соединения и закрывает их все.
- **🐛 Переименование со сменой только регистра.** `foo.txt → Foo.txt` на регистронезависимом сервере (Windows/macOS) ошибочно считалось «цель уже существует» и блокировалось. Теперь чистая смена регистра не считается конфликтом — и на сервере, и в локальной копии.
- **🔒 Защита от инъекций в команды FTP.** Символы `CR`/`LF` запрещены в именах записей и проверяются на прямых точках входа `chmod`/изменения даты — имя с `\r\n` больше не может «подклеить» вторую FTP-команду (`SITE CHMOD`/`MFMT`).
- **🔒 Маскировка секретов в логах — рекурсивно.** Пароли/ключевые фразы маскируются и во вложенных объектах — `profiles.<имя>.password`, `hop[].password` — а не только на верхнем уровне.
- **🔒 Проверка обновлений качает `.vsix` только с GitHub по HTTPS.** Загрузка и её редиректы ограничены доменами GitHub поверх `https` — редирект на произвольный хост (а файл потом устанавливается) отклоняется.
- **🔒 Кэш соединений больше не путает разные хосты.** Ключ кэша строится стабильной сериализацией (раньше значения склеивались встык, и два разных хоста могли попасть в один слот, а команда — уйти не на то соединение).
- **🐛 Надёжность соединений (SSH/FTP).** Лимит одновременно открытых файлов теперь у **каждого** соединения свой (был один на весь процесс); очередь открытий — FIFO (раньше LIFO «голодала» ранние запросы); счётчики сбрасываются при переподключении; в счёт идут только успешные открытия; закрытие соединения идемпотентно (цепочка hop не рвётся дважды); таймаут подключения FTP очищается, когда соединение установилось. Потоки освобождаются сразу при ошибке записи. Парсинг прав по FTP-листингу больше не ломается на `suid`/`sgid`/`sticky`-битах.
- **✨ Права доступа в подсказке дерева.** При наведении на запись в дереве сервера во всплывающей подсказке показываются права — в виде `755 (rwxr-xr-x)`. После команды chmod дерево обновляется сразу. Данные — из уже полученного листинга, без дополнительных запросов.
- **🐛 Проверка имён при создании файла/папки.** Поле ввода отклоняет пустые имена, абсолютные пути и сегменты вроде `..` или со спецсимволами (чтобы новая запись не оказалась **вне** выбранной папки). Ввод относительного пути в «Reveal» по дереву тоже не может выйти за корень сервера.
- **🐛 Подтверждение «выгрузить во все профили» — у всех вариантов.** Предупреждение перед массовой выгрузкой во все профили теперь показывается для **всех** таких команд (раньше — только для файла/папки).

**English:**

- **🐛 "Sync Both Directions" is now genuinely two-way.** Half of the feature silently did nothing: files and folders that were newer on the server, or existed **only** on the server, never came down to your computer. The cause: for the server → local half only the direction label was flipped, the filesystems were not swapped, so a server path was read from the local filesystem (where it doesn't exist) and quietly lost. Direction and filesystems now switch together, so the reverse half (including server-only folders) actually downloads.
- **🐛 An upload no longer empties the server file when the source can't be read.** With `useTempFile: false` (the default) the destination was opened for writing — i.e. **truncated** — before the local source had been read. If the source was suddenly unavailable (deleted, no permission), the server was left with an empty file and the previous copy gone. The source is now read **before** the destination is truncated.
- **🐛 Connections from every profile are closed on config change.** Previously `dispose()` worked out which connection to close from the **currently active** profile, so after switching profiles the old SFTP/FTP socket lingered. The extension now remembers every connection it actually opened and closes them all.
- **🐛 Case-only rename.** `foo.txt → Foo.txt` on a case-insensitive server (Windows/macOS) was wrongly treated as "target already exists" and blocked. A pure case change is no longer counted as a collision — both on the server and in the local copy.
- **🔒 Guard against FTP command injection.** `CR`/`LF` are rejected in entry names and checked at the direct `chmod` / set-modified-time entry points — a name containing `\r\n` can no longer smuggle in a second FTP command (`SITE CHMOD` / `MFMT`).
- **🔒 Recursive secret masking in logs.** Passwords/passphrases are masked inside nested objects too — `profiles.<name>.password`, `hop[].password` — not just at the top level.
- **🔒 The update check downloads the `.vsix` only from GitHub over HTTPS.** The download and its redirects are pinned to GitHub hosts over `https`; a redirect to an arbitrary host (the file is installed afterwards) is refused.
- **🔒 The connection cache no longer conflates different hosts.** The cache key is built with a stable serialization (values used to be concatenated end-to-end, so two different hosts could land in one slot and a command could run against the wrong connection).
- **🐛 Connection reliability (SSH/FTP).** The open-file limit is now **per connection** (it was one module-wide value); the open queue is FIFO (a LIFO queue starved the earliest requests under load); counters reset on reconnect; only successful opens are counted; disconnect is idempotent (the hop chain isn't torn down twice); the FTP connect timeout is cleared once the connection is up. Streams are released immediately on a write error. Parsing permissions from an FTP listing no longer breaks on `suid`/`sgid`/`sticky` bits.
- **✨ Permissions in the tree hover.** Hovering an entry in the server tree shows its permissions in the tooltip — as `755 (rwxr-xr-x)`. After a chmod the tree refreshes right away. The data comes from the listing already fetched, with no extra requests.
- **🐛 Name validation when creating a file/folder.** The input box rejects empty names, absolute paths, and segments like `..` or ones with special characters (so the new entry can't end up **outside** the chosen folder). Typing a relative path into the tree's "Reveal" likewise can't escape the server root.
- **🐛 "Upload to all profiles" confirmation for every variant.** The warning before a mass upload to all profiles is now shown for **all** such commands (previously only the file/folder ones).

---

## 2.1.0 — Права доступа (chmod), размер в подсказке, фиксы создания/удаления · Permissions (chmod), size tooltip, create/delete fixes

**Русский:**

- **✨ Права доступа (chmod).** В контекстном меню дерева сервера (ПКМ по файлу или папке) появилась команда **«Изменить права (chmod)»**. Текущие права показываются сразу; выбор из пресетов (`644`, `755`, `600`, `700`, `777`) с расшифровкой `rwx` либо **«Своё значение…»** для ручного ввода в восьмеричном виде. Для папки спрашивается, применить **только к ней** или **рекурсивно** ко всему содержимому (как `chmod -R`). По SFTP — надёжно; по FTP — через `SITE CHMOD` (поддерживается не всеми серверами).
- **✨ Размер и дата при наведении.** При наведении на файл в дереве во всплывающей подсказке показываются полный путь, **размер** (человекочитаемый) и **дата изменения**. Данные берутся из того же листинга каталога — **дополнительных запросов к серверу нет**.
- **🐛 Явные «Создать»/«Удалить» больше не блокирует фильтр `ignore`.** Фильтр `ignore` предназначен для синхронизации (выгрузка/загрузка), но по ошибке применялся и к ручным командам: файл под правилом (например, `*.txt`) **молча** не создавался и не удалялся. Теперь явные действия в дереве выполняются всегда; авто-синхронизация (`uploadOnSave`, выгрузка папок) фильтр `ignore` по-прежнему уважает.
- **🐛 Новая папка сразу показывается папкой.** Сразу после создания папка иногда рисовалась как файл (до ручного «Обновить») — некоторые серверы (в т.ч. встроенный SFTP на устройствах) отдают свежесозданную запись с «не осевшими» атрибутами в первом листинге. Тип теперь закрепляется по факту создания и не зависит от этого листинга.

**English:**

- **✨ Permissions (chmod).** The server-tree context menu (right-click a file or folder) gained a **"Change Permissions (chmod)"** command. The current mode is shown up front; pick from presets (`644`, `755`, `600`, `700`, `777`) with their `rwx` meaning, or **"Custom value…"** to type an octal mode by hand. For a folder you're asked whether to apply it **to the folder only** or **recursively** to all its contents (like `chmod -R`). Reliable over SFTP; over FTP it uses `SITE CHMOD` (not supported by every server).
- **✨ Size & date on hover.** Hovering a file in the tree shows a tooltip with the full path, the **size** (human-readable) and the **modified date**. The data comes from the directory listing we already fetch — **no extra server requests**.
- **🐛 Explicit Create/Delete are no longer blocked by the `ignore` filter.** The `ignore` filter is meant for sync (upload/download), but it was wrongly applied to manual commands too: a file matched by a rule (e.g. `*.txt`) **silently** failed to be created or deleted. Explicit tree actions now always run; auto-sync (`uploadOnSave`, folder uploads) still honours `ignore`.
- **🐛 A new folder shows as a folder right away.** Just after creation a folder could be drawn as a file (until a manual Refresh) — some servers (including embedded SFTP on devices) return the freshly created entry with unsettled attrs in the first listing. The type is now pinned from the act of creation, independent of that listing.

---

## 2.0.9 — Фикс двойного вопроса при открытии из дерева · Fix duplicate download-on-open from the tree

**Русский:** Если включены и `downloadWhenOpenInRemoteExplorer`, и `downloadOnOpen: "confirm"`, открытие файла из дерева сервера задавало лишний вопрос «скачать?» — но файл к тому моменту уже был скачан командой «Edit in Local» (её запускает клик в дереве), поэтому ответ «Нет» ничего не отменял. Теперь `downloadOnOpen` **пропускает файлы, только что открытые через «Edit in Local»** — лишнего вопроса больше нет. Клик в дереве при `downloadWhenOpenInRemoteExplorer: true` по-прежнему скачивает сразу (это его назначение); чтобы клик не качал автоматически, поставьте `downloadWhenOpenInRemoteExplorer: false` (тогда клик откроет превью только для чтения, а для правки — ПКМ → «Edit in Local»).

**English:** With both `downloadWhenOpenInRemoteExplorer` and `downloadOnOpen: "confirm"` enabled, opening a file from the server tree asked a redundant "download?" question — but the file had already been fetched by "Edit in Local" (which the tree click runs), so answering "No" undid nothing. `downloadOnOpen` now **skips files just opened via "Edit in Local"**, so the spurious prompt is gone. A tree click with `downloadWhenOpenInRemoteExplorer: true` still downloads immediately (that's its purpose); to stop the click from auto-downloading, set `downloadWhenOpenInRemoteExplorer: false` (the click then opens a read-only preview, and editing is via right-click → "Edit in Local").

---

## 2.0.8 — Понятные описания и фикс «скачать при открытии» · Clear field docs & download-on-open fix

**Русский:** Исправлено `downloadOnOpen` (скачивание серверной версии при открытии файла): раньше оно срабатывало на **любой** открытый файл в проекте — пыталось скачать даже сам конфиг `.vscode/wireferry.json` и файлы, которых нет на сервере (ошибка «No such file»), и спрашивало подтверждение, когда качать было нечего. Теперь оно **пропускает конфиг-файлы** и **проверяет наличие файла на сервере (`lstat`) до вопроса** — спрашивает и качает только то, что реально есть на сервере, а «Нет» гарантированно отменяет до скачивания. Плюс переписаны **описания полей** в шаблоне конфигурации (и в подсказках при наведении): `ignore`/`ignoreFile` (что и куда пропускается, формат, путь), `syncOption` (источник/приёмник зависят от направления «Синхронизации»), `profiles` (это переключаемые наборы для одного сервера; несколько серверов в дереве — это массив конфигов), `remoteExplorer` (только вид дерева), `downloadOnOpen`.

**English:** Fixed `downloadOnOpen` (fetch the server copy when you open a file): it used to fire on **every** opened file in the project — it even tried to download the config `.vscode/wireferry.json` itself and files not present on the server ("No such file" errors), and prompted when there was nothing to fetch. It now **skips config files** and **checks the file exists on the server (`lstat`) before asking** — it prompts and downloads only for files that really exist remotely, and "No" reliably cancels before any download. Also rewrote the **field descriptions** in the config template (and the hover tooltips): `ignore`/`ignoreFile` (what is skipped where, the format, the path), `syncOption` (source/destination depend on the Sync direction), `profiles` (switchable presets for one server; several servers in the tree is a config array instead), `remoteExplorer` (tree appearance only), `downloadOnOpen`.

---

## 2.0.7 — Конфиг по запросу · Config on request

**Русский:** По отзыву: расширение больше **не создаёт конфиг молча**. Если в проекте нет конфигурации, при старте оно **спрашивает**, нужен ли здесь SFTP/FTP, с вариантами **«Создать конфиг» / «Не сейчас» / «Не спрашивать в этом проекте»** — последний выбор запоминается для этого проекта, так что проекты без SFTP больше ничем не беспокоятся. Если удалить конфиг, при следующем старте вопрос задаётся снова. Шаблон конфигурации теперь создаётся **на языке настройки `wireferry.alertLanguage`** (комментарии на русском или английском). В контекстное меню проводника (ПКМ по папке) добавлен пункт **WireFerry: Config** для создания/открытия конфига вручную; эта же команда теперь пишет полный шаблон с комментариями (раньше — короткий).

**English:** Based on feedback, WireFerry **no longer creates a config silently**. When a project has no configuration, on startup it **asks** whether you want SFTP/FTP here, offering **Create config / Not now / Don't ask in this project** — the last choice is remembered per project, so projects that don't use SFTP stay untouched. If you delete the config, the next start asks again. The config template now follows the **`wireferry.alertLanguage`** setting (Russian or English comments). The Explorer context menu (right-click a folder) gained a **WireFerry: Config** item to create/open the config by hand; that command now writes the full commented template (it used to write a short one).

---

## 2.0.6 — Совместимость с легаси и доктор конфигурации · Legacy compatibility & config doctor

**Русский:** После вынужденного переименования `sftp-link → wireferry` (2.0.0) пользовательские настройки с префиксом `sftp.*` перестали читаться — например, файлы из дерева сервера открывались только на чтение, потому что игнорировался `sftp.downloadWhenOpenInRemoteExplorer`. Совместимость восстановлена и расширена:

- **Настройки `sftp.*` снова работают** — читаются как запасной вариант для `wireferry.*` (явно заданный `wireferry.*` имеет приоритет).
- **Доктор конфигурации при старте** один раз показывает сводку проблем: какие легаси `sftp.*` заменить на `wireferry.*` и какие неподдерживаемые ключи удалить — с путём и номером строки, по `settings.json` и `.vscode/{wireferry,sftp}.json`. Кнопки: открыть файл на нужной строке, «Подробности» в канал Output, «Исправить `settings.json`» автоматически (переносит `sftp.*` → `wireferry.*`, группируя ключи рядом), «Больше не напоминать» (`wireferry.suppressLegacyConfigNotice`).
- **Переименование конфига** — если остался только `.vscode/sftp.json`, предлагается переименовать его в `.vscode/wireferry.json`; при отказе (подтверждение вводом `yes`) в конфиг пишется маркер `keepLegacyConfigFormat`, и напоминания прекращаются.
- **Комментарии в конфиге (JSONC)** — `.vscode/{wireferry,sftp}.json` теперь читаются как JSONC, можно добавлять `//`-комментарии. Для нового проекта без конфигов создаётся подробный закомментированный шаблон, который сразу открывается.
- **Проверка обновлений на GitHub** — по желанию. Перед первым запросом спрашивается разрешение; при согласии делается **один** HTTPS-запрос (GET) к `api.github.com` за номером последнего релиза — без телеметрии, никакие ваши данные не отправляются. Фоновая проверка при старте только скачивает `.vsix` (установку запускаете вы), а команда **«WireFerry: Проверить обновления»** (палитра и шапка Remote Explorer) проверяет вручную и может скачать и установить обновление. Отключается настройкой `wireferry.checkForUpdates`.
- **Язык сообщений** — новая настройка `wireferry.alertLanguage` (по умолчанию English): всплывающие сообщения и запросы самого WireFerry можно переключить на русский независимо от языка интерфейса VS Code.
- **Окно-отчёт** — диагностику конфигурации доктор дополнительно открывает отдельной вкладкой-отчётом (с путями и номерами строк), которая остаётся открытой, пока её не закроют, — чтобы успеть прочитать и скопировать пути (всплывающие окна исчезают слишком быстро).

**English:** After the forced `sftp-link → wireferry` rename (2.0.0), user settings under the `sftp.*` prefix stopped being read — e.g. files from the server tree opened read-only because `sftp.downloadWhenOpenInRemoteExplorer` was ignored. Compatibility is restored and extended:

- **`sftp.*` settings work again** — read as a fallback for `wireferry.*` (an explicit `wireferry.*` wins).
- **A startup config doctor** shows a single summary of issues: which legacy `sftp.*` to rename to `wireferry.*` and which unsupported keys to remove — with file path and line number, across `settings.json` and `.vscode/{wireferry,sftp}.json`. Buttons: open the file at the line, "Details" in the Output channel, "Fix `settings.json`" automatically (migrates `sftp.*` → `wireferry.*`, keeping the keys clustered), "Don't remind me" (`wireferry.suppressLegacyConfigNotice`).
- **Config rename** — if only `.vscode/sftp.json` remains, you're offered to rename it to `.vscode/wireferry.json`; declining (confirmed by typing `yes`) writes a `keepLegacyConfigFormat` marker into the config and stops the prompts.
- **Comments in configs (JSONC)** — `.vscode/{wireferry,sftp}.json` are now parsed as JSONC, so `//` comments are allowed. A fully-commented template is created and opened for a fresh project that has no config.
- **GitHub update check** — opt-in. You're asked once before the first request; on consent it makes **one** HTTPS GET to `api.github.com` for the latest release tag — no telemetry, nothing about you is sent. The background startup check only downloads the `.vsix` (you install it), while the **"WireFerry: Check for Updates"** command (palette and the Remote Explorer title bar) checks on demand and can download and install the update. Toggle with `wireferry.checkForUpdates`.
- **Alert language** — a new `wireferry.alertLanguage` setting (default English): WireFerry's own popups and prompts can be switched to Russian independently of the VS Code display language.
- **Report tab** — the config doctor also opens its findings in a persistent editor tab (with paths and line numbers) that stays open until you close it, so you can read and copy the paths at leisure (popups vanish too fast).

---

## 2.0.5 — Удаление по выбору · Choose where to delete

**Русский:** Удаление файла или папки из дерева сервера («Remote Explorer») теперь спрашивает, **где** удалять: **на сервере**, **на компьютере** или **и там и там** — вместо прежнего единственного «удалить и на сервере, и локально». Локальная копия по-прежнему уходит в Корзину ОС (не стирается безвозвратно). Создание папки с уже существующим именем теперь показывает понятное сообщение «папка уже существует» вместо сырого «Failure» от сервера — раньше так вёл себя только «создать файл», а «создать папку» падало с непонятной ошибкой. Сообщения об ошибках SFTP стали диагностируемее: общий код 4 («Failure») расшифровывается (цель уже существует / ФС только для чтения / нет места / превышена квота), а к тексту добавляются операция и путь. Обновлены руководства: README разделён на русский (`README.md`) и английский (`README.en.md`), добавлен `INSTALL.md`, актуализирован `FAQ.md`.

**English:** Deleting a file or folder from the server tree (Remote Explorer) now asks **where** to delete it: **on the server**, **on the computer**, or **on both** — instead of the previous single "delete on both the server and locally". The local copy still goes to the OS trash (not erased permanently). Creating a folder whose name already exists now shows a clear "folder already exists" message instead of the server's raw "Failure" — previously only "create file" behaved this way while "create folder" failed with a cryptic error. SFTP error messages are more diagnosable: the generic status 4 ("Failure") is decoded (target already exists / read-only filesystem / out of space / over quota) and the failing operation and path are appended. Manuals refreshed: the README is split into Russian (`README.md`) and English (`README.en.md`), an `INSTALL.md` was added, and `FAQ.md` was updated.

---

## 2.0.4 — Исправления · Bug fixes

**Русский:** Исправлена регрессия из 2.0.3: после перевода Windows-путей в нижний регистр (фикс UNC #589) проверка «локальный или удалённый путь» в правилах `ignore` стала регистрозависимой, из-за чего на Windows-путях со смешанным регистром (`C:\Users\…`) шаблоны `ignore` (`node_modules`, `.git` и пользовательские) могли не срабатывать, и лишние файлы выгружались на сервер — сравнение снова регистронезависимо. Протокол `local` добавлен в JSON-схему конфигурации (раньше валидный `"protocol": "local"` подчёркивался в редакторе). Документация: уточнено, что для `local` поля `host`/`username` не используются для соединения, но всё ещё обязательны для валидатора; примеры установки в README приведены к актуальной версии; убран висячий пункт оглавления FAQ.

**English:** Fixed a 2.0.3 regression: after Windows paths were lowercased (the UNC fix #589), the local-vs-remote check in the `ignore` rules became case-sensitive, so on mixed-case Windows paths (`C:\Users\…`) the `ignore` patterns (`node_modules`, `.git` and custom ones) could fail to match and extra files were uploaded to the server — the comparison is case-insensitive again. The `local` protocol is now part of the config JSON-schema (a valid `"protocol": "local"` was previously flagged in the editor). Docs: clarified that for `local` the `host`/`username` fields aren't used for the connection but are still required by the validator; README install examples point at the current version; removed a dangling FAQ table-of-contents entry.

---

## 2.0.3 — Исправления · Bug fixes

**Русский:** Исправлена выгрузка при сохранении (`uploadOnSave`) для файлов на сетевых/UNC-путях Windows (`\\сервер\share\…`): из-за регистра имени хоста сервис конфигурации не находился при сохранении и появлялось «Config Not Found» (#589). Команда **«Синхронизация»** теперь дожидается завершения удаления файлов и не сообщает об успехе раньше времени; `chmod` по `dirPerm` тоже ожидается и больше не теряет ошибки. Документация и JSON-схема настроек приведены в соответствие с кодом: протокол `local`, опции `passive` и `defaultProfile`, значение `"confirm"` у `downloadOnOpen`, принудительный `concurrency = 1` для FTP; убран дубль и неверные значения по умолчанию. Также убрана дублирующая настройка `wireferry.printDebugLog` — единственный переключатель отладки теперь `wireferry.debug`.

**English:** Fixed upload-on-save (`uploadOnSave`) for files on Windows network/UNC paths (`\\server\share\…`): a host-name case mismatch meant the config service wasn't found on save, surfacing as "Config Not Found" (#589). The **Sync** command now waits for file deletions to finish before reporting success; the `dirPerm` `chmod` is awaited too and no longer swallows errors. Documentation and the settings JSON-schema were aligned with the code: the `local` protocol, the `passive` and `defaultProfile` options, the `"confirm"` value for `downloadOnOpen`, the forced `concurrency = 1` for FTP; removed a duplicate section and incorrect defaults. The redundant `wireferry.printDebugLog` setting was also removed — `wireferry.debug` is now the single debug toggle.

---

## 2.0.2 — Русская локализация · Russian localization

**Русский:** Команды и настройки теперь отображаются на русском, если язык интерфейса VS Code — русский (палитра команд, контекстные меню, настройки). Добавлен пункт **«Открыть страницу расширения»** в контекстном меню сервера (рядом с «Открыть SSH в терминале»).

**English:** Commands and settings now appear in Russian when the VS Code display language is Russian (command palette, context menus, settings). Added an **"Open Extension Page"** item to the server context menu (next to "Open SSH in Terminal").

---

## 2.0.1 — Новая иконка панели · New panel icon

**Русский:** Обновлена иконка боковой панели (Activity Bar / «Remote Explorer»).

**English:** Updated the Activity Bar / "Remote Explorer" side-panel icon.

---

## 2.0.0 — Новое имя: WireFerry · Renamed to WireFerry

**Русский:** Расширение переименовано из «SFTP Link» в **WireFerry** — новое имя, иконка и отдельное пространство имён. Команды и настройки переехали с префикса `sftp.*` на `wireferry.*`, файл конфигурации теперь `.vscode/wireferry.json` (старый `.vscode/sftp.json` по-прежнему читается автоматически).

**English:** The extension has been renamed from "SFTP Link" to **WireFerry** — new name, icon and a distinct namespace. Commands and settings moved from the `sftp.*` prefix to `wireferry.*`, and the config file is now `.vscode/wireferry.json` (a legacy `.vscode/sftp.json` is still read automatically).

<details><summary><b>Подробности · Details</b></summary>

**Русский**

♻️ **Изменено**
- **Имя и идентификатор:** «SFTP Link» → **WireFerry**; id `EvgeniiShapovalov.sftp-link` → `EvgeniiShapovalov.wireferry`. Новая иконка.
- **Пространство команд и настроек:** все команды и параметры переехали с префикса `sftp.*` на `wireferry.*` (например, `sftp.upload` → `wireferry.upload`, настройка `sftp.debug` → `wireferry.debug`). Категория команд в палитре теперь «WireFerry».
- **Файл конфигурации:** основной файл теперь `.vscode/wireferry.json`; команда **WireFerry: Config** создаёт именно его.

⚠️ **Важно**
- **Старые проекты продолжают работать:** если в проекте есть старый `.vscode/sftp.json` (а нового нет) — он по-прежнему читается автоматически, переименовывать файл не обязательно.
- **Это новый идентификатор расширения** — авто-обновление со старого `sftp-link` не сработает: удалите старое расширение и установите `wireferry` (`.vsix` со страницы релизов).
- **Свои горячие клавиши и настройки под `sftp.*` обновите** на `wireferry.*` вручную (дефолтные уже обновлены).

**English**

♻️ **Changed**
- **Name and identifier:** "SFTP Link" → **WireFerry**; id `EvgeniiShapovalov.sftp-link` → `EvgeniiShapovalov.wireferry`. New icon.
- **Command and settings namespace:** every command and setting moved from the `sftp.*` prefix to `wireferry.*` (e.g. `sftp.upload` → `wireferry.upload`, the `sftp.debug` setting → `wireferry.debug`). The command-palette category is now "WireFerry".
- **Config file:** the primary file is now `.vscode/wireferry.json`; the **WireFerry: Config** command creates it.

⚠️ **Important**
- **Existing projects keep working:** if a project has a legacy `.vscode/sftp.json` (and no new one), it is still read automatically — renaming the file is optional.
- **This is a new extension identifier** — auto-update from the old `sftp-link` won't happen: uninstall the old extension and install `wireferry` (the `.vsix` from the releases page).
- **Update any custom `sftp.*` keybindings and settings** to `wireferry.*` manually (the defaults are already updated).

</details>

---

## 1.1.2 — Усиление безопасности · Security hardening

**Русский:** Технический релиз без новых функций: имена файлов, присланные сервером, проверяются перед записью на диск, а поля подключения — перед открытием SSH в терминале.

**English:** A maintenance release with no new features: filenames returned by the server are validated before being written to disk, and connection fields are validated before opening SSH in a terminal.

<details><summary><b>Подробности · Details</b></summary>

**Русский**

🔒 **Безопасность**
- **Защита от path traversal при загрузке.** Записи в списке файлов от сервера, чьё имя содержит `..` или разделители путей, теперь отклоняются (и логируются). Раньше вредоносный или скомпрометированный SFTP/FTP-сервер теоретически мог прислать запись вроде `../../file` и при загрузке записать файл за пределами выбранной папки.
- **Усиление команды «Open SSH in Terminal».** Поля подключения (`host`, `username`, `port`, `privateKeyPath`, `sshCustomParams`) проверяются перед формированием команды; строки с shell-метасимволами отклоняются с понятной ошибкой. Это закрывает подстановку команд через недоверенный `.vscode/sftp.json`.

**English**

🔒 **Security**
- **Path-traversal guard on download.** Server-supplied listing entries whose name contains `..` or a path separator are now rejected (and logged). Previously a malicious or compromised SFTP/FTP server could return an entry like `../../file` and, on download, write outside the chosen folder.
- **Hardened "Open SSH in Terminal".** Connection fields (`host`, `username`, `port`, `privateKeyPath`, `sshCustomParams`) are validated before the command is built; values containing shell metacharacters are refused with a clear error. This closes command substitution via an untrusted `.vscode/sftp.json`.

</details>

---

## 1.1.1 — Переименование и перемещение файлов

**Русский:** Теперь можно переименовать файл/папку на сервере через правый клик в Remote Explorer. А если переименовать или перетащить файл в другую папку локально — расширение спросит и применит то же на сервере. Внутри дерева сервера файлы можно перетаскивать между папками мышью.

**English:** You can now rename a file/folder on the server via right-click in the Remote Explorer. Rename or drag a file to another folder locally and the extension asks, then applies the same on the server. Inside the server tree, drag files between folders with the mouse.

<details><summary><b>Подробности · Details</b></summary>

**Русский**

✨ **Добавлено**
- **«Rename» в контекстном меню Remote Explorer** — переименование файла/папки на сервере; локальная копия (если есть) переименовывается тоже.
- **Авто-синхрон переименования/переноса** — при переименовании или перетаскивании файла в другую папку в обычном проводнике VS Code расширение спрашивает подтверждение и применяет ту же операцию на сервере (через `workspace.onDidRenameFiles`).
- **Drag&drop в дереве Remote Explorer** — перетаскивание файла/папки между папками сервера переносит их и на сервере, и локально (после подтверждения).

♻️ **Изменено**
- Полностью переписан обработчик переименования (`renameRemote`) — прежняя версия путала локальные и удалённые пути, из-за чего синхронизация git-переименований работала некорректно.

🔧 **Стабилизация**
- **Большое обновление зависимостей и инструментария.** TypeScript 3.9 → 5, `@types/node` 9 → 18, `@types/vscode` 1.40 → 1.66, jest 29.0 → 29.7, webpack-cli 4 → 5, а также безопасные обновления (`async`, `ignore`, `tmp`, `ts-loader`, `webpack`, `memfs`). Это убирает застарелый разнобой версий, из-за которого сборка и проверка типов вели себя непредсказуемо, и закладывает базу под дальнейшую поддержку: `tsc --noEmit` теперь проходит без ошибок, тесты снова рабочие. Намеренно отложены до отдельного релиза рискованные мажоры (`joi`, `lru-cache`, `fs-extra`, замена заброшенного `ftp`), а `p-queue` зафиксирован (новые версии — только ESM). **Минимальная версия VS Code теперь 1.66** — нужна для стабильного drag&drop в дереве.
- Защита от path traversal в новом имени (`.`/`..` и разделители путей отклоняются); перенос между разными профилями блокируется; перед операцией проверяется, не занята ли цель (чтобы не было «полу-применённых» переименований — на сервере переименовано, а локально нет); операции в «Upload Changed Files» теперь корректно ожидаются.

**English**

✨ **Added**
- **"Rename" in the Remote Explorer context menu** — rename a file/folder on the server; the local copy (if any) is renamed too.
- **Automatic rename/move sync** — renaming or dragging a file to another folder in the regular VS Code Explorer asks for confirmation, then applies the same operation on the server (via `workspace.onDidRenameFiles`).
- **Drag&drop in the Remote Explorer tree** — dragging a file/folder between server folders moves it both on the server and locally (after a confirmation).

♻️ **Changed**
- The rename handler (`renameRemote`) was rewritten — the previous version mixed up local and remote paths, so git-rename sync worked incorrectly.

🔧 **Stability**
- **Large dependency & toolchain update.** TypeScript 3.9 → 5, `@types/node` 9 → 18, `@types/vscode` 1.40 → 1.66, jest 29.0 → 29.7, webpack-cli 4 → 5, plus safe bumps (`async`, `ignore`, `tmp`, `ts-loader`, `webpack`, `memfs`). This clears the stale version mismatch that made the build and type-checking behave unpredictably and lays a base for future maintenance: `tsc --noEmit` now passes clean and the tests work again. Risky majors (`joi`, `lru-cache`, `fs-extra`, replacing the abandoned `ftp`) were deliberately deferred to a separate release, and `p-queue` is pinned (newer versions are ESM-only). **The minimum VS Code version is now 1.66** — required for stable in-tree drag&drop.
- Path-traversal guard on the new name (`.`/`..` and path separators are rejected); cross-profile moves are blocked; a destination-exists preflight runs before the operation (no "half-applied" renames where the server is renamed but the local copy is not); operations in "Upload Changed Files" are now properly awaited.

</details>

---

## 1.0.9 — Открыть файл на сервере по пути

**Русский:** Вставьте полный путь к файлу — дерево само раскроется до него, файл скачается и откроется на редактирование.

**English:** Paste a file's full server path — the tree expands to it, then it's downloaded and opened for editing.

<details><summary><b>Подробности · Details</b></summary>

**Русский**

✨ **Добавлено**
- **Кнопка «Open Remote File by Path»** на панели Remote Explorer (слева от «Обновить дерево»). Принимает абсолютный путь (например `/etc/acpi/handler.sh`) и относительный (от корня профиля); при нескольких профилях нужный выбирается автоматически по пути либо предлагается списком.

♻️ **Изменено**
- Заголовок секции Remote Explorer теперь показывает **только номер версии** (контейнер и так подписан «SFTP»).

📝 **Примечание**
- Путь, скрытый настройкой `remoteExplorer.filesExclude` (по умолчанию `.git`, `.svn`, `.hg`, `CVS`, `.DS_Store`), считается недостижимым — кнопка сообщит «not found».

**English**

✨ **Added**
- **"Open Remote File by Path" button** in the Remote Explorer toolbar (left of Refresh). Accepts an absolute path (e.g. `/etc/acpi/handler.sh`) or a relative one (from the profile root); with multiple profiles the right one is auto-picked from the path or offered as a list.

♻️ **Changed**
- The Remote Explorer section title now shows **just the version number** (the container is already labelled "SFTP").

📝 **Note**
- A path hidden by `remoteExplorer.filesExclude` (default `.git`, `.svn`, `.hg`, `CVS`, `.DS_Store`) is treated as unreachable — the button reports "not found".

</details>

---

## 1.0.8 — Новое имя: «SFTP Link»

**Русский:** Расширение переименовано из «SFTP Sync» в «SFTP Link». Настройки и команды не изменились.

**English:** The extension was renamed from "SFTP Sync" to "SFTP Link". Settings and commands are unchanged.

<details><summary><b>Подробности · Details</b></summary>

**Русский**

♻️ **Изменено**
- **Отображаемое имя «SFTP Sync» → «SFTP Link»** — в панели «Расширения», строке состояния и README. (Идентификатор пакета стал `sftp-link` ещё в 1.0.7.)

📝 **Прочее**
- README: статус Marketplace заменён с «pending» на ссылку на опубликованную страницу; README теперь ведёт на этот CHANGELOG.
- LICENSE: добавлен копирайт Evgenii Shapovalov; исходный копирайт Natizyskunk сохранён (по условиям MIT).

**English**

♻️ **Changed**
- **Display name "SFTP Sync" → "SFTP Link"** — in the Extensions panel, the status bar and the README. (The package id became `sftp-link` back in 1.0.7.)

📝 **Other**
- README: the Marketplace status changed from "pending" to the live listing link; the README now points to this CHANGELOG.
- LICENSE: added the Evgenii Shapovalov copyright; the original Natizyskunk notice is kept (per the MIT terms).

</details>

---

## 1.0.7 — Смена идентификатора (важно при обновлении)

**Русский:** Идентификатор расширения изменён на `sftp-link`. Если вы ставили раннюю сборку — переустановите вручную (детали внутри).

**English:** The extension id changed to `sftp-link`. If you installed an early build, reinstall manually (details inside).

<details><summary><b>Подробности · Details</b></summary>

**Русский**

⚠️ **Важно — миграция**
- **Идентификатор изменён `sftp-sync` → `sftp-link`** (slug `sftp-sync` был занят). Авто-обновление со старого id не сработает — удалите старое расширение и установите `EvgeniiShapovalov.sftp-link` вручную. Файлы `.vscode/sftp.json` и все настройки/команды `sftp.*` переносить не нужно — они не изменились.

📝 **Прочее**
- Убраны отладочные трейсы из Remote Explorer (на поведение не влияет).

**English**

⚠️ **Important — migration**
- **Id changed `sftp-sync` → `sftp-link`** (the `sftp-sync` slug was taken). Auto-update from the old id won't work — uninstall the old extension and install `EvgeniiShapovalov.sftp-link` manually. Your `.vscode/sftp.json` and all `sftp.*` settings/commands are unaffected.

📝 **Other**
- Removed debug traces from the Remote Explorer (no behaviour change).

</details>

---

## 1.0.6 — Созданный файл сразу виден в дереве

**Русский:** Раньше созданный на сервере файл не появлялся в дереве (операция подвисала). Теперь появляется сразу.

**English:** A file created on the server used to stay missing from the tree (the operation hung). It now appears immediately.

<details><summary><b>Подробности · Details</b></summary>

**Русский**

🐛 **Исправлено**
- Создание пустого файла зависало: `ssh2` не присылает событие `finish` при нулевой записи — теперь операция завершается также по событию `close`. (Папки были исправлены в 1.0.4; промежуточный шаг — 1.0.5.)

**English**

🐛 **Fixed**
- Creating an empty file used to hang: `ssh2` doesn't emit `finish` on a zero-byte write — the operation now also completes on `close`. (Folders were fixed in 1.0.4; interim step in 1.0.5.)

</details>

---

## 1.0.5 — внутренняя итерация

**Русский:** Технический шаг к исправлению создания файлов; видимый результат — в 1.0.6.

**English:** Internal step toward the file-creation fix; the visible result landed in 1.0.6.

---

## 1.0.4 — Созданная папка сразу видна в дереве

**Русский:** Новая папка теперь появляется в дереве и выделяется сразу — без ручного «Обновить».

**English:** A new folder now appears in the tree and gets selected right away — no manual Refresh.

<details><summary><b>Подробности · Details</b></summary>

**Русский**

🐛 **Исправлено**
- Дерево активно раскрывается до нового узла (`reveal`), а не ждёт пассивного обновления. (Для файлов фикс завершён в 1.0.6.)

**English**

🐛 **Fixed**
- The tree actively expands to the new node (`reveal`) instead of waiting for a passive update. (Files were finished in 1.0.6.)

</details>

---

## 1.0.3 — внутренняя итерация

**Русский:** Промежуточный шаг механизма показа созданных элементов; видимый результат — в 1.0.4/1.0.6.

**English:** Interim step of the "show created entry" mechanism; the visible result landed in 1.0.4/1.0.6.

---

## 1.0.2 — Команда «Copy Path»

**Русский:** Добавлена команда «Copy Path» — копирует серверный путь файла или папки в буфер обмена.

**English:** New "Copy Path" command — copies a file/folder's server-side path to the clipboard.

<details><summary><b>Подробности · Details</b></summary>

**Русский**

✨ **Добавлено**
- **Команда «Copy Path»** в контекстном меню Remote Explorer — серверный путь в буфер обмена.
- **В шапке панели Remote Explorer** показываются издатель и номер версии — удобный маркер активной сборки.

🐛 **Исправлено**
- **Корректное построение пути создаваемого файла/папки.** У remote-URI путь хранится в query, и прежняя склейка строк его портила (ломая обновление дерева) — теперь путь собирается через `UResource`/`upath.join`.

📝 **Прочее**
- README: добавлена родословная форка (Natizyskunk ← liximomo). Поправлены примеры настроек (префикс `sftp.`) и FTP-конфиг (`"secure": "control"`).

**English**

✨ **Added**
- **"Copy Path" command** in the Remote Explorer context menu — server-side path to the clipboard.
- **The Remote Explorer panel title** shows the publisher and version — a handy indicator of the loaded build.

🐛 **Fixed**
- **Correct path building for newly created files/folders.** A remote URI keeps its path in the query, and the old string concatenation corrupted it (breaking the tree refresh) — the path is now built via `UResource`/`upath.join`.

📝 **Other**
- README: added the fork lineage (Natizyskunk ← liximomo). Fixed settings examples (`sftp.` prefix) and the FTP config (`"secure": "control"`).

</details>

---

## 1.0.1 — `ignore` на Windows + безопасное удаление

**Русский:** Фильтр `ignore` заработал на Windows; удаление в Remote Explorer теперь отправляет локальную копию в Корзину.

**English:** The `ignore` filter now works on Windows; Remote Explorer "Delete" sends the local copy to the Trash.

<details><summary><b>Подробности · Details</b></summary>

**Русский**

🐛 **Исправлено**
- **`ignore` теперь работает на Windows.** Раньше шаблоны папок (`node_modules`, `.git`) не срабатывали из-за обратных слешей — *Upload Project* мог залить `node_modules` на сервер, а *Sync* с `delete` молча пропускал фильтр. Теперь пути POSIX-стиля.

♻️ **Изменено**
- **Удаление в Remote Explorer отправляет локальную копию в Корзину** (`useTrash`), а не стирает безвозвратно.

**English**

🐛 **Fixed**
- **`ignore` now works on Windows.** Folder patterns like `node_modules` / `.git` didn't match because of backslashes — *Upload Project* could push `node_modules` to the server and *Sync* with `delete` silently skipped the filter. Paths are POSIX-style now.

♻️ **Changed**
- **Remote Explorer "Delete" sends the local copy to the OS Trash** (`useTrash`) instead of deleting permanently.

</details>

---

## 1.0.0 — Первый релиз форка: работает на Node 22+, безопасное удаление

**Русский:** Старт независимого форка. Главное: расширение снова работает на современном Node, а удаление файлов стало безопасным.

**English:** Start of the independent fork. Headline: the extension works on modern Node again, and file deletion is now safe.

<details><summary><b>Подробности · Details</b></summary>

**Русский**

> Форк расширения **`sftp` (Natizyskunk) v1.16.3** (которое само — форк `liximomo/vscode-sftp`). Версия намеренно сброшена на `1.0.0` — новый старт под новым издателем [@e-u-shapovalov](https://github.com/e-u-shapovalov). Богатый набор функций унаследован от v1.16.3; этот релиз делает их пригодными к работе на современном Node и делает удаление безопасным.

🐛 **Исправлено**
- **Заработало на Node 22+.** `ssh2` поднят `1.13.0 → 1.17.0`: в Node 22 удалён `util.isDate`, из-за чего любое скачивание/загрузка/создание папки падало с `TypeError: isDate is not a function` ([microsoft/vscode#319963](https://github.com/microsoft/vscode/issues/319963)).
- **«Delete» снова работает** — подтверждение было немодальным и тихо отменяло команду; теперь модальное.
- **Кнопка обновления показывает новые/удалённые файлы** — обновляется всё дерево, а не только выделение.

♻️ **Изменено**
- **«Delete» удаляет и локальную копию** — с модальным вопросом «удалить и на сервере, и локально?». (Отправку копии в Корзину добавили в 1.0.1.)
- **Удаления через VS Code синхронизируются с сервером** (`onDidDeleteFiles`) — с вопросом; внешние удаления сервер не трогают.

⚠️ **Важно**
- **Убрана опция `watcher.autoDelete`** — она молча удаляла файлы на сервере при *любом* локальном удалении. Её безопасно заменяет синхронизация выше.

🔧 **Стабилизация (под капотом)**
- Восстановлены обработчики разрыва SFTP-соединения (`.on('close'/'end', () => this.end())`).
- Проект приведён в собираемое состояние (`toRemotePath` через `URI`; импорт `COMMAND_UPLOAD_*_TO_ALL_PROFILES`). *Это правки этапа сборки форка, а не баги upstream — v1.16.3 собирается.*

📦 **Унаследовано от v1.16.3** (не ново, но доступно)
- Remote Explorer, Diff with Remote, Sync в трёх направлениях, Upload/Download, Upload on save, File Watcher, мульти-профиль (включая «… To All Profiles»), Open SSH in Terminal, connection hopping, права `filePerm`/`dirPerm`, строка состояния. *Поверх «To All Profiles» форк добавил подтверждающий диалог.*

**English**

> A fork of the **`sftp` (Natizyskunk) v1.16.3** extension (itself a fork of `liximomo/vscode-sftp`). The version is intentionally reset to `1.0.0` as a fresh start under a new publisher, [@e-u-shapovalov](https://github.com/e-u-shapovalov). The rich feature set is inherited from v1.16.3; this release makes it work on modern Node and makes deletion safe.

🐛 **Fixed**
- **Works on Node 22+.** `ssh2` bumped `1.13.0 → 1.17.0`: Node 22 removed `util.isDate`, so every download/upload/create-folder crashed with `TypeError: isDate is not a function` ([microsoft/vscode#319963](https://github.com/microsoft/vscode/issues/319963)).
- **"Delete" works again** — the confirmation was non-modal and silently aborted the command; it's modal now.
- **Refresh shows newly created/removed files** — it refreshes the whole tree, not just the selection.

♻️ **Changed**
- **"Delete" also removes the local copy** — behind a modal "delete on both the server and locally?" prompt. (Sending the copy to the Trash was added in 1.0.1.)
- **Deletions made through VS Code sync to the server** (`onDidDeleteFiles`) — with a prompt; external deletions never touch the server.

⚠️ **Important**
- **Removed the `watcher.autoDelete` option** — it silently deleted server files on *any* local deletion. The sync above replaces it safely.

🔧 **Stability (under the hood)**
- Restored SFTP disconnect handlers (`.on('close'/'end', () => this.end())`).
- Brought the project to a buildable state (`toRemotePath` via `URI`; the `COMMAND_UPLOAD_*_TO_ALL_PROFILES` import). *These are fork build-stage fixes, not upstream bugs — v1.16.3 compiles.*

📦 **Inherited from v1.16.3** (not new, but available)
- Remote Explorer, Diff with Remote, three-direction Sync, Upload/Download, Upload on save, File Watcher, multi-profile (incl. "… To All Profiles"), Open SSH in Terminal, connection hopping, `filePerm`/`dirPerm`, status bar. *The fork added a confirmation dialog before "To All Profiles" uploads.*

</details>
