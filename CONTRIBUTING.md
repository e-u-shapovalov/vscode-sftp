# Contributing to WireFerry

## Русский

WireFerry — независимо поддерживаемый форк [Natizyskunk/vscode-sftp](https://github.com/Natizyskunk/vscode-sftp), который сам является форком [liximomo/vscode-sftp](https://github.com/liximomo/vscode-sftp). Основная ветка разработки: `develop`.

Перед изменениями убедитесь, что понимаете текущий формат конфигурации (`.vscode/wireferry.json`), legacy-совместимость с `.vscode/sftp.json` и реальные команды из `package.json`.

### Локальная разработка

```bash
git clone https://github.com/e-u-shapovalov/vscode-sftp.git
cd vscode-sftp
npm install
npm run compile
npm test
npx tsc --noEmit
```

Упаковка локального `.vsix`:

```bash
npx @vscode/vsce package
```

### Что проверять перед pull request

- `npm run compile` завершается с exit code `0`.
- `npx tsc --noEmit` проходит без ошибок.
- `npm test` проходит; один тест для `remoteTimeOffsetInHours` может быть намеренно пропущен, пока функция не включена в transfer pipeline.
- Документация обновлена вместе с изменением поведения.
- Новые команды добавлены не только в код, но и в `package.json`, локализацию и документацию.
- Изменения не ломают legacy `.vscode/sftp.json`, если задача не требует обратного.

### Стиль изменений

- Делайте небольшие PR с одной темой.
- Не смешивайте рефакторинг, обновление зависимостей и пользовательскую функцию без необходимости.
- Для исправления бага добавляйте тест там, где это разумно.
- Для пользовательских изменений обновляйте README, CHANGELOG или docs.
- Если меняется релизная информация, держите русский раздел перед английским.

### Публикация

Публикация и упаковка описаны в [PUBLISHING.md](PUBLISHING.md). Опубликованную версию нельзя заменить тем же номером: для нового пакета нужен bump версии.

## English

WireFerry is an independently maintained fork of [Natizyskunk/vscode-sftp](https://github.com/Natizyskunk/vscode-sftp), which itself is a fork of [liximomo/vscode-sftp](https://github.com/liximomo/vscode-sftp). The main development branch is `develop`.

### Local Development

```bash
git clone https://github.com/e-u-shapovalov/vscode-sftp.git
cd vscode-sftp
npm install
npm run compile
npm test
npx tsc --noEmit
```

Package a local VSIX:

```bash
npx @vscode/vsce package
```

### Pull Request Checklist

- `npm run compile` exits with code `0`.
- `npx tsc --noEmit` passes.
- `npm test` passes; one `remoteTimeOffsetInHours` test may remain intentionally skipped until that feature is re-enabled in the transfer pipeline.
- Documentation is updated when behavior changes.
- New commands are wired through code, `package.json`, localization and docs.
- Legacy `.vscode/sftp.json` compatibility is preserved unless the change explicitly targets it.

### Change Style

- Keep PRs focused.
- Avoid mixing refactoring, dependency upgrades and user-facing behavior in one change.
- Add tests for bug fixes where practical.
- Update README, CHANGELOG or docs for user-facing changes.
- In release-facing documents put the English section first, then Russian — keep the Russian section in full (it stays clearly visible, not trimmed). Existing historical entries are left unchanged.

### Publishing

Packaging and publishing are documented in [PUBLISHING.md](PUBLISHING.md). A published version cannot be overwritten; bump the version for every new package.
