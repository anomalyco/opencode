---
title: Formatery
description: OpenCode używa formaterów specyficznych dla języka.
---

OpenCode automatycznie formatuje pliki po ich zapisaniu lub edycji przy użyciu formaterów specyficznych dla języka. Zapewnia to, że wygenerowany kod jest zgodny ze stylem kodu Twojego projektu.

---

## Wbudowane

OpenCode zawiera kilka wbudowanych formaterów dla popularnych języków i frameworków. Poniższa tabela zawiera listę formaterów, obsługiwanych plików oraz wymagań konfiguracyjnych.

| Formater             | Rozszerzenia                                                                                            | Wymagania                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| gofmt                | .go                                                                                                     | Dostępne polecenie `gofmt`                                                            |
| mix                  | .ex, .exs, .eex, .heex, .leex, .neex, .sface                                                            | Dostępne polecenie `mix`                                                              |
| prettier             | .js, .jsx, .ts, .tsx, .html, .css, .md, .json, .yaml i [więcej](https://prettier.io/docs/en/index.html) | Zależność `prettier` w `package.json`                                                 |
| biome                | .js, .jsx, .ts, .tsx, .html, .css, .md, .json, .yaml i [więcej](https://biomejs.dev/)                   | Plik konfiguracyjny `biome.json(c)`                                                   |
| zig                  | .zig, .zon                                                                                              | Dostępne polecenie `zig`                                                              |
| clang-format         | .c, .cpp, .h, .hpp, .ino i [więcej](https://clang.llvm.org/docs/ClangFormat.html)                       | Plik konfiguracyjny `.clang-format`                                                   |
| ktlint               | .kt, .kts                                                                                               | Dostępne polecenie `ktlint`                                                           |
| ruff                 | .py, .pyi                                                                                               | Dostępne polecenie `ruff`                                                             |
| rustfmt              | .rs                                                                                                     | Dostępne polecenie `rustfmt`                                                          |
| cargo                | .rs                                                                                                     | Dostępne polecenie `cargo fmt`                                                        |
| uv                   | .py, .pyi                                                                                               | Dostępne polecenie `uv`                                                               |
| rubocop              | .rb, .rake, .gemspec, .ru                                                                               | Dostępne polecenie `rubocop`                                                          |
| standardrb           | .rb, .rake, .gemspec, .ru                                                                               | Dostępne polecenie `standardrb`                                                       |
| htmlbeautifier       | .erb, .html.erb                                                                                         | Dostępne polecenie `htmlbeautifier`                                                   |
| air                  | .R                                                                                                      | Dostępne polecenie `air`                                                              |
| dart                 | .dart                                                                                                   | Dostępne polecenie `dart`                                                             |
| dfmt                 | .d                                                                                                      | Dostępne polecenie `dfmt`                                                             |
| ocamlformat          | .ml, .mli                                                                                               | Dostępne polecenie `ocamlformat` i plik konfiguracyjny `.ocamlformat`                 |
| terraform            | .tf, .tfvars                                                                                            | Dostępne polecenie `terraform`                                                        |
| gleam                | .gleam                                                                                                  | Dostępne polecenie `gleam`                                                            |
| nixfmt               | .nix                                                                                                    | Dostępne polecenie `nixfmt`                                                           |
| shfmt                | .sh, .bash                                                                                              | Dostępne polecenie `shfmt`                                                            |
| pint                 | .php                                                                                                    | Zależność `laravel/pint` w `composer.json`                                            |
| oxfmt (experimental) | .js, .jsx, .ts, .tsx                                                                                    | Zależność `oxfmt` w `package.json` i [eksperymentalna flaga](/docs/cli/#experimental) |
| ormolu               | .hs                                                                                                     | Dostępne polecenie `ormolu`                                                           |

Jeśli więc Twój projekt zawiera `prettier` w `package.json`, OpenCode automatycznie go użyje.

---

## Jak to działa

Kiedy OpenCode zapisuje lub edytuje plik:

1. Sprawdza plik pod kątem wszystkich dostępnych formaterów.
2. Uruchamia odpowiedni formater na pliku.
3. Automatycznie stosuje zmiany formatowania.

Ten proces odbywa się w tle, zapewniając spójność stylu kodu bez konieczności ręcznej interwencji.

---

## Konfiguracja

Możesz dostosować formatery za pomocą sekcji `formatter` w konfiguracji OpenCode.

```json title="opencode.json"
{
  "$schema": "https://opencode.ai/config.json",
  "formatter": {}
}
```

Każdy formater obsługuje następujące właściwości:

| Właściwość    | Typ      | Opis                                                     |
| ------------- | -------- | -------------------------------------------------------- |
| `disabled`    | boolean  | Ustaw na `true`, aby wyłączyć ten formater               |
| `command`     | string[] | Polecenie uruchomienia formatera                         |
| `environment` | object   | Zmienne środowiskowe ustawiane podczas uruchamiania      |
| `extensions`  | string[] | Rozszerzenia plików, które powinny używać tego formatera |

Spójrzmy na kilka przykładów.

---

### Wyłączanie formaterów

Aby globalnie wyłączyć **wszystkie** formatery, ustaw `formatter` na `false`:

```json title="opencode.json" {3}
{
  "$schema": "https://opencode.ai/config.json",
  "formatter": false
}
```

Aby wyłączyć **określony** formater, ustaw `disabled` na `true`:

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

### Niestandardowe formatery

Możesz dodać niestandardowe formatery, podając polecenie, zmienne środowiskowe i rozszerzenia plików:

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

Symbol zastępczy **`$FILE`** w poleceniu jest zastępowany ścieżką do formatowanego pliku.
