---
title: Форматтеры
description: opencode использует средства форматирования, специфичные для языка.
---

opencode автоматически форматирует файлы после их записи или редактирования с использованием средств форматирования для конкретного языка. Это гарантирует, что создаваемый код будет соответствовать стилям кода вашего проекта.

---

## Встроенные

opencode поставляется с несколькими встроенными форматировщиками для популярных языков и платформ. Ниже приведен список форматтеров, поддерживаемых расширений файлов, а также необходимых команд или параметров конфигурации.

| Formatter            | Расширения                                                                                                 | Требования                                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| gofmt                | .go                                                                                                        | Доступна команда `gofmt`                                                                                      |
| mix                  | .ex, .exs, .eex, .heex, .leex, .neex, .sface                                                               | Доступна команда `mix`                                                                                        |
| prettier             | .js, .jsx, .ts, .tsx, .html, .css, .md, .json, .yaml и [подробнее](https://prettier.io/docs/en/index.html) | Зависимость `prettier` в `package.json`                                                                       |
| biome                | .js, .jsx, .ts, .tsx, .html, .css, .md, .json, .yaml и [подробнее](https://biomejs.dev/)                   | Конфигурационный файл `biome.json(c)`                                                                         |
| zig                  | .zig, .zon                                                                                                 | Доступна команда `zig`                                                                                        |
| clang-format         | .c, .cpp, .h, .hpp, .ino и [подробнее](https://clang.llvm.org/docs/ClangFormat.html)                       | Конфигурационный файл `.clang-format`                                                                         |
| ktlint               | .kt, .kts                                                                                                  | Доступна команда `ktlint`                                                                                     |
| ruff                 | .py, .pyi                                                                                                  | Команда `ruff` доступна в конфигурации                                                                        |
| rustfmt              | .rs                                                                                                        | Доступна команда `rustfmt`                                                                                    |
| cargofmt             | .rs                                                                                                        | Доступна команда `cargo fmt`                                                                                  |
| uv                   | .py, .pyi                                                                                                  | Доступна команда `uv`                                                                                         |
| rubocop              | .rb, .rake, .gemspec, .ru                                                                                  | Доступна команда `rubocop`                                                                                    |
| standardrb           | .rb, .rake, .gemspec, .ru                                                                                  | Доступна команда `standardrb`                                                                                 |
| htmlbeautifier       | .erb, .html.erb                                                                                            | Доступна команда `htmlbeautifier`                                                                             |
| air                  | .R                                                                                                         | Доступна команда `air`                                                                                        |
| dart                 | .dart                                                                                                      | Доступна команда `dart`                                                                                       |
| dfmt                 | .d                                                                                                         | Доступна команда `dfmt`                                                                                       |
| ocamlformat          | .ml, .mli                                                                                                  | Доступна команда `ocamlformat` и файл конфигурации `.ocamlformat`.                                            |
| terraform            | .tf, .tfvars                                                                                               | Доступна команда `terraform`                                                                                  |
| gleam                | .gleam                                                                                                     | Доступна команда `gleam`                                                                                      |
| nixfmt               | .nix                                                                                                       | Доступна команда `nixfmt`                                                                                     |
| shfmt                | .sh, .bash                                                                                                 | Доступна команда `shfmt`                                                                                      |
| pint                 | .php                                                                                                       | Зависимость `laravel/pint` в `composer.json`                                                                  |
| oxfmt (Experimental) | .js, .jsx, .ts, .tsx                                                                                       | Зависимость `oxfmt` в `package.json` и [экспериментальный флаг переменной окружения](/docs/cli/#experimental) |
| ormolu               | .hs                                                                                                        | Доступна команда `ormolu`                                                                                     |

Поэтому, если ваш проект имеет `prettier` в вашем `package.json`, opencode автоматически будет использовать его.

---

## Настройка

Вы можете настроить форматтеры через раздел `formatter` в конфигурации opencode.

```json title="opencode.json"
{
  "$schema": "https://opencode.ai/config.json",
  "formatter": {}
}
```

Каждая конфигурация форматтера поддерживает следующее:

| Свойство      | Тип      | Описание                                                                            |
| ------------- | -------- | ----------------------------------------------------------------------------------- |
| `disabled`    | boolean  | Установите для этого параметра значение `true`, чтобы отключить форматтер.          |
| `command`     | string[] | Команда для форматирования                                                          |
| `environment` | объект   | Переменные среды, которые необходимо установить при запуске средства форматирования |
| `extensions`  | string[] | Расширения файлов, которые должен обрабатывать этот форматтер                       |

Давайте посмотрим на несколько примеров.

---

### Отключение форматтеров

Чтобы глобально отключить **все** средства форматирования, установите для `formatter` значение `false`:

```json title="opencode.json" {3}
{
  "$schema": "https://opencode.ai/config.json",
  "formatter": false
}
```

Чтобы отключить **конкретный** форматтер, установите для `disabled` значение `true`:

```json title="opencode.json" {5}
{
  "$schema": "https://opencode.ai/config.json",
  "formatter": {
    "prettier": {
      "disabled": true
    }
  }
}
```

---

### Пользовательские форматтеры

Вы можете переопределить встроенные средства форматирования или добавить новые, указав команду, переменные среды и расширения файлов:

```json title="opencode.json" {4-14}
{
  "$schema": "https://opencode.ai/config.json",
  "formatter": {
    "prettier": {
      "command": ["npx", "prettier", "--write", "$FILE"],
      "environment": {
        "NODE_ENV": "development"
      },
      "extensions": [".js", ".ts", ".jsx", ".tsx"]
    },
    "custom-markdown-formatter": {
      "command": ["deno", "fmt", "$FILE"],
      "extensions": [".md"]
    }
  }
}
```

Заполнитель **`$FILE`** в команде будет заменен путем к форматируемому файлу.
