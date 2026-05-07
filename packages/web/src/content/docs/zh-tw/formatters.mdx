---
title: 格式化器
description: OpenCode 使用特定語言的格式化器。
---

OpenCode 會在檔案寫入或編輯後，自動使用特定語言的格式化器對其進行格式化。這確保了生成的程式碼遵循您專案的程式碼風格。

---

## 內建格式化器

OpenCode 內建了多種適用於主流語言和框架的格式化器。下表列出了各格式化器、支援的副檔名以及所需的指令或設定選項。

| 格式化器             | 副檔名                                                                                                | 要求                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| air                  | .R                                                                                                    | `air` 指令可用                                                                              |
| biome                | .js, .jsx, .ts, .tsx, .html, .css, .md, .json, .yaml 及[更多](https://biomejs.dev/)                   | `biome.json(c)` 設定檔                                                                      |
| cargofmt             | .rs                                                                                                   | `cargo fmt` 指令可用                                                                        |
| clang-format         | .c, .cpp, .h, .hpp, .ino 及[更多](https://clang.llvm.org/docs/ClangFormat.html)                       | `.clang-format` 設定檔                                                                      |
| cljfmt               | .clj, .cljs, .cljc, .edn                                                                              | `cljfmt` 指令可用                                                                           |
| dart                 | .dart                                                                                                 | `dart` 指令可用                                                                             |
| dfmt                 | .d                                                                                                    | `dfmt` 指令可用                                                                             |
| gleam                | .gleam                                                                                                | `gleam` 指令可用                                                                            |
| gofmt                | .go                                                                                                   | `gofmt` 指令可用                                                                            |
| htmlbeautifier       | .erb, .html.erb                                                                                       | `htmlbeautifier` 指令可用                                                                   |
| ktlint               | .kt, .kts                                                                                             | `ktlint` 指令可用                                                                           |
| mix                  | .ex, .exs, .eex, .heex, .leex, .neex, .sface                                                          | `mix` 指令可用                                                                              |
| nixfmt               | .nix                                                                                                  | `nixfmt` 指令可用                                                                           |
| ocamlformat          | .ml, .mli                                                                                             | `ocamlformat` 指令可用且存在 `.ocamlformat` 設定檔                                          |
| ormolu               | .hs                                                                                                   | `ormolu` 指令可用                                                                           |
| oxfmt (Experimental) | .js, .jsx, .ts, .tsx                                                                                  | `package.json` 中有 `oxfmt` 相依套件，且設定了[實驗性環境變數旗標](/docs/cli/#experimental) |
| pint                 | .php                                                                                                  | `composer.json` 中有 `laravel/pint` 相依套件                                                |
| prettier             | .js, .jsx, .ts, .tsx, .html, .css, .md, .json, .yaml 及[更多](https://prettier.io/docs/en/index.html) | `package.json` 中有 `prettier` 相依套件                                                     |
| rubocop              | .rb, .rake, .gemspec, .ru                                                                             | `rubocop` 指令可用                                                                          |
| ruff                 | .py, .pyi                                                                                             | `ruff` 指令可用且有相應設定                                                                 |
| rustfmt              | .rs                                                                                                   | `rustfmt` 指令可用                                                                          |
| shfmt                | .sh, .bash                                                                                            | `shfmt` 指令可用                                                                            |
| standardrb           | .rb, .rake, .gemspec, .ru                                                                             | `standardrb` 指令可用                                                                       |
| terraform            | .tf, .tfvars                                                                                          | `terraform` 指令可用                                                                        |
| uv                   | .py, .pyi                                                                                             | `uv` 指令可用                                                                               |
| zig                  | .zig, .zon                                                                                            | `zig` 指令可用                                                                              |

因此，如果您的專案 `package.json` 中包含 `prettier`，OpenCode 會自動使用它進行格式化。

---

## 工作原理

當 OpenCode 寫入或編輯檔案時，它會：

1. 根據所有已啟用的格式化器檢查副檔名。
2. 對檔案執行相應的格式化指令。
3. 自動套用格式化變更。

整個過程在背景完成，無需任何手動操作即可保持程式碼風格的一致性。

---

## 設定

您可以透過 OpenCode 設定中的 `formatter` 部分自訂格式化器。

```json title="opencode.json"
{
  "$schema": "https://opencode.ai/config.json",
  "formatter": {}
}
```

每個格式化器的設定支援以下屬性：

| 屬性          | 型別     | 說明                         |
| ------------- | -------- | ---------------------------- |
| `disabled`    | boolean  | 設為 `true` 可停用該格式化器 |
| `command`     | string[] | 執行格式化的指令             |
| `environment` | object   | 執行格式化器時設定的環境變數 |
| `extensions`  | string[] | 該格式化器處理的副檔名       |

下面來看一些範例。

---

### 停用格式化器

要全域停用**所有**格式化器，將 `formatter` 設為 `false`：

```json title="opencode.json" {3}
{
  "$schema": "https://opencode.ai/config.json",
  "formatter": false
}
```

要停用**特定**格式化器，將 `disabled` 設為 `true`：

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

### 自訂格式化器

您可以透過指定指令、環境變數和副檔名來覆寫內建格式化器或新增新的格式化器：

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

指令中的 **`$FILE` 佔位符**會被替換為待格式化檔案的路徑。
