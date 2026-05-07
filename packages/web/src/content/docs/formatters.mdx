---
title: Formatters
description: OpenCode uses language specific formatters.
---

OpenCode can format files after they are written or edited using language-specific formatters. Formatters are disabled by default; enable them in your config before OpenCode will run them.

---

## Built-in

OpenCode comes with several built-in formatters for popular languages and frameworks. Below is a list of the formatters, supported file extensions, and commands or config options it needs.

| Formatter            | Extensions                                                                                               | Requirements                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| air                  | .R                                                                                                       | `air` command available                                                                               |
| biome                | .js, .jsx, .ts, .tsx, .html, .css, .md, .json, .yaml, and [more](https://biomejs.dev/)                   | `biome.json(c)` config file                                                                           |
| cargofmt             | .rs                                                                                                      | `cargo fmt` command available                                                                         |
| clang-format         | .c, .cpp, .h, .hpp, .ino, and [more](https://clang.llvm.org/docs/ClangFormat.html)                       | `.clang-format` config file                                                                           |
| cljfmt               | .clj, .cljs, .cljc, .edn                                                                                 | `cljfmt` command available                                                                            |
| dart                 | .dart                                                                                                    | `dart` command available                                                                              |
| dfmt                 | .d                                                                                                       | `dfmt` command available                                                                              |
| gleam                | .gleam                                                                                                   | `gleam` command available                                                                             |
| gofmt                | .go                                                                                                      | `gofmt` command available                                                                             |
| htmlbeautifier       | .erb, .html.erb                                                                                          | `htmlbeautifier` command available                                                                    |
| ktlint               | .kt, .kts                                                                                                | `ktlint` command available                                                                            |
| mix                  | .ex, .exs, .eex, .heex, .leex, .neex, .sface                                                             | `mix` command available                                                                               |
| nixfmt               | .nix                                                                                                     | `nixfmt` command available                                                                            |
| ocamlformat          | .ml, .mli                                                                                                | `ocamlformat` command available and `.ocamlformat` config file                                        |
| ormolu               | .hs                                                                                                      | `ormolu` command available                                                                            |
| oxfmt (Experimental) | .js, .jsx, .ts, .tsx                                                                                     | `oxfmt` dependency in `package.json` and an [experimental env variable flag](/docs/cli/#experimental) |
| pint                 | .php                                                                                                     | `laravel/pint` dependency in `composer.json`                                                          |
| prettier             | .js, .jsx, .ts, .tsx, .html, .css, .md, .json, .yaml, and [more](https://prettier.io/docs/en/index.html) | `prettier` dependency in `package.json`                                                               |
| rubocop              | .rb, .rake, .gemspec, .ru                                                                                | `rubocop` command available                                                                           |
| ruff                 | .py, .pyi                                                                                                | `ruff` command available with config                                                                  |
| rustfmt              | .rs                                                                                                      | `rustfmt` command available                                                                           |
| shfmt                | .sh, .bash                                                                                               | `shfmt` command available                                                                             |
| standardrb           | .rb, .rake, .gemspec, .ru                                                                                | `standardrb` command available                                                                        |
| terraform            | .tf, .tfvars                                                                                             | `terraform` command available                                                                         |
| uv                   | .py, .pyi                                                                                                | `uv` command available                                                                                |
| zig                  | .zig, .zon                                                                                               | `zig` command available                                                                               |

When formatters are enabled, OpenCode will use `prettier` for matching files if your project has `prettier` in `package.json`.

---

## How it works

When OpenCode writes or edits a file and formatters are enabled, it:

1. Checks the file extension against all enabled formatters.
2. Runs the appropriate formatter command on the file.
3. Applies the formatting changes.

This process happens in the background for enabled formatters.

---

## Configure

You can enable and customize formatters through the `formatter` section in your OpenCode config.

To enable all built-in formatters, set `formatter` to `true`.

```json title="opencode.json"
{
  "$schema": "https://opencode.ai/config.json",
  "formatter": true
}
```

Use an object to keep built-ins enabled while configuring overrides or custom formatters.

```json title="opencode.json"
{
  "$schema": "https://opencode.ai/config.json",
  "formatter": {}
}
```

Each formatter configuration supports the following:

| Property      | Type     | Description                                                                                |
| ------------- | -------- | ------------------------------------------------------------------------------------------ |
| `disabled`    | boolean  | Set this to `true` to disable the formatter                                                |
| `command`     | string[] | The command to run for formatting. Required for custom formatters; optional for built-ins. |
| `environment` | object   | Environment variables to set when running the formatter                                    |
| `extensions`  | string[] | File extensions this formatter should handle                                               |

Let's look at some examples.

---

### Disabling formatters

If `formatter` is omitted, all formatters are disabled. To disable all formatters after another config enabled them, set `formatter` to `false`:

```json title="opencode.json" {3}
{
  "$schema": "https://opencode.ai/config.json",
  "formatter": false
}
```

To disable a **specific** formatter, set `disabled` to `true`:

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

### Custom formatters

You can configure built-in formatters with options like `environment` or `extensions`. To add a custom formatter, specify a `command` and `extensions`:

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

The **`$FILE` placeholder** in the command will be replaced with the path to the file being formatted.
