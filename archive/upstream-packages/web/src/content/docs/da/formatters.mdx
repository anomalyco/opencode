---
title: Formatere
description: OpenCode bruger sprogspecifikke formatere.
---

OpenCode formaterer automatisk filer, efter de er skrevet eller redigeret ved hjælp af sprogspecifikke formatere. Dette sikrer, at den kode, der genereres, følger kodestilene for dit projekt.

---

## Indbyggede

OpenCode leveres med flere indbyggede formatere til populære sprog og rammer. Nedenfor er en liste over de formatere, understøttede filtypenavne og kommandoer eller konfigurationsmuligheder, der har brug for.

| Formater              | Udvidelser                                                                                     | Krav                                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| gofmt                 | .go                                                                                            | `gofmt` kommando tilgængelig                                                                         |
| blande                | .ex,.exs,.eex,.heex,.leex,.neex,.sface                                                         | `mix` kommando tilgængelig                                                                           |
| smukkere              | .js,.jsx,.ts,.tsx,.html,.css,.md,.json,.yaml og [more](https://prettier.io/docs/en/index.html) | `prettier` afhængighed i `package.json`                                                              |
| biome                 | .js,.jsx,.ts,.tsx,.html,.css,.md,.json,.yaml og [more](https://biomejs.dev/)                   | `biome.json(c)` konfigurationsfil                                                                    |
| zig                   | .zig,.zon                                                                                      | `zig` kommando tilgængelig                                                                           |
| klang-format          | .c,.cpp,.h,.hpp,.ino og [more](https://clang.llvm.org/docs/ClangFormat.html)                   | `.clang-format` konfigurationsfil                                                                    |
| ktlint                | .kt,.kts                                                                                       | `ktlint` kommando tilgængelig                                                                        |
| ruff                  | .py,.pyi                                                                                       | `ruff` kommando tilgængelig med konfiguration                                                        |
| rustfmt               | .rs                                                                                            | `rustfmt` kommando tilgængelig                                                                       |
| cargofmt              | .rs                                                                                            | `cargo fmt` kommando tilgængelig                                                                     |
| uv                    | .py,.pyi                                                                                       | `uv` kommando tilgængelig                                                                            |
| rubocop               | .rb,.rake,.gemspec,.ru                                                                         | `rubocop` kommando tilgængelig                                                                       |
| standardrb            | .rb,.rake,.gemspec,.ru                                                                         | `standardrb` kommando tilgængelig                                                                    |
| htmlbeautifier        | .erb,.html.erb                                                                                 | `htmlbeautifier` kommando tilgængelig                                                                |
| luft                  | .R                                                                                             | `air` kommando tilgængelig                                                                           |
| dart                  | .dart                                                                                          | `dart` kommando tilgængelig                                                                          |
| dfmt                  | .d                                                                                             | `dfmt` kommando tilgængelig                                                                          |
| ocamlformat           | .ml,.mli                                                                                       | `ocamlformat` kommando tilgængelig og `.ocamlformat` config fil                                      |
| terraform             | .tf,.tfvars                                                                                    | `terraform` kommando tilgængelig                                                                     |
| glimt                 | .glimt                                                                                         | `gleam` kommando tilgængelig                                                                         |
| nixfmt                | .nix                                                                                           | `nixfmt` kommando tilgængelig                                                                        |
| shfmt                 | .sh,.bash                                                                                      | `shfmt` kommando tilgængelig                                                                         |
| pint                  | .php                                                                                           | `laravel/pint` afhængighed i `composer.json`                                                         |
| oxfmt (Eksperimentel) | .js,.jsx,.ts,.tsx                                                                              | `oxfmt` afhængighed i `package.json` og en [experimental env variable flag](/docs/cli/#experimental) |
| ormolu                | .hs                                                                                            | `ormolu` kommando tilgængelig                                                                        |

Så hvis dit projekt har `prettier` i din `package.json`, vil OpenCode automatisk bruge det.

---

## Sådan fungerer det

Når OpenCode skriver eller redigerer en fil, vil det:

1. Kontrollerer filtypenavnet mod alle aktiverede formatere.
2. Kører den relevante formateringskommando på filen.
3. Anvender formateringsændringerne automatisk.

Denne proces sker i baggrunden, hvilket sikrer, at dine kodestile vedligeholdes uden nogen manuelle trin.

---

## Konfiguration

Du kan tilpasse formatere gennem afsnittet `formatter` i din OpenCode-konfiguration.

```json title="opencode.json"
{
  "$schema": "https://opencode.ai/config.json",
  "formatter": {}
}
```

Hver formateringskonfiguration understøtter følgende:

| Ejendom       | Skriv    | Beskrivelse                                                          |
| ------------- | -------- | -------------------------------------------------------------------- |
| `disabled`    | boolean  | Indstil dette til `true` for at deaktivere formateringsværktøjet     |
| `command`     | string[] | Kommandoen til at køre for formatering                               |
| `environment` | object   | Miljøvariabler, der skal indstilles, når formateringsværktøjet køres |
| `extensions`  | string[] | Filtypenavne, som denne formaterer skal håndtere                     |

Lad os se på nogle eksempler.

---

### Deaktivering af formatere

For at deaktivere **alle** formatere globalt, skal du indstille `formatter` til `false`:

```json title="opencode.json" {3}
{
  "$schema": "https://opencode.ai/config.json",
  "formatter": false
}
```

For at deaktivere en **specifik** formatter, skal du indstille `disabled` til `true`:

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

### Brugerdefinerede formatere

Du kan tilsidesætte de indbyggede formattere eller tilføje nye ved at angive kommandoen, miljøvariabler og filtypenavne:

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

**`$FILE` pladsholderen** i kommandoen vil blive erstattet med stien til filen, der formateres.
