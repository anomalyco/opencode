---
title: Formattatori
description: OpenCode usa formattatori specifici per linguaggio.
---

OpenCode formatta automaticamente i file dopo che vengono scritti o modificati usando formattatori specifici per linguaggio. Questo assicura che il codice generato segua lo stile del tuo progetto.

---

## Integrati

OpenCode include diversi formattatori integrati per linguaggi e framework popolari. Qui sotto trovi la lista dei formattatori, delle estensioni supportate e dei comandi o opzioni di config richiesti.

| Formattatore         | Estensioni                                                                                               | Requisiti                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| air                  | .R                                                                                                       | comando `air` disponibile                                                                                    |
| biome                | .js, .jsx, .ts, .tsx, .html, .css, .md, .json, .yaml, and [more](https://biomejs.dev/)                   | file di configurazione `biome.json(c)`                                                                       |
| cargofmt             | .rs                                                                                                      | comando `cargo fmt` disponibile                                                                              |
| clang-format         | .c, .cpp, .h, .hpp, .ino, and [more](https://clang.llvm.org/docs/ClangFormat.html)                       | file di configurazione `.clang-format`                                                                       |
| cljfmt               | .clj, .cljs, .cljc, .edn                                                                                 | comando `cljfmt` disponibile                                                                                 |
| dart                 | .dart                                                                                                    | comando `dart` disponibile                                                                                   |
| dfmt                 | .d                                                                                                       | comando `dfmt` disponibile                                                                                   |
| gleam                | .gleam                                                                                                   | comando `gleam` disponibile                                                                                  |
| gofmt                | .go                                                                                                      | comando `gofmt` disponibile                                                                                  |
| htmlbeautifier       | .erb, .html.erb                                                                                          | comando `htmlbeautifier` disponibile                                                                         |
| ktlint               | .kt, .kts                                                                                                | comando `ktlint` disponibile                                                                                 |
| mix                  | .ex, .exs, .eex, .heex, .leex, .neex, .sface                                                             | comando `mix` disponibile                                                                                    |
| nixfmt               | .nix                                                                                                     | comando `nixfmt` disponibile                                                                                 |
| ocamlformat          | .ml, .mli                                                                                                | comando `ocamlformat` disponibile e file di configurazione `.ocamlformat`                                    |
| ormolu               | .hs                                                                                                      | comando `ormolu` disponibile                                                                                 |
| oxfmt (Experimental) | .js, .jsx, .ts, .tsx                                                                                     | dipendenza `oxfmt` in `package.json` e una [flag variabile d'ambiente sperimentale](/docs/cli/#experimental) |
| pint                 | .php                                                                                                     | dipendenza `laravel/pint` in `composer.json`                                                                 |
| prettier             | .js, .jsx, .ts, .tsx, .html, .css, .md, .json, .yaml, and [more](https://prettier.io/docs/en/index.html) | dipendenza `prettier` in `package.json`                                                                      |
| rubocop              | .rb, .rake, .gemspec, .ru                                                                                | comando `rubocop` disponibile                                                                                |
| ruff                 | .py, .pyi                                                                                                | comando `ruff` disponibile con config                                                                        |
| rustfmt              | .rs                                                                                                      | comando `rustfmt` disponibile                                                                                |
| shfmt                | .sh, .bash                                                                                               | comando `shfmt` disponibile                                                                                  |
| standardrb           | .rb, .rake, .gemspec, .ru                                                                                | comando `standardrb` disponibile                                                                             |
| terraform            | .tf, .tfvars                                                                                             | comando `terraform` disponibile                                                                              |
| uv                   | .py, .pyi                                                                                                | comando `uv` disponibile                                                                                     |
| zig                  | .zig, .zon                                                                                               | comando `zig` disponibile                                                                                    |

Quindi, se il progetto ha `prettier` in `package.json`, OpenCode lo usera automaticamente.

---

## Come funziona

Quando OpenCode scrive o modifica un file:

1. Controlla l'estensione del file rispetto a tutti i formattatori abilitati.
2. Esegue il comando del formattatore appropriato sul file.
3. Applica automaticamente le modifiche di formattazione.

Questo processo avviene in background, mantenendo lo stile del codice senza passaggi manuali.

---

## Configurazione

Puoi personalizzare i formattatori nella sezione `formatter` della config di OpenCode.

```json title="opencode.json"
{
  "$schema": "https://opencode.ai/config.json",
  "formatter": {}
}
```

Ogni configurazione di formattatore supporta:

| Proprieta     | Tipo     | Descrizione                                         |
| ------------- | -------- | --------------------------------------------------- |
| `disabled`    | boolean  | Impostalo a `true` per disabilitare il formattatore |
| `command`     | string[] | Il comando da eseguire per la formattazione         |
| `environment` | object   | Variabili d'ambiente da impostare quando si esegue  |
| `extensions`  | string[] | Estensioni file gestite da questo formattatore      |

Vediamo alcuni esempi.

---

### Disabilitare i formattatori

Per disabilitare **tutti** i formattatori globalmente, imposta `formatter` a `false`:

```json title="opencode.json" {3}
{
  "$schema": "https://opencode.ai/config.json",
  "formatter": false
}
```

Per disabilitare un formattatore **specifico**, imposta `disabled` a `true`:

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

### Formattatori personalizzati

Puoi sovrascrivere i formattatori integrati o aggiungerne di nuovi specificando comando, variabili d'ambiente ed estensioni file:

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

Il **placeholder `$FILE`** nel comando viene sostituito con il percorso del file in fase di formattazione.
