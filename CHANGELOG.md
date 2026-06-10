# Changelog

> **WireFerry** — независимо поддерживаемый форк [vscode-sftp](https://github.com/Natizyskunk/vscode-sftp) (Natizyskunk ← liximomo).
> Сверху — коротко о новом простым языком; технические детали каждого релиза спрятаны в блок **«Подробности»** (нажмите, чтобы развернуть).
> _Plain-language highlights up top; per-release specifics are tucked into **"Details"**. Russian first, then English._

## ✨ Что нового · What's New

**Русский — коротко**
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

**English — in short**
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
