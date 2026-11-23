---
title: Formateurs
description: OpenCode utilise des formateurs spécifiques au langage.
---

OpenCode formate automatiquement les fichiers après leur écriture ou leur modification à l'aide de formateurs spécifiques au langage. Cela garantit que le code généré suit les styles de code de votre projet.

---

## Formateurs intégrés

OpenCode est livré avec plusieurs formateurs intégrés pour les langages et frameworks populaires. Vous trouverez ci-dessous une liste des formateurs, des extensions de fichiers prises en charge et des commandes ou options de configuration dont il a besoin.

| Formateur            | Extensions                                                                                             | Prérequis                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| gofmt                | .go                                                                                                    | Commande `gofmt` disponible                                                                                           |
| mix                  | .ex, .exs, .eex, .heex, .leex, .neex, .sface                                                           | Commande `mix` disponible                                                                                             |
| prettier             | .js, .jsx, .ts, .tsx, .html, .css, .md, .json, .yaml et [plus](https://prettier.io/docs/en/index.html) | Dépendance `prettier` dans `package.json`                                                                             |
| biome                | .js, .jsx, .ts, .tsx, .html, .css, .md, .json, .yaml et [plus](https://biomejs.dev/)                   | Fichier de configuration `biome.json(c)`                                                                              |
| zig                  | .zig, .zon                                                                                             | Commande `zig` disponible                                                                                             |
| clang-format         | .c, .cpp, .h, .hpp, .ino et [plus](https://clang.llvm.org/docs/ClangFormat.html)                       | Fichier de configuration `.clang-format`                                                                              |
| ktlint               | .kt, .kts                                                                                              | Commande `ktlint` disponible                                                                                          |
| ruff                 | .py, .pyi                                                                                              | Commande `ruff` disponible avec config                                                                                |
| rustfmt              | .rs                                                                                                    | Commande `rustfmt` disponible                                                                                         |
| cargofmt             | .rs                                                                                                    | Commande `cargo fmt` disponible                                                                                       |
| uv                   | .py, .pyi                                                                                              | Commande `uv` disponible                                                                                              |
| rubocop              | .rb, .rake, .gemspec, .ru                                                                              | Commande `rubocop` disponible                                                                                         |
| standardrb           | .rb, .rake, .gemspec, .ru                                                                              | Commande `standardrb` disponible                                                                                      |
| htmlbeautifier       | .erb, .html.erb                                                                                        | Commande `htmlbeautifier` disponible                                                                                  |
| air                  | .R                                                                                                     | Commande `air` disponible                                                                                             |
| dart                 | .dart                                                                                                  | Commande `dart` disponible                                                                                            |
| dfmt                 | .d                                                                                                     | Commande `dfmt` disponible                                                                                            |
| ocamlformat          | .ml, .mli                                                                                              | Commande `ocamlformat` disponible et fichier de configuration `.ocamlformat`                                          |
| terraform            | .tf, .tfvars                                                                                           | Commande `terraform` disponible                                                                                       |
| gleam                | .gleam                                                                                                 | Commande `gleam` disponible                                                                                           |
| nixfmt               | .nix                                                                                                   | Commande `nixfmt` disponible                                                                                          |
| shfmt                | .sh, .bash                                                                                             | Commande `shfmt` disponible                                                                                           |
| pint                 | .php                                                                                                   | Dépendance `laravel/pint` dans `composer.json`                                                                        |
| oxfmt (expérimental) | .js, .jsx, .ts, .tsx                                                                                   | Dépendance `oxfmt` dans `package.json` et un [flag de variable d'environnement expérimental](/docs/cli/#experimental) |
| ormolu               | .hs                                                                                                    | Commande `ormolu` disponible                                                                                          |

Ainsi, si votre projet a `prettier` dans votre `package.json`, OpenCode l'utilisera automatiquement.

---

## Comment ça marche

Lorsque OpenCode écrit ou modifie un fichier, il :

1. Vérifie l'extension du fichier par rapport à tous les formateurs activés.
2. Exécute la commande de formatage appropriée sur le fichier.
3. Applique automatiquement les modifications de formatage.

Ce processus se déroule en arrière-plan, garantissant que vos styles de code sont conservés sans aucune étape manuelle.

---

## Configuration

Vous pouvez personnaliser les formateurs via la section `formatter` de votre configuration OpenCode.

```json title="opencode.json"
{
  "$schema": "https://opencode.ai/config.json",
  "formatter": {}
}
```

Chaque configuration du formateur prend en charge les éléments suivants :

| Propriété     | Type     | Description                                                          |
| ------------- | -------- | -------------------------------------------------------------------- |
| `disabled`    | booléen  | Définissez ceci sur `true` pour désactiver le formateur              |
| `command`     | chaîne[] | La commande à exécuter pour le formatage                             |
| `environment` | objet    | Variables d'environnement à définir lors de l'exécution du formateur |
| `extensions`  | chaîne[] | Extensions de fichiers que ce formateur doit gérer                   |

Regardons quelques exemples.

---

### Désactivation des formateurs

Pour désactiver **tous** les formateurs globalement, définissez `formatter` sur `false` :

```json title="opencode.json" {3}
{
  "$schema": "https://opencode.ai/config.json",
  "formatter": false
}
```

Pour désactiver un formateur **spécifique**, définissez `disabled` sur `true` :

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

### Formateurs personnalisés

Vous pouvez remplacer les formateurs intégrés ou en ajouter de nouveaux en spécifiant la commande, les variables d'environnement et les extensions de fichier :

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

L'espace réservé **`$FILE`** dans la commande sera remplacé par le chemin d'accès au fichier en cours de formatage.
