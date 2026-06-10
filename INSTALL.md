# Установка WireFerry / Install WireFerry

## Русский

WireFerry устанавливается в Visual Studio Code как файл `.vsix`.

### Что скачать

Скачайте готовый файл расширения:

**[`wireferry-<version>.vsix`](https://github.com/e-u-shapovalov/vscode-sftp/releases/latest)**

Или откройте последнюю страницу релиза:

<https://github.com/e-u-shapovalov/vscode-sftp/releases/latest>

На странице релиза найдите блок **Assets** и выберите файл `wireferry-<version>.vsix`.

> Если вы обычный пользователь, **не нажимайте `Code -> Download ZIP`** и не скачивайте **Source code**. Это исходники проекта. Они не устанавливаются в VS Code как расширение.

### Установка через интерфейс VS Code

1. Откройте VS Code.
2. Откройте **Extensions / Расширения** (`Ctrl+Shift+X`).
3. Нажмите кнопку **...** в правом верхнем углу панели расширений.
4. Выберите **Install from VSIX... / Установить из VSIX...**.
5. Укажите скачанный файл `wireferry-<version>.vsix`.
6. Перезагрузите VS Code, если редактор попросит.

### Установка через терминал

```bash
code --install-extension wireferry-<version>.vsix
```

Если файл лежит не в текущей папке, укажите полный путь:

```powershell
code --install-extension C:\Users\You\Downloads\wireferry-<version>.vsix
```

### Первый запуск

1. Откройте локальную папку проекта в VS Code.
2. Нажмите `Ctrl+Shift+P`.
3. Выполните **WireFerry: Config**.
4. Заполните `.vscode/wireferry.json`.
5. Выполните **WireFerry: Upload Project**, **WireFerry: Download Project** или другую команду WireFerry.

Минимальный SFTP-конфиг:

```json
{
  "name": "My Server",
  "host": "example.com",
  "protocol": "sftp",
  "port": 22,
  "username": "deploy",
  "remotePath": "/var/www/site"
}
```

### Как понять, что вы скачали правильный файл

Правильный файл:

- заканчивается на `.vsix`;
- называется примерно `wireferry-<version>.vsix`;
- находится в **Releases -> Assets**;
- устанавливается через **Install from VSIX...**.

Неправильный файл для обычной установки:

- `Source code (zip)`;
- `Source code (tar.gz)`;
- архив, скачанный через зелёную кнопку **Code**;
- весь репозиторий проекта.

## English

WireFerry is installed into Visual Studio Code from a `.vsix` file.

### What to Download

Download the ready-to-install extension package:

**[`wireferry-<version>.vsix`](https://github.com/e-u-shapovalov/vscode-sftp/releases/latest)**

Or open the latest release page:

<https://github.com/e-u-shapovalov/vscode-sftp/releases/latest>

Find **Assets** and download `wireferry-<version>.vsix`.

> If you are a regular user, do **not** use `Code -> Download ZIP` and do **not** download **Source code**. Those are source archives, not the VS Code extension package.

### Install in VS Code

1. Open VS Code.
2. Open **Extensions** (`Ctrl+Shift+X`).
3. Click **...** in the top-right corner.
4. Choose **Install from VSIX...**.
5. Pick `wireferry-<version>.vsix`.
6. Reload VS Code if prompted.

### Install from Terminal

```bash
code --install-extension wireferry-<version>.vsix
```

### First Run

1. Open your local project folder in VS Code.
2. Press `Ctrl+Shift+P`.
3. Run **WireFerry: Config**.
4. Fill `.vscode/wireferry.json`.
5. Run **WireFerry: Upload Project**, **WireFerry: Download Project**, or another WireFerry command.
