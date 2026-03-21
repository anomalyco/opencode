---
title: Formateri
description: OpenCode koristi formatere specifične za jezik.
---

OpenCode automatski formatira datoteke nakon što su napisane ili uređene pomoću formatera specifičnih za jezik. Ovo osigurava da kod koji se generira prati stilove koda vašeg projekta.

---

## Ugrađeni

OpenCode dolazi sa nekoliko ugrađenih formatera za popularne jezike i okvire. Ispod je lista formatera, podržanih ekstenzija datoteka i naredbi ili opcija konfiguracije koje su mu potrebne.
| Formatter | Ekstenzije | Zahtjevi
|-------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| gofmt | .go | `gofmt` komanda dostupna |
| mix | .ex, .exs, .eex, .heex, .leex, .neex, .sface | `mix` komanda dostupna |
| prettier | .js, .jsx, .ts, .tsx, .html, .css, .md, .json, .yaml i [više](https://prettier.io/docs/en/index.html) | `prettier` zavisnost u `package.json` |
| biome | .js, .jsx, .ts, .tsx, .html, .css, .md, .json, .yaml i [više](https://biomejs.dev/) | `biome.json(c)` konfiguracijski fajl |
| zig | .zig, .zon | `zig` komanda dostupna |
| clang-format | .c, .cpp, .h, .hpp, .ino i [više](https://clang.llvm.org/docs/ClangFormat.html) | `.clang-format` konfiguracijski fajl |
| ktlint | .kt, .kts | `ktlint` komanda dostupna |
| ruff | .py, .pyi | `ruff` komanda dostupna sa konfiguracijom |
| rustfmt | .rs | `rustfmt` komanda dostupna |
| cargofmt | .rs | `cargo fmt` komanda dostupna |
| uv | .py, .pyi | `uv` komanda dostupna || rubocop | .rb, .rake, .gemspec, .ru | `rubocop` komanda dostupna |
| standardrb | .rb, .rake, .gemspec, .ru | `standardrb` komanda dostupna |
| htmlbeautifier | .erb, .html.erb | `htmlbeautifier` komanda dostupna |
| air | .R | `air` komanda dostupna |
| dart | .dart | `dart` komanda dostupna |
| dfmt | .d | `dfmt` komanda dostupna |
| ocamlformat | .ml, .mli | `ocamlformat` komanda dostupna i `.ocamlformat` konfiguracioni fajl |
| terraform | .tf, .tfvars | `terraform` komanda dostupna |
| gleam | .bleam | `gleam` komanda dostupna |
| nixfmt | .nix | `nixfmt` komanda dostupna |
| shfmt | .sh, .bash | `shfmt` komanda dostupna |
| pint | .php | `laravel/pint` zavisnost u `composer.json` || oxfmt (Eksperimentalno) | .js, .jsx, .ts, .tsx | `oxfmt` zavisnost u `package.json` i [eksperimentalna env varijabla flag](/docs/cli/#experimental) |
| ormolu | .hs | `ormolu` komanda dostupna |
Dakle, ako vaš projekat ima `prettier` u vašem `package.json`, OpenCode će ga automatski koristiti.

---

## Kako radi

Kada OpenCode piše ili uređuje datoteku, on:

1. Provjerava ekstenziju datoteke prema svim omogućenim formaterima.
2. Pokreće odgovarajuću naredbu za formatiranje na datoteci.
3. Automatski primjenjuje promjene formatiranja.
   Ovaj proces se događa u pozadini, osiguravajući da se vaši stilovi koda održavaju bez ikakvih ručnih koraka.

---

## Konfiguracija

Možete prilagoditi formatere kroz `formatter` odjeljak u vašoj OpenCode konfiguraciji.

```json title="opencode.json"
{
  "$schema": "https://opencode.ai/config.json",
  "formatter": {}
}
```

Svaka konfiguracija formatera podržava sljedeće:
| Svojstvo | Vrsta | Opis
|------------- | -------- | ------------------------------------------------------- |
| `disabled` | boolean | Postavite ovo na `true` da onemogućite formater |
| `command` | string[] | Naredba za pokretanje za formatiranje |
| `environment` | objekt | Varijable okruženja koje treba postaviti prilikom pokretanja formatera |
| `extensions` | string[] | Ekstenzije datoteka koje ovaj formater treba da obrađuje |
Pogledajmo neke primjere.

---

### Onemogućavanje formatera

Da onemogućite **sve** formatere globalno, postavite `formatter` na `false`:

```json title="opencode.json" {3}
{
  "$schema": "https://opencode.ai/config.json",
  "formatter": false
}
```

Da onemogućite **specifični** formater, postavite `disabled` na `true`:

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

### Prilagođeni formateri

Možete nadjačati ugrađene formatere ili dodati nove navođenjem naredbe, varijabli okruženja i ekstenzija datoteke:

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

**`$FILE` čuvar mjesta** u naredbi će biti zamijenjen putanjom do datoteke koja se formatira.
