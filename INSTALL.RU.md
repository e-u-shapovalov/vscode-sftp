# Установка WireFerry в Visual Studio Code

[English version](INSTALL.md) · [Основной README](README.RU.md) · [FAQ](FAQ.RU.md)

WireFerry опубликован в [Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=EvgeniiShapovalov.wireferry). Требуется настольный Visual Studio Code 1.66 или новее. Ручные пакеты `.vsix` остаются доступны в [GitHub Releases](https://github.com/e-u-shapovalov/vscode-sftp/releases) для offline-установки или проверки отката.

## Установка из Marketplace

1. Откройте Visual Studio Code.
2. Откройте **Extensions / Расширения** через `Ctrl+Shift+X`.
3. Найдите `WireFerry`.
4. Нажмите **Install / Установить**.

VS Code обновляет расширения из Marketplace автоматически, если включено автообновление расширений.

## Скачайте правильный VSIX-файл

1. Откройте страницу [последнего релиза WireFerry](https://github.com/e-u-shapovalov/vscode-sftp/releases/latest).
2. Найдите блок **Assets**. Если GitHub свернул список, раскройте его.
3. Скачайте `wireferry-<version>.vsix`.

> **Если вы обычный пользователь, не нажимайте `Code → Download ZIP`. Скачайте готовый пакет расширения со страницы GitHub Releases.**

Не скачивайте:

- `Source code (zip)`;
- `Source code (tar.gz)`;
- архив из меню **Code → Download ZIP**.

Эти файлы содержат исходный код для разработчиков. Готовое к установке расширение — файл `.vsix`. Не распаковывайте и не переименовывайте его.

## Установка VSIX через интерфейс VS Code

1. Откройте Visual Studio Code.
2. Откройте **Extensions / Расширения** через `Ctrl+Shift+X`.
3. Нажмите **...** в правом верхнем углу панели расширений.
4. Выберите **Install from VSIX... / Установить из VSIX...**.
5. Укажите скачанный `wireferry-<version>.vsix`.
6. Перезагрузите VS Code, если редактор попросит.

## Установка через терминал

Если доступна команда VS Code `code`, выполните её из папки с пакетом:

```bash
code --install-extension wireferry-<version>.vsix
```

Можно указать полный путь к `.vsix`. Это команда установки Visual Studio Code; собственного CLI у WireFerry нет.

## Первый запуск

1. Откройте в VS Code локальную папку проекта.
2. Доверяйте workspace только в том случае, если доверяете его содержимому. В Restricted Mode WireFerry не работает.
3. Нажмите `Ctrl+Shift+P` и выполните **WireFerry: Config**.
4. Пройдите мастер настройки сервера.
5. После проверки подключения передавайте файлы через Remote Explorer или команды `WireFerry:`.

Мастер создаёт `.vscode/wireferry.json`. Если текущий или legacy-конфиг уже существует, **WireFerry: Config** откроет его. Старые `.vscode/sftp.json` продолжают распознаваться.

## Обновление и удаление

Установка из Marketplace обновляется через VS Code. Для ручного пакета из GitHub Release скачайте более новый `.vsix` и снова выполните **Install from VSIX...**; VS Code заменит установленное расширение выбранным пакетом.

Чтобы удалить WireFerry, откройте **Extensions / Расширения**, найдите **WireFerry — SFTP & FTP Sync**, откройте меню с шестерёнкой и выберите **Uninstall / Удалить**.

## Типичные проблемы при установке

### Скачался ZIP или TAR.GZ

Вы скачали исходный код, а не расширение. Удалите архив, вернитесь к [последнему релизу](https://github.com/e-u-shapovalov/vscode-sftp/releases/latest), раскройте **Assets** и скачайте `wireferry-<version>.vsix`.

### VS Code сообщает о несовместимости

WireFerry требует настольный Visual Studio Code 1.66 или новее. Обновите VS Code и повторите установку `.vsix`.

### Команда `code` не найдена

Используйте **Extensions / Расширения → ... → Install from VSIX...**. Терминал для установки не обязателен.

### В VS Code нет пункта «Install from VSIX...»

Убедитесь, что используете настольный Visual Studio Code, а не браузерный редактор. Откройте раздел **Extensions / Расширения** и меню **...** в правом верхнем углу панели.

### После установки нет команд WireFerry

Проверьте, что расширение включено, перезагрузите VS Code, откройте папку проекта, а не отдельный файл, и выходите из Restricted Mode только для доверенного workspace. Затем выполните **WireFerry: Config**.

### В Assets нет `.vsix`

Релиз без `wireferry-<version>.vsix` не готов для обычной установки. Не заменяйте пакет архивом Source code. Дождитесь исправленного релиза или соберите пакет из исходников.

## Сборка из исходников

Сборка предназначена для участников проекта и опытных пользователей. Точная минимальная версия Node.js/npm не объявлена; используйте актуальный поддерживаемый выпуск Node.js.

```bash
git clone https://github.com/e-u-shapovalov/vscode-sftp.git
cd vscode-sftp
npm ci
npm run compile
npm test
npx tsc --noEmit
npx @vscode/vsce package
```

Установите получившийся пакет:

```bash
code --install-extension wireferry-<version>.vsix
```

Либо используйте **Extensions / Расширения → ... → Install from VSIX...**. Репозиторий не собирает отдельный executable-файл, installer или CLI WireFerry; пользовательский результат сборки — пакет расширения VS Code.
