---
title: フォーマッタ
description: OpenCode は言語固有のフォーマッタを使用します。
---

OpenCode は、言語固有のフォーマッタを使用してファイルを作成または編集した後、ファイルを自動的にフォーマットします。これにより、生成されるコードがプロジェクトのコードスタイルに従っていることが保証されます。

---

## 組み込み

OpenCode には、一般的な言語およびフレームワーク用のいくつかの組み込みフォーマッタが付属しています。以下は、フォーマッタ、サポートされているファイル拡張子、および必要なコマンドまたは構成オプションのリストです。

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

したがって、プロジェクトの `prettier` に `package.json` が含まれている場合、OpenCode は自動的にそれを使用します。

---

## 仕組み

OpenCode がファイルを書き込んだり編集したりすると、次のことが行われます。

1. 有効なすべてのフォーマッタに対してファイル拡張子をチェックします。
2. ファイルに対して適切なフォーマッタコマンドを実行します。
3. 書式の変更を自動的に適用します。

このプロセスはバックグラウンドで実行されるため、手動の手順を行わなくてもコードスタイルが維持されます。

---

## 設定

OpenCode 設定の `formatter` セクションを通じてフォーマッタをカスタマイズできます。

```json title="opencode.json"
{
  "$schema": "https://opencode.ai/config.json",
  "formatter": {}
}
```

各フォーマッタ設定は以下をサポートします。

| プロパティ    | タイプ       | 説明                                                       |
| ------------- | ------------ | ---------------------------------------------------------- |
| `disabled`    | ブール値     | フォーマッタを無効にするには、これを `true` に設定します。 |
| `command`     | 文字列[]     | フォーマットのために実行するコマンド                       |
| `environment` | オブジェクト | フォーマッタの実行時に設定する環境変数                     |
| `extensions`  | 文字列[]     | このフォーマッタが処理するファイル拡張子                   |

いくつかの例を見てみましょう。

---

### フォーマッタの無効化

**すべて**のフォーマッタをグローバルに無効にするには、`formatter` を `false` に設定します。

```json title="opencode.json" {3}
{
  "$schema": "https://opencode.ai/config.json",
  "formatter": false
}
```

**特定**のフォーマッタを無効にするには、`disabled` を `true` に設定します。

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

### カスタムフォーマッタ

コマンド、環境変数、ファイル拡張子を指定することで、組み込みフォーマッタをオーバーライドしたり、新しいフォーマッタを追加したりできます。

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

コマンド内の **`$FILE` プレースホルダー** は、フォーマットされるファイルへのパスに置き換えられます。
