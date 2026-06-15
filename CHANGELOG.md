# Changelog

> **WireFerry** — независимо поддерживаемый форк [vscode-sftp](https://github.com/Natizyskunk/vscode-sftp) (Natizyskunk ← liximomo).
> Сверху — коротко о новом простым языком; технические детали каждого релиза спрятаны в блок **«Подробности»** (нажмите, чтобы развернуть).
> _Plain-language highlights up top; per-release specifics are tucked into **"Details"**. Russian first, then English._

## ✨ Что нового · What's New

**Русский — коротко**
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

**English — in short**
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
