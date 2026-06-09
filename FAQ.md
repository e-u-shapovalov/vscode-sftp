# FAQ / Troubleshooting

## Русский

### Что скачивать для установки?

Скачивайте файл `wireferry-<version>.vsix` со страницы [Releases](https://github.com/e-u-shapovalov/vscode-sftp/releases/latest), из блока **Assets**.

Не скачивайте `Source code`, `Code -> Download ZIP`, `.zip` или `.tar.gz`, если вы обычный пользователь. Это исходный код, а не готовое расширение для VS Code.

### Как установить `.vsix`?

1. Откройте VS Code.
2. Перейдите в **Extensions / Расширения** (`Ctrl+Shift+X`).
3. Нажмите **...** в правом верхнем углу панели.
4. Выберите **Install from VSIX... / Установить из VSIX...**.
5. Укажите скачанный `wireferry-<version>.vsix`.
6. Перезагрузите VS Code, если он попросит.

Через терминал:

```bash
code --install-extension wireferry-2.0.5.vsix
```

### Почему команды WireFerry не появляются?

Проверьте три вещи:

- расширение установлено и включено в VS Code;
- открыта именно папка проекта, а не отдельный файл;
- в проекте есть `.vscode/wireferry.json` или старый `.vscode/sftp.json`.

Создать конфиг можно командой **WireFerry: Config** через `Ctrl+Shift+P`.

### `Config Not Found`

WireFerry не смог сопоставить текущий локальный файл с конфигом. Обычно причина одна из этих:

- открыт не тот workspace;
- `.vscode/wireferry.json` лежит не в корне открытой папки;
- `context` указывает на другую локальную папку;
- файл находится вне папки, которую описывает конфиг.

Откройте корневую папку проекта в VS Code и проверьте `context`.

### `Error: Failure`

Это общее сообщение от SFTP-сервера. Частые причины:

- `remotePath` указывает на symlink или несуществующую папку;
- у пользователя нет прав на запись;
- сервер упёрся в лимит открытых файлов.

Что попробовать:

1. Укажите реальный путь в `remotePath`, без symlink.
2. Проверьте права пользователя на сервере.
3. При ошибках лимита файлов уменьшите `concurrency` или задайте `limitOpenFilesOnRemote`.

### `Error: Connection closed`

На старых SSH/SFTP-серверах может не подходить набор алгоритмов по умолчанию. Попробуйте явно задать `algorithms` в `.vscode/wireferry.json`:

```json
{
  "algorithms": {
    "kex": [
      "ecdh-sha2-nistp256",
      "ecdh-sha2-nistp384",
      "ecdh-sha2-nistp521"
    ],
    "cipher": [
      "aes128-gcm",
      "aes128-gcm@openssh.com",
      "aes256-gcm",
      "aes256-gcm@openssh.com",
      "aes128-cbc",
      "aes192-cbc",
      "aes256-cbc",
      "aes128-ctr",
      "aes192-ctr",
      "aes256-ctr"
    ],
    "serverHostKey": [
      "ssh-rsa",
      "ssh-dss",
      "ssh-ed25519",
      "ecdsa-sha2-nistp256",
      "ecdsa-sha2-nistp384",
      "ecdsa-sha2-nistp521",
      "rsa-sha2-256",
      "rsa-sha2-512"
    ],
    "hmac": [
      "hmac-sha2-256",
      "hmac-sha2-512"
    ]
  }
}
```

### На сервер выгружается лишнее: `.git`, `node_modules`, логи

Добавьте `ignore`:

```json
{
  "ignore": [
    ".git",
    "node_modules",
    ".DS_Store",
    "*.log",
    "*.tmp"
  ]
}
```

Можно также указать `ignoreFile`, например:

```json
{
  "ignoreFile": ".gitignore"
}
```

### Как выгружать содержимое папки, но не саму папку?

Используйте `context`. Например, чтобы отправлять содержимое `./build` прямо в `/var/www/site`:

```json
{
  "name": "Production",
  "host": "example.com",
  "protocol": "sftp",
  "port": 22,
  "username": "deploy",
  "remotePath": "/var/www/site",
  "context": "./build",
  "uploadOnSave": false,
  "watcher": {
    "files": "*.{js,css,html}",
    "autoUpload": true
  }
}
```

### Как скачать проект с сервера?

1. Откройте пустую локальную папку в VS Code.
2. Выполните **WireFerry: Config**.
3. Укажите сервер и `remotePath`.
4. Выполните **WireFerry: Download Project**.

### Можно ли автоматически выгружать изменения?

Да. Для файлов, сохранённых в VS Code, используйте:

```json
{
  "uploadOnSave": true
}
```

Для файлов, изменённых внешними инструментами, используйте watcher:

```json
{
  "uploadOnSave": false,
  "watcher": {
    "files": "**/*",
    "autoUpload": true
  }
}
```

Не включайте `uploadOnSave` и `watcher.autoUpload` одновременно на один и тот же набор файлов, чтобы не получить двойную выгрузку.

### Как показать скрытые файлы в Remote Explorer?

Для FTP-серверов, например proftpd, это зависит от настроек листинга на сервере. В `proftpd.conf` найдите `ListOptions` и замените `"-l"` на `"-la"`:

```conf
<Global>
  ListOptions "-la"
</Global>
```

Типовые пути к `proftpd.conf`:

- `/etc/proftpd.conf`
- `/etc/proftpd/proftpd.conf`
- `/usr/local/etc/proftpd.conf`
- `/usr/local/etc/proftpd/proftpd.conf`

### `ENFILE: file table overflow` на macOS

Сервер или локальная система может упираться в лимит открытых файлов. Сначала попробуйте уменьшить `concurrency`. Если этого мало, увеличьте системный лимит macOS:

```bash
echo kern.maxfiles=65536 | sudo tee -a /etc/sysctl.conf
echo kern.maxfilesperproc=65536 | sudo tee -a /etc/sysctl.conf
sudo sysctl -w kern.maxfiles=65536
sudo sysctl -w kern.maxfilesperproc=65536
ulimit -n 65536
```

### Где смотреть логи?

Включите настройку `wireferry.debug`, перезагрузите VS Code и откройте **View -> Output -> WireFerry**.

### Пароль безопасно хранить в конфиге?

Нет. Поле `password` в `.vscode/wireferry.json` хранится открытым текстом. Лучше использовать SFTP-ключ (`privateKeyPath`) или не указывать пароль, чтобы WireFerry спросил его при подключении.

## English

### What should I download?

Download `wireferry-<version>.vsix` from [GitHub Releases](https://github.com/e-u-shapovalov/vscode-sftp/releases/latest), inside the **Assets** block.

Do not download `Source code`, `Code -> Download ZIP`, `.zip` or `.tar.gz` if you just want to install the extension. Those are source archives for developers.

### How do I install the VSIX?

1. Open VS Code.
2. Open **Extensions** (`Ctrl+Shift+X`).
3. Click **...** in the top-right corner.
4. Choose **Install from VSIX...**.
5. Pick the downloaded `wireferry-<version>.vsix`.
6. Reload VS Code if prompted.

CLI install:

```bash
code --install-extension wireferry-2.0.5.vsix
```

### Commands do not appear

Check that the extension is installed and enabled, that you opened a folder workspace, and that the workspace contains `.vscode/wireferry.json` or a legacy `.vscode/sftp.json`.

### `Config Not Found`

WireFerry could not match the current local file to a configuration. Open the project root folder in VS Code and check that `.vscode/wireferry.json` is under that folder. Also verify `context`.

### `Error: Failure`

This is a generic SFTP server error. Check `remotePath`, server permissions, symlinks, and file descriptor limits. Try lowering `concurrency` or setting `limitOpenFilesOnRemote`.

### `Error: Connection closed`

Older SSH/SFTP servers may need explicit SSH algorithms. Use the `algorithms` example in the Russian section above.

### How do I upload folder contents, but not the folder itself?

Set `context` to that local folder, for example `"context": "./build"`, and point `remotePath` to the destination directory.

### How do I enable debug logs?

Set `wireferry.debug` to `true`, reload VS Code, then open **View -> Output -> WireFerry**.
