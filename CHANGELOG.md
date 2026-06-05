## 1.0.1 - 2026-06-06

### Русский
**Исправления**
* **`ignore` теперь работает на Windows.** Локальный относительный путь строился через `path.relative` (обратные слеши), а пакет `ignore` понимает только POSIX-пути — поэтому шаблоны папок (`node_modules`, `.git`) не срабатывали: *Upload Project* мог залить `node_modules` на сервер, а *Sync* с `delete` молча пропускал фильтр. Теперь используется `upath` (прямые слеши), как в remote-ветке.

**Изменения**
* **Удаление в Remote Explorer перемещает локальную копию в корзину** (`useTrash`), а не стирает безвозвратно — случайное удаление можно восстановить.

### English
**Fixes**
* **`ignore` now works on Windows.** The local relative path was built with `path.relative` (backslashes), but the `ignore` package is POSIX-only, so directory patterns like `node_modules` / `.git` never matched — *Upload Project* could push `node_modules` to the server and *Sync* with `delete` silently skipped the filter. Now uses `upath` (forward slashes), matching the remote branch.

**Changes**
* **Remote Explorer "Delete" moves the local copy to the OS trash** (`useTrash`) instead of deleting it permanently, so an accidental delete is recoverable.

## 1.0.0 - 2026-06-06

### Русский
Первый релиз форка **SFTP Sync**, поддерживается независимо [@e-u-shapovalov](https://github.com/e-u-shapovalov). Версия намеренно сброшена на `1.0.0` — новый старт под новым издателем.

**Исправления**
* **Падение скачивания/загрузки/создания папки на Node 22+** — встроенный `ssh2` обновлён до `1.17.0`. В Node 22 удалили устаревший `util.isDate`, на который опирался `ssh2 1.13.0` (`TypeError: isDate is not a function`).
* **«Delete» в Remote Explorer ничего не делал** — подтверждение было немодальным уведомлением, которое тихо возвращало `undefined`, и команда отменялась с «missing targets». Теперь подтверждения модальные.
* **Кнопка обновления не показывала новые/удалённые файлы на сервере** — обновлялся только выделенный узел; теперь обновляется всё дерево.
* **Исправлены две существовавшие ошибки сборки**, из-за которых проект вообще не компилировался (`toRemotePath` передавал `string` вместо `URI`; отсутствовал импорт `COMMAND_UPLOAD_*_TO_ALL_PROFILES`).
* **SFTP-соединение не могло зарегистрировать обработчики разрыва** — `.on('close', this.end())` вызывал `end()` сразу и передавал `undefined` как слушатель (`TypeError`). Теперь `() => this.end()`.

**Изменения**
* **«Delete» в Remote Explorer теперь удаляет и локальную копию**, с понятным подтверждением «удалить и на сервере, и локально?».
* **Удаления через VS Code синхронизируются с сервером** — при удалении файла через проводник VS Code спрашивается, удалить ли его и на сервере. Через `onDidDeleteFiles`, поэтому внешние удаления (вне VS Code) сервер не трогают.
* **Убрана опция `watcher.autoDelete`** — она молча удаляла файлы на сервере при *любом* локальном удалении (включая внешние), что было неожиданно и опасно. Её заменяет синхронизация удаления через VS Code выше.

### English
First release of the **SFTP Sync** fork, maintained independently by [@e-u-shapovalov](https://github.com/e-u-shapovalov). The version is intentionally reset to `1.0.0` as a fresh start under a new publisher.

**Fixes**
* **Download/upload/create-folder crashed on Node 22+** — bundled `ssh2` upgraded to `1.17.0`. Node 22 removed the legacy `util.isDate` that `ssh2 1.13.0` relied on (`TypeError: isDate is not a function`).
* **"Delete" in the Remote Explorer did nothing** — the confirmation was a non-modal notification that silently resolved to `undefined`, so the command aborted with "missing targets". Confirmations are now modal.
* **Refresh button missed newly created/removed server files** — the toolbar refresh only refreshed the current selection; it now refreshes the whole tree.
* **Two pre-existing build errors fixed** that prevented the project from compiling at all (`toRemotePath` passed a `string` where a `URI` was expected; a missing `COMMAND_UPLOAD_*_TO_ALL_PROFILES` import).
* **SFTP connection couldn't register its disconnect handlers** — `.on('close', this.end())` called `end()` immediately and passed `undefined` as the listener (`TypeError`). Now wired as `() => this.end()`.

**Changes**
* **Remote Explorer "Delete" now also removes the local copy**, with a clear "delete on both the server and locally?" confirmation.
* **Deletions made through VS Code now sync to the server** — deleting a file via the VS Code Explorer asks whether to delete it on the server too. Implemented with `onDidDeleteFiles`, so external/file-system deletions never touch the server.
* **Removed the `watcher.autoDelete` option** — it silently deleted files on the server on *any* local deletion (including external ones), which was surprising and risky. The VS Code-scoped deletion sync above replaces it.
