---
title: Formatierer
description: OpenCode verwendet sprachspezifische Formatierer.
---

OpenCode formatiert Dateien automatisch, nachdem sie mit sprachspezifischen Formatierern geschrieben oder bearbeitet wurden. Dadurch wird sichergestellt, dass der generierte Code dem Codestil Ihres Projekts entspricht.

---

## Integriert

OpenCode verfügt über mehrere integrierte Formatierer für gängige Sprachen und Frameworks. Nachfolgend finden Sie eine Liste der Formatierer, unterstützten Dateierweiterungen und benötigten Befehle oder Konfigurationsoptionen.

| Formatierer          | Erweiterungen                                                                                            | Anforderungen                                                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| gofmt                | .go                                                                                                      | `gofmt`-Befehl verfügbar                                                                                   |
| mix                  | .ex, .exs, .eex, .heex, .leex, .neex, .sface                                                             | `mix`-Befehl verfügbar                                                                                     |
| prettier             | .js, .jsx, .ts, .tsx, .html, .css, .md, .json, .yaml, und [more](https://prettier.io/docs/en/index.html) | `prettier`-Abhängigkeit in `package.json`                                                                  |
| biome                | .js, .jsx, .ts, .tsx, .html, .css, .md, .json, .yaml, und [more](https://biomejs.dev/)                   | `biome.json(c)` Konfigurationsdatei                                                                        |
| zig                  | .zig, .zon                                                                                               | `zig`-Befehl verfügbar                                                                                     |
| clang-format         | .c, .cpp, .h, .hpp, .ino und [more](https://clang.llvm.org/docs/ClangFormat.html)                        | `.clang-format` Konfigurationsdatei                                                                        |
| ktlint               | .kt, .kts                                                                                                | `ktlint`-Befehl verfügbar                                                                                  |
| ruff                 | .py, .pyi                                                                                                | `ruff`-Befehl verfügbar mit config                                                                         |
| rustfmt              | .rs                                                                                                      | `rustfmt`-Befehl verfügbar                                                                                 |
| cargofmt             | .rs                                                                                                      | `cargo fmt`-Befehl verfügbar                                                                               |
| uv                   | .py, .pyi                                                                                                | `uv`-Befehl verfügbar                                                                                      |
| rubocop              | .rb, .rake, .gemspec, .ru                                                                                | `rubocop`-Befehl verfügbar                                                                                 |
| standardrb           | .rb, .rake, .gemspec, .ru                                                                                | `standardrb`-Befehl verfügbar                                                                              |
| htmlbeautifier       | .erb, .html.erb                                                                                          | `htmlbeautifier`-Befehl verfügbar                                                                          |
| air                  | .R                                                                                                       | `air`-Befehl verfügbar                                                                                     |
| dart                 | .dart                                                                                                    | `dart`-Befehl verfügbar                                                                                    |
| dfmt                 | .d                                                                                                       | `dfmt`-Befehl verfügbar                                                                                    |
| ocamlformat          | .ml, .mli                                                                                                | `ocamlformat` Befehl verfügbar und `.ocamlformat` Konfigurationsdatei                                      |
| terraform            | .tf, .tfvars                                                                                             | `terraform`-Befehl verfügbar                                                                               |
| gleam                | .gleam                                                                                                   | `gleam`-Befehl verfügbar                                                                                   |
| nixfmt               | .nix                                                                                                     | `nixfmt`-Befehl verfügbar                                                                                  |
| shfmt                | .sh, .bash                                                                                               | `shfmt`-Befehl verfügbar                                                                                   |
| pint                 | .php                                                                                                     | `laravel/pint`-Abhängigkeit in `composer.json`                                                             |
| oxfmt (Experimental) | .js, .jsx, .ts, .tsx                                                                                     | `oxfmt`-Abhängigkeit in `package.json` und einer [experimental env variable flag](/docs/cli/#experimental) |
| Ormolu               | .hs                                                                                                      | `ormolu`-Befehl verfügbar                                                                                  |

Wenn Ihr Projekt auch `prettier` in Ihrem `package.json` hat, wird OpenCode automatisch verwendet.

---

## Funktionsweise

Wenn OpenCode eine Datei schreibt oder bearbeitet, geschieht Folgendes:

1. Überprüft die Dateierweiterung anhand aller aktivierten Formatierer.
2. Führt den entsprechenden Formatierungsbefehl für die Datei aus.
3. Wendet die Formatierungsänderungen automatisch an.

Dieser Prozess findet im Hintergrund statt und stellt sicher, dass Ihr Codestile ohne manuelle Schritte beibehalten werden.

---

## Konfiguration

Sie können Formatierer über den Abschnitt `formatter` in Ihrer OpenCode-Konfiguration anpassen.

```json title="opencode.json"
{
  "$schema": "https://opencode.ai/config.json",
  "formatter": {}
}
```

Jede Formatierungskonfiguration unterstützt Folgendes:

| Eigenschaft   | Typ             | Beschreibung                                                                     |
| ------------- | --------------- | -------------------------------------------------------------------------------- |
| `disabled`    | boolescher Wert | Setzen Sie dies auf `true`, um den Formatierer zu deaktivieren                   |
| `command`     | string[]        | Der zum Formatieren auszuführende Befehl                                         |
| `environment` | Objekt          | Umgebungsvariablen, die beim Ausführen des Formatierers festgelegt werden sollen |
| `extensions`  | string[]        | Dateierweiterungen, die dieser Formatierer verarbeiten soll                      |

Schauen wir uns einige Beispiele an.

---

### Formatierer deaktivieren

Um **alle** Formatierer global zu deaktivieren, setzen Sie `formatter` auf `false`:

```json title="opencode.json" {3}
{
  "$schema": "https://opencode.ai/config.json",
  "formatter": false
}
```

Um einen **bestimmten** Formatierer zu deaktivieren, setzen Sie `disabled` auf `true`:

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

### Benutzerdefinierter Formatierer

Sie können den integrierten Formatierer überschreiben oder neu hinzufügen, indem Sie den Befehl, Umgebungsvariablen und Dateierweiterungen angeben:

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

Der Platzhalter **`$FILE`** im Befehl wird durch den Pfad zur zu formatierenden Datei ersetzt.
