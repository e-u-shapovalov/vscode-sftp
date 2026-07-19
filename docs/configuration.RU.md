# Справочник конфигурации WireFerry

[English version](configuration.md) · [Основной README](../README.RU.md) · [Команды](commands.RU.md) · [FAQ](../FAQ.RU.md)

WireFerry хранит конфигурацию проекта в `.vscode/wireferry.json`. Legacy-файлы `.vscode/sftp.json` продолжают читаться, но в новых проектах следует использовать `wireferry.json`.

Формат — JSONC: разрешены комментарии `//` и `/* ... */`, а также завершающие запятые. VS Code проверяет известные поля по схемам из `schema/`.

## Создание и открытие конфигурации

Откройте папку проекта, нажмите `Ctrl+Shift+P` и выполните **WireFerry: Config**.

- Если конфига нет, мастер запросит параметры SFTP или FTP, проверит вход и запишет `.vscode/wireferry.json`.
- Если текущий или legacy-конфиг уже существует, команда откроет его.
- FTPS, `local`, профили, jump hosts и расширенные настройки передачи редактируются в файле после первоначальной настройки.

## Базовые примеры

### SFTP

```json
{
  "name": "Production",
  "host": "example.com",
  "protocol": "sftp",
  "port": 22,
  "username": "deploy",
  "password": "prompt",
  "remotePath": "/var/www/site",
  "context": "./",
  "uploadOnSave": false,
  "ignore": [".vscode", ".git", "node_modules"]
}
```

### FTP или FTPS

```json
{
  "name": "Hosting",
  "host": "ftp.example.com",
  "protocol": "ftp",
  "port": 21,
  "username": "account",
  "password": "prompt",
  "remotePath": "/public_html",
  "secure": true
}
```

Для обычного FTP не задавайте `secure` или установите `false`. Режимы FTPS описаны в разделе [`secure`](#поля-ftp-и-ftps).

### Локальное зеркало

```json
{
  "name": "Local mirror",
  "protocol": "local",
  "context": "./build",
  "remotePath": "/absolute/path/to/preview"
}
```

`local` использует другую папку на том же компьютере. `host`, `username` и серверные учётные данные для него не нужны. Используйте абсолютный `remotePath`, чтобы папка назначения не зависела от рабочего каталога extension host.

## Сопоставление путей

`context` — локальный корень; относительный путь считается от открытого workspace. `remotePath` — соответствующий корень на сервере или каталог назначения для `local`.

При `"context": "./build"` и `"remotePath": "/var/www/site"` локальный файл `build/css/app.css` соответствует `/var/www/site/css/app.css`.

Перед выгрузкой или синхронизацией проекта проверьте оба пути.

## Общие поля

| Поле | Тип | Runtime default | Назначение |
| --- | --- | --- | --- |
| `name` | string | — | Подпись в строке состояния и Remote Explorer |
| `protocol` | `sftp`, `ftp`, `local` | `sftp` | Тип подключения или зеркала |
| `context` | string | корень workspace | Локальный корень, сопоставленный с `remotePath` |
| `remotePath` | string | `./` | Удалённый корень или каталог назначения для `local` |
| `host` | string | — | Хост или IP сервера; обязателен для SFTP/FTP |
| `port` | integer | default протокола/клиента | Порт сервера |
| `username` | string | — | Имя пользователя; обязательно для SFTP/FTP |
| `connectTimeout` | integer | `10000` | Таймаут подключения в миллисекундах |
| `uploadOnSave` | boolean | `false` | Выгружать файлы при сохранении в VS Code |
| `downloadOnOpen` | boolean или `"confirm"` | `false` | Заменять открываемый локальный файл удалённой копией |
| `concurrency` | integer, 1–512 | `4` | Число параллельных передач; для FTP всегда принудительно `1` |
| `useTempFile` | boolean | `true` | Писать рядом с целью и затем переименовывать файл на место |
| `openSsh` | boolean | `false` | Использовать поведение OpenSSH rename при подмене временного файла |
| `filePerm` | number | — | Восьмеричные права выгружаемых и создаваемых файлов, например `644` |
| `dirPerm` | number | — | Восьмеричные права выгружаемых и создаваемых каталогов, например `755` |
| `maxFileSize` | number | выключено | Пропускать более крупные файлы в пакетных операциях; единица — MB |
| `limitOpenFilesOnRemote` | boolean или number | выключено | Ограничить открытые операции на сервере; только для подтверждённого лимита |
| `remoteTimeOffsetInHours` | number | `0` | Поле есть в конфиге, но конвейер передачи сейчас его не применяет |

`maxFileSize` не блокирует явно выбранную передачу одного файла. Значение `0` или отсутствие поля отключает фильтр размера.

При `useTempFile: false` WireFerry пишет прямо поверх цели, обнуляя её до поступления новых данных; прерванная передача теряет оригинал. Оставляйте значение по умолчанию `true`, если нет конкретной причины его отключать.

## Авторизация

### Пароли

`password` принимает:

- `"secretStorage"` — хранить и читать пароль через VS Code SecretStorage;
- `"prompt"` — спрашивать при каждом подключении без сохранения;
- обычную строку — использовать значение из конфига открытым текстом.

Не коммитьте учётные данные открытым текстом.

### SFTP-ключи

| Поле | Тип | Назначение |
| --- | --- | --- |
| `privateKeyPath` | string | Путь к приватному ключу; поддерживаются `~` и пути от workspace |
| `passphrase` | string или `true` | Открытый passphrase, `"secretStorage"` или `true` для запроса |
| `agent` | string | Сокет SSH-agent; в Windows поддерживается `pageant` |
| `interactiveAuth` | boolean или string array | Интерактивная авторизация с клавиатуры или готовые ответы |
| `sshConfigPath` | string | Файл SSH config; по умолчанию `~/.ssh/config` |

В контекстном меню сервера можно создать и развернуть SSH-ключ, сохранить пароль через SecretStorage или удалить сохранённые данные.

### SSH jump hosts

Для SFTP поле `hop` принимает один jump host или массив в порядке от первого bastion до последнего перехода перед целевым сервером:

```json
{
  "name": "Internal server",
  "host": "10.0.0.20",
  "protocol": "sftp",
  "port": 22,
  "username": "deploy",
  "password": "prompt",
  "remotePath": "/srv/app",
  "hop": {
    "host": "bastion.example.com",
    "port": 22,
    "username": "jump-user",
    "privateKeyPath": "~/.ssh/bastion_ed25519"
  }
}
```

Учётные данные jump host не хранятся в SecretStorage. Обычный пароль hop остаётся в файле открытым текстом; `"prompt"` и `"secretStorage"` внутри hop оба обрабатываются как запрос пароля.

## Профили и несколько серверов

`profiles` содержит альтернативные значения, которые накладываются на верхний уровень:

```json
{
  "name": "Website",
  "protocol": "sftp",
  "port": 22,
  "username": "deploy",
  "password": "prompt",
  "remotePath": "/var/www/site",
  "uploadOnSave": true,
  "profiles": {
    "staging": {
      "host": "staging.example.com"
    },
    "production": {
      "host": "example.com",
      "uploadOnSave": false
    }
  },
  "defaultProfile": "staging"
}
```

- Профиль наследует поля, которые в нём не заданы.
- `defaultProfile` выбирает начальный активный профиль.
- По умолчанию каждый профиль также виден отдельным корнем в Remote Explorer.
- Действие на корне профиля использует подключение этого профиля.
- У команд выгрузки есть варианты **To All Profiles / Во все профили**.
- При сохранении WireFerry выгружает файл во все профили, у которых итоговый `uploadOnSave` равен `true`.

Чтобы настроить независимые серверы, а не профили одной конфигурации, сделайте весь файл массивом:

```json
[
  {
    "name": "Server A",
    "host": "a.example.com",
    "username": "deploy",
    "password": "prompt",
    "remotePath": "/srv/a"
  },
  {
    "name": "Server B",
    "host": "b.example.com",
    "username": "deploy",
    "password": "prompt",
    "remotePath": "/srv/b"
  }
]
```

## Правила исключения

`ignore` использует gitignore-совместимые шаблоны относительно `context` локально и `remotePath` на сервере:

```json
{
  "ignore": [
    ".vscode",
    ".git",
    "node_modules",
    "*.log"
  ]
}
```

В конфиг, написанный вручную, исключения автоматически не добавляются. Мастер записывает `.vscode`, `.git` и `.DS_Store` в создаваемую им конфигурацию.

Чтобы загрузить дополнительные правила из файла:

```json
{
  "ignoreFile": ".gitignore"
}
```

`ignoreFile` может быть абсолютным или считаться от workspace. Пока поле не задано, файл не читается.

## Наблюдение за внешними изменениями

`uploadOnSave` обрабатывает сохранения из VS Code. `watcher` может реагировать на изменения внешних программ:

```json
{
  "uploadOnSave": false,
  "watcher": {
    "files": "**/*",
    "autoUpload": true
  }
}
```

`watcher.files` — строка glob. Не сопоставляйте одни файлы обоими автоматическими механизмами, если повторные выгрузки нежелательны.

## Синхронизация

`syncOption` меняет поведение **Sync Local -> Remote** и **Sync Remote -> Local**:

```json
{
  "syncOption": {
    "delete": false,
    "skipCreate": false,
    "ignoreExisting": false,
    "update": true
  }
}
```

| Поле | Действие |
| --- | --- |
| `delete` | Удалять в приёмнике элементы, которых нет в источнике |
| `skipCreate` | Не создавать в приёмнике элементы, которые есть только в источнике |
| `ignoreExisting` | Не изменять элементы, уже существующие в приёмнике |
| `update` | Заменять существующий элемент, только если версия источника новее |

Источник и приёмник зависят от выбранного направления. **Sync Both Directions** сравнивает обе стороны; для этой команды применяются только `skipCreate` и `ignoreExisting`.

Сначала проверяйте удаление и перезапись на некритичных данных.

## Remote Explorer

Поля `remoteExplorer` в конфигурации проекта:

```json
{
  "remoteExplorer": {
    "filesExclude": ["*.log", "cache"],
    "order": 10
  }
}
```

| Поле | Действие |
| --- | --- |
| `filesExclude` | Только скрывает совпавшие элементы в дереве; на передачу не влияет |
| `order` | Сортирует сервер среди других корней; меньшие числа идут первыми |

## Поля только для SFTP

### `algorithms`

`algorithms` заменяет или корректирует транспортные алгоритмы SSH. Предпочитайте `append`, `prepend` или `remove`, чтобы сохранить современные default:

```json
{
  "algorithms": {
    "kex": {
      "append": ["diffie-hellman-group1-sha1"]
    }
  }
}
```

Поддерживаются группы `kex`, `cipher`, `serverHostKey` и `hmac`. Устаревшие алгоритмы следует включать только для сервера, которому они необходимы.

### `sshCustomParams`

Дополнительные параметры команды **Open SSH in Terminal**:

```json
{
  "sshCustomParams": "-v"
}
```

Поле влияет на терминальную команду, но не на подключение SFTP-библиотеки.

## Поля FTP и FTPS

| Поле | Тип | Назначение |
| --- | --- | --- |
| `secure` | boolean, `"control"` или `"implicit"` | `true` шифрует control и data; `"control"` — только control; `"implicit"` включает implicit FTPS |
| `secureOptions` | object | Дополнительные параметры для Node.js `tls.connect()` |
| `passive` | boolean | Использовать пассивные data-подключения FTP |

Для FTP concurrency всегда принудительно равен `1`.

## Настройки VS Code

Эти значения задаются в настройках VS Code, а не в `.vscode/wireferry.json`:

| Настройка | Default | Назначение |
| --- | --- | --- |
| `wireferry.debug` | `false` | Подробные логи в Output |
| `wireferry.downloadWhenOpenInRemoteExplorer` | `true` | Скачать удалённый файл перед открытием; `false` открывает read-only preview |
| `wireferry.checkForUpdates` | legacy no-op | Сохранена, чтобы старые пользовательские настройки оставались валидными; обновления из Marketplace обрабатывает VS Code |
| `wireferry.suppressLegacyConfigNotice` | `false` | Скрыть уведомления о legacy-миграции |
| `wireferry.alertLanguage` | `en` | Язык уведомлений WireFerry: `en` или `ru` |
| `wireferry.remoteExplorer.showSize` | `false` | Показывать размеры файлов и папок в дереве |
| `wireferry.remoteExplorer.sortBySize` | `false` | Сортировать дерево по размеру вместо имени |
| `wireferry.remoteExplorer.profilesAsRoots` | `true` | Показывать профили отдельными корнями Remote Explorer |

WireFerry больше не запускает сетевую проверку обновлений при старте. Команда **Check for Updates / Проверить обновления** просит VS Code обновить сведения об обновлениях из Marketplace и открывает страницу WireFerry.

## Legacy и расширенные поля

- `keepLegacyConfigFormat` отключает предложения переименовать `.vscode/sftp.json`.
- `remote` может объединить именованную legacy-запись `remotefs.remote` из пользовательских настроек VS Code.
- Схемы в `schema/` содержат подробные допустимые значения SSH algorithms и `secureOptions`.

Если документация и подсказки редактора расходятся, перед использованием поля проверьте runtime-валидатор `src/modules/configValidation.ts` и встроенные схемы.
