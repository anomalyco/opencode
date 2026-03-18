---
title: Formattere
description: OpenCode bruker språkspesifikke formattere.
---

OpenCode formaterer automatisk filer etter at de er skrevet eller redigert ved hjelp av språkspesifikke formattere. Dette sikrer at koden som genereres følger kodestilene til prosjektet ditt.

---

## Innebygde formattere

OpenCode kommer med flere innebygde formattere for populære språk og rammeverk. Nedenfor er en liste over formattere, støttede filendelser og kommandoer eller konfigurasjonsalternativer den krever.

| Formatter              | Filendelser                                                                                             | Krav                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| gofmt                  | .go                                                                                                     | `gofmt` kommando tilgjengelig                                                                           |
| mix                    | .ex, .exs, .eex, .heex, .leex, .neex, .sface                                                            | `mix` kommando tilgjengelig                                                                             |
| prettier               | .js, .jsx, .ts, .tsx, .html, .css, .md, .json, .yaml og [flere](https://prettier.io/docs/en/index.html) | `prettier` avhengighet i `package.json`                                                                 |
| biome                  | .js, .jsx, .ts, .tsx, .html, .css, .md, .json, .yaml og [flere](https://biomejs.dev/)                   | `biome.json(c)` konfigurasjonsfil                                                                       |
| zig                    | .zig, .zon                                                                                              | `zig` kommando tilgjengelig                                                                             |
| clang-format           | .c, .cpp, .h, .hpp, .ino og [flere](https://clang.llvm.org/docs/ClangFormat.html)                       | `.clang-format` konfigurasjonsfil                                                                       |
| ktlint                 | .kt, .kts                                                                                               | `ktlint` kommando tilgjengelig                                                                          |
| ruff                   | .py, .pyi                                                                                               | `ruff` kommando tilgjengelig med config                                                                 |
| rustfmt                | .rs                                                                                                     | `rustfmt` kommando tilgjengelig                                                                         |
| cargofmt               | .rs                                                                                                     | `cargo fmt` kommando tilgjengelig                                                                       |
| uv                     | .py, .pyi                                                                                               | `uv` kommando tilgjengelig                                                                              |
| rubocop                | .rb, .rake, .gemspec, .ru                                                                               | `rubocop` kommando tilgjengelig                                                                         |
| standardrb             | .rb, .rake, .gemspec, .ru                                                                               | `standardrb` kommando tilgjengelig                                                                      |
| htmlbeautifier         | .erb, .html.erb                                                                                         | `htmlbeautifier` kommando tilgjengelig                                                                  |
| air                    | .R                                                                                                      | `air` kommando tilgjengelig                                                                             |
| dart                   | .dart                                                                                                   | `dart` kommando tilgjengelig                                                                            |
| dfmt                   | .d                                                                                                      | `dfmt` kommando tilgjengelig                                                                            |
| ocamlformat            | .ml, .mli                                                                                               | `ocamlformat` kommando tilgjengelig og `.ocamlformat` konfigurasjonsfil                                 |
| terraform              | .tf, .tfvars                                                                                            | `terraform` kommando tilgjengelig                                                                       |
| gleam                  | .gleam                                                                                                  | `gleam` kommando tilgjengelig                                                                           |
| nixfmt                 | .nix                                                                                                    | `nixfmt` kommando tilgjengelig                                                                          |
| shfmt                  | .sh, .bash                                                                                              | `shfmt` kommando tilgjengelig                                                                           |
| pint                   | .php                                                                                                    | `laravel/pint` avhengighet i `composer.json`                                                            |
| oxfmt (Eksperimentell) | .js, .jsx, .ts, .tsx                                                                                    | `oxfmt` avhengighet i `package.json` og et [eksperimentelt env variabel flagg](/docs/cli/#experimental) |
| ormolu                 | .hs                                                                                                     | `ormolu` kommando tilgjengelig                                                                          |

Så hvis prosjektet ditt har `prettier` i `package.json`, vil OpenCode automatisk bruke det.

---

## Slik fungerer det

Når OpenCode skriver eller redigerer en fil, gjør den:

1. Kontrollerer filtypen mot alle aktiverte formattere.
2. Kjører riktig formateringskommando på filen.
3. Bruker formateringsendringene automatisk.

Denne prosessen skjer i bakgrunnen, og sikrer at kodestilene dine opprettholdes uten noen manuelle trinn.

---

## Konfigurasjon

Du kan tilpasse formattere gjennom `formatter`-delen i OpenCode-konfigurasjonen.

```json title="opencode.json"
{
  "$schema": "https://opencode.ai/config.json",
  "formatter": {}
}
```

Hver formateringskonfigurasjon støtter følgende:

| Egenskap      | Type     | Beskrivelse                                                     |
| ------------- | -------- | --------------------------------------------------------------- |
| `disabled`    | boolean  | Sett dette til `true` for å deaktivere formatteren              |
| `command`     | string[] | Kommandoen som skal kjøres for formatering                      |
| `environment` | object   | Miljøvariabler som skal settes når formateringsverktøyet kjøres |
| `extensions`  | string[] | Filendelser denne formatteren skal håndtere                     |

La oss se på noen eksempler.

---

### Deaktivering av formattere

For å deaktivere **alle** formattere globalt, sett `formatter` til `false`:

```json title="opencode.json" {3}
{
  "$schema": "https://opencode.ai/config.json",
  "formatter": false
}
```

For å deaktivere en **spesifikk** formatter, sett `disabled` til `true`:

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

### Egendefinerte formattere

Du kan overstyre de innebygde formatterne eller legge til nye ved å spesifisere kommandoen, miljøvariablene og filtypene:

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

**Plassholderen $FILE** i kommandoen vil bli erstattet med banen til filen som formateres.
