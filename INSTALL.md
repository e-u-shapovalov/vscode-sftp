# Install WireFerry in Visual Studio Code

[Русский](#русский) · [Main README](README.md)

WireFerry is distributed through [GitHub Releases](https://github.com/e-u-shapovalov/vscode-sftp/releases) as a `.vsix` extension package. You need desktop Visual Studio Code 1.66 or newer.

## Download

1. Open the [latest WireFerry release](https://github.com/e-u-shapovalov/vscode-sftp/releases/latest).
2. Locate the **Assets** section. Expand it if GitHub has collapsed the list.
3. Download `wireferry-<version>.vsix`.

> **If you are a regular user, do not use Code → Download ZIP. Download the ready-to-use release package from GitHub Releases instead.**

Do not choose:

- `Source code (zip)`;
- `Source code (tar.gz)`;
- an archive downloaded through **Code → Download ZIP**.

Those files contain the project sources for developers. The `.vsix` file is the ready-to-install extension. Do not unzip or rename it.

## Install from the VS Code interface

1. Open Visual Studio Code.
2. Open **Extensions** with `Ctrl+Shift+X`.
3. Select **...** in the top-right corner of the Extensions panel.
4. Select **Install from VSIX...**.
5. Choose the downloaded `wireferry-<version>.vsix`.
6. Reload VS Code if prompted.

## Install from a terminal

If the VS Code `code` command is available:

```bash
code --install-extension wireferry-<version>.vsix
```

Run the command in the directory containing the package or provide its full path.

## First run

1. Open a local project folder in VS Code.
2. Trust the workspace if you trust its contents; WireFerry does not run in Restricted Mode.
3. Press `Ctrl+Shift+P` and run **WireFerry: Config**.
4. Complete the server setup wizard.
5. After the connection is verified, use Remote Explorer or a `WireFerry:` command to transfer files.

The wizard creates `.vscode/wireferry.json`. If that file already exists, **WireFerry: Config** opens it instead. Legacy `.vscode/sftp.json` configurations are also recognized.

## Common installation problems

### I downloaded a ZIP or TAR.GZ

You downloaded source code, not the extension. Delete the archive, return to the [latest release](https://github.com/e-u-shapovalov/vscode-sftp/releases/latest), open **Assets** and download `wireferry-<version>.vsix`.

### VS Code says the extension is incompatible

WireFerry requires Visual Studio Code 1.66 or newer. Update desktop VS Code and install the `.vsix` again.

### `code` is not recognized

Use **Extensions → ... → Install from VSIX...** instead. The terminal command is optional.

### WireFerry commands are missing after installation

Check that the extension is enabled, reload VS Code, open a project folder rather than an individual file, and leave Restricted Mode only if you trust the workspace. Then run **WireFerry: Config**.

### There is no `.vsix` under Assets

A release without `wireferry-<version>.vsix` is not ready for regular users. Do not substitute a source archive. Wait for a corrected release or build the package from source using the developer steps below.

## Build from source

Building is intended for contributors and advanced users. The exact minimum Node.js/npm version is not declared; use a current supported Node.js release.

```bash
git clone https://github.com/e-u-shapovalov/vscode-sftp.git
cd vscode-sftp
npm install
npm run compile
npm test
npx tsc --noEmit
npx @vscode/vsce package
```

Install the resulting package:

```bash
code --install-extension wireferry-<version>.vsix
```

The repository does not contain a standalone executable, installer or WireFerry CLI. The build output is a VS Code extension package.

---

## Русский

WireFerry распространяется через [GitHub Releases](https://github.com/e-u-shapovalov/vscode-sftp/releases) в виде пакета `.vsix`. Нужен настольный Visual Studio Code 1.66 или новее.

### Что скачать

1. Откройте страницу [последнего релиза WireFerry](https://github.com/e-u-shapovalov/vscode-sftp/releases/latest).
2. Найдите блок **Assets**. Если список свёрнут, раскройте его.
3. Скачайте `wireferry-<version>.vsix`.

> **Если вы обычный пользователь, не нажимайте `Code → Download ZIP`. Скачайте готовый пакет со страницы GitHub Releases.**

Не скачивайте `Source code (zip)`, `Source code (tar.gz)` или архив через зелёную кнопку **Code**. Это исходники для разработчиков. Готовое расширение — файл `.vsix`; его не нужно распаковывать или переименовывать.

### Установка через интерфейс VS Code

1. Откройте Visual Studio Code.
2. Откройте **Extensions / Расширения** (`Ctrl+Shift+X`).
3. Нажмите **...** в правом верхнем углу панели.
4. Выберите **Install from VSIX... / Установить из VSIX...**.
5. Укажите `wireferry-<version>.vsix`.
6. Перезагрузите VS Code, если редактор попросит.

### Установка через терминал

Если команда `code` доступна:

```bash
code --install-extension wireferry-<version>.vsix
```

Запустите команду из папки с пакетом или укажите полный путь к нему.

### Первый запуск

1. Откройте локальную папку проекта.
2. Если содержимому проекта можно доверять, подтвердите Workspace Trust: в Restricted Mode расширение не работает.
3. Нажмите `Ctrl+Shift+P` и выполните **WireFerry: Config**.
4. Пройдите мастер настройки сервера.
5. После проверки подключения используйте Remote Explorer или команды `WireFerry:`.

Мастер создаёт `.vscode/wireferry.json`. Если конфиг уже есть, команда откроет его. Старый `.vscode/sftp.json` тоже поддерживается.

### Типичные проблемы

#### Скачался ZIP или TAR.GZ

Это исходный код. Удалите архив, вернитесь к [последнему релизу](https://github.com/e-u-shapovalov/vscode-sftp/releases/latest), раскройте **Assets** и скачайте `wireferry-<version>.vsix`.

#### VS Code сообщает о несовместимости

Требуется Visual Studio Code 1.66 или новее. Обновите настольный VS Code и повторите установку.

#### Команда `code` не найдена

Установите пакет через **Extensions / Расширения → ... → Install from VSIX...**. Терминал для установки не обязателен.

#### После установки нет команд WireFerry

Убедитесь, что расширение включено, перезагрузите VS Code, откройте папку проекта, а не отдельный файл, и выйдите из Restricted Mode только для доверенного проекта. Затем выполните **WireFerry: Config**.

#### В Assets нет `.vsix`

Такой релиз не готов для обычной установки. Не заменяйте `.vsix` архивом Source code. Дождитесь исправленного релиза или соберите пакет из исходников.

### Сборка из исходников

Точная минимальная версия Node.js/npm не указана; используйте актуальный поддерживаемый выпуск Node.js.

```bash
git clone https://github.com/e-u-shapovalov/vscode-sftp.git
cd vscode-sftp
npm install
npm run compile
npm test
npx tsc --noEmit
npx @vscode/vsce package
```

Установить собранный пакет:

```bash
code --install-extension wireferry-<version>.vsix
```

В проекте нет отдельного исполняемого файла, установщика или собственного CLI: результат сборки — пакет расширения VS Code.
