---
title: 格式化工具
description: OpenCode 使用特定语言的格式化工具。
---

OpenCode 会在文件写入或编辑后，自动使用特定语言的格式化工具对其进行格式化。这确保了生成的代码遵循你项目的代码风格。

---

## 内置格式化工具

OpenCode 内置了多种适用于主流语言和框架的格式化工具。下表列出了各格式化工具、支持的文件扩展名以及所需的命令或配置选项。

| 格式化工具           | 扩展名                                                                                                | 要求                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| air                  | .R                                                                                                    | `air` 命令可用                                                                          |
| biome                | .js, .jsx, .ts, .tsx, .html, .css, .md, .json, .yaml 及[更多](https://biomejs.dev/)                   | `biome.json(c)` 配置文件                                                                |
| cargofmt             | .rs                                                                                                   | `cargo fmt` 命令可用                                                                    |
| clang-format         | .c, .cpp, .h, .hpp, .ino 及[更多](https://clang.llvm.org/docs/ClangFormat.html)                       | `.clang-format` 配置文件                                                                |
| cljfmt               | .clj, .cljs, .cljc, .edn                                                                              | `cljfmt` 命令可用                                                                       |
| dart                 | .dart                                                                                                 | `dart` 命令可用                                                                         |
| dfmt                 | .d                                                                                                    | `dfmt` 命令可用                                                                         |
| gleam                | .gleam                                                                                                | `gleam` 命令可用                                                                        |
| gofmt                | .go                                                                                                   | `gofmt` 命令可用                                                                        |
| htmlbeautifier       | .erb, .html.erb                                                                                       | `htmlbeautifier` 命令可用                                                               |
| ktlint               | .kt, .kts                                                                                             | `ktlint` 命令可用                                                                       |
| mix                  | .ex, .exs, .eex, .heex, .leex, .neex, .sface                                                          | `mix` 命令可用                                                                          |
| nixfmt               | .nix                                                                                                  | `nixfmt` 命令可用                                                                       |
| ocamlformat          | .ml, .mli                                                                                             | `ocamlformat` 命令可用且存在 `.ocamlformat` 配置文件                                    |
| ormolu               | .hs                                                                                                   | `ormolu` 命令可用                                                                       |
| oxfmt (Experimental) | .js, .jsx, .ts, .tsx                                                                                  | `package.json` 中有 `oxfmt` 依赖，且设置了[实验性环境变量标志](/docs/cli/#experimental) |
| pint                 | .php                                                                                                  | `composer.json` 中有 `laravel/pint` 依赖                                                |
| prettier             | .js, .jsx, .ts, .tsx, .html, .css, .md, .json, .yaml 及[更多](https://prettier.io/docs/en/index.html) | `package.json` 中有 `prettier` 依赖                                                     |
| rubocop              | .rb, .rake, .gemspec, .ru                                                                             | `rubocop` 命令可用                                                                      |
| ruff                 | .py, .pyi                                                                                             | `ruff` 命令可用且有相应配置                                                             |
| rustfmt              | .rs                                                                                                   | `rustfmt` 命令可用                                                                      |
| shfmt                | .sh, .bash                                                                                            | `shfmt` 命令可用                                                                        |
| standardrb           | .rb, .rake, .gemspec, .ru                                                                             | `standardrb` 命令可用                                                                   |
| terraform            | .tf, .tfvars                                                                                          | `terraform` 命令可用                                                                    |
| uv                   | .py, .pyi                                                                                             | `uv` 命令可用                                                                           |
| zig                  | .zig, .zon                                                                                            | `zig` 命令可用                                                                          |

因此，如果你的项目 `package.json` 中包含 `prettier`，OpenCode 会自动使用它进行格式化。

---

## 工作原理

当 OpenCode 写入或编辑文件时，它会：

1. 根据所有已启用的格式化工具检查文件扩展名。
2. 对文件运行相应的格式化命令。
3. 自动应用格式化更改。

整个过程在后台完成，无需任何手动操作即可保持代码风格的一致性。

---

## 配置

你可以通过 OpenCode 配置中的 `formatter` 部分自定义格式化工具。

```json title="opencode.json"
{
  "$schema": "https://opencode.ai/config.json",
  "formatter": {}
}
```

每个格式化工具的配置支持以下属性：

| 属性          | 类型     | 描述                           |
| ------------- | -------- | ------------------------------ |
| `disabled`    | boolean  | 设为 `true` 可禁用该格式化工具 |
| `command`     | string[] | 执行格式化的命令               |
| `environment` | object   | 运行格式化工具时设置的环境变量 |
| `extensions`  | string[] | 该格式化工具处理的文件扩展名   |

下面来看一些示例。

---

### 禁用格式化工具

要全局禁用**所有**格式化工具，将 `formatter` 设为 `false`：

```json title="opencode.json" {3}
{
  "$schema": "https://opencode.ai/config.json",
  "formatter": false
}
```

要禁用**特定**格式化工具，将 `disabled` 设为 `true`：

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

### 自定义格式化工具

你可以通过指定命令、环境变量和文件扩展名来覆盖内置格式化工具或添加新的格式化工具：

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

命令中的 **`$FILE` 占位符**会被替换为待格式化文件的路径。
