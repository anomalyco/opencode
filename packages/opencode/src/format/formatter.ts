/**
 * ============================================================================
 * 文件名：formatter.ts
 * 所属包：packages/opencode/src/format
 * ============================================================================
 *
 * 文件作用：
 * 内置格式化器定义。包含所有支持的代码格式化工具的配置。
 *
 * 主要功能：
 * - 定义各种语言/框架的格式化器配置
 * - 检测格式化工具是否可用
 * - 根据项目配置判断是否启用格式化器
 *
 * 依赖关系：
 * - bun：Bun which() 和 spawn() 函数
 * - @/bun：BunProc.which() 获取 Bun 可执行文件路径
 * - @/project/instance：实例状态管理
 * - @/util/filesystem：文件系统工具（findUp）
 * - @/flag/flag：命令行标志位
 *
 * 导出内容：
 * - Info：格式化器信息接口
 * - gofmt：Go 语言格式化器
 * - mix：Elixir 语言格式化器
 * - prettier：通用代码格式化器
 * - oxfmt：实验性 Oxide 格式化器
 * - biome：JavaScript/TypeScript 格式化器
 * - zig：Zig 语言格式化器
 * - clang：C/C++ 语言格式化器
 * - ktlint：Kotlin 语言格式化器
 * - ruff：Python 格式化器
 * - rlang：R 语言格式化器
 * - uvformat：Python UV 格式化器
 * - rubocop：Ruby 格式化器
 * - standardrb：Ruby 标准格式化器
 * - htmlbeautifier：HTML/ERB 格式化器
 * - dart：Dart 语言格式化器
 * - ocamlformat：OCaml 语言格式化器
 * - terraform：Terraform 格式化器
 * - latexindent：LaTeX 格式化器
 * - gleam：Gleam 语言格式化器
 * - shfmt：Shell 脚本格式化器
 * - nixfmt：Nix 格式化器
 * - rustfmt：Rust 格式化器
 * - cargofmt：Cargo 格式化器
 *
 * 格式化器信息结构：
 * - name：格式化器名称
 * - command：执行命令（$FILE 会被替换为文件路径）
 * - environment：环境变量
 * - extensions：支持的文件扩展名
 * - enabled()：检查是否启用的异步函数
 *
 * @package opencode
 * @module format
 */

// 导入可读流转换工具
import { readableStreamToText } from "bun"

// 导入 BunProc 工具
import { BunProc } from "../bun"

// 导入实例状态管理
import { Instance } from "../project/instance"

// 导入文件系统工具
import { Filesystem } from "../util/filesystem"

// 导入命令行标志位
import { Flag } from "@/flag/flag"

/**
 * 格式化器信息接口
 *
 * 描述一个格式化器的配置和启用检查。
 */
export interface Info {
  // 格式化器名称
  name: string
  // 执行命令（$FILE 占位符会被替换为实际文件路径）
  command: string[]
  // 环境变量（可选）
  environment?: Record<string, string>
  // 支持的文件扩展名列表
  extensions: string[]
  // 检查格式化器是否可用的异步函数
  enabled(): Promise<boolean>
}

/**
 * Go 语言格式化器
 *
 * 使用 gofmt 工具格式化 .go 文件。
 */
export const gofmt: Info = {
  name: "gofmt",
  command: ["gofmt", "-w", "$FILE"],
  extensions: [".go"],
  async enabled() {
    // 检查 gofmt 命令是否可用
    return Bun.which("gofmt") !== null
  },
}

/**
 * Elixir 语言格式化器
 *
 * 使用 mix format 命令格式化 Elixir 文件。
 */
export const mix: Info = {
  name: "mix",
  command: ["mix", "format", "$FILE"],
  extensions: [".ex", ".exs", ".eex", ".heex", ".leex", ".neex", ".sface"],
  async enabled() {
    // 检查 mix 命令是否可用
    return Bun.which("mix") !== null
  },
}

/**
 * Prettier 通用代码格式化器
 *
 * 格式化 JavaScript、TypeScript、CSS、HTML、Markdown 等多种文件。
 * 通过检查 package.json 中的依赖来启用。
 */
export const prettier: Info = {
  name: "prettier",
  // 使用 bun x 运行 prettier
  command: [BunProc.which(), "x", "prettier", "--write", "$FILE"],
  environment: {
    // 设置 BUN_BE_BUN 环境变量
    BUN_BE_BUN: "1",
  },
  extensions: [
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".ts",
    ".tsx",
    ".mts",
    ".cts",
    ".html",
    ".htm",
    ".css",
    ".scss",
    ".sass",
    ".less",
    ".vue",
    ".svelte",
    ".json",
    ".jsonc",
    ".yaml",
    ".yml",
    ".toml",
    ".xml",
    ".md",
    ".mdx",
    ".graphql",
    ".gql",
  ],
  async enabled() {
    // 向上查找 package.json
    const items = await Filesystem.findUp("package.json", Instance.directory, Instance.worktree)

    // 检查是否有 prettier 依赖
    for (const item of items) {
      const json = await Bun.file(item).json()
      if (json.dependencies?.prettier) return true
      if (json.devDependencies?.prettier) return true
    }

    return false
  },
}

/**
 * Oxide 实验性格式化器
 *
 * 实验性的 JavaScript/TypeScript 格式化器。
 * 需要设置 OPENCODE_EXPERIMENTAL_OXFMT 标志。
 */
export const oxfmt: Info = {
  name: "oxfmt",
  command: [BunProc.which(), "x", "oxfmt", "$FILE"],
  environment: {
    BUN_BE_BUN: "1",
  },
  extensions: [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"],
  async enabled() {
    // 检查实验性标志
    if (!Flag.OPENCODE_EXPERIMENTAL_OXFMT) return false

    // 检查是否有 oxfmt 依赖
    const items = await Filesystem.findUp("package.json", Instance.directory, Instance.worktree)
    for (const item of items) {
      const json = await Bun.file(item).json()
      if (json.dependencies?.oxfmt) return true
      if (json.devDependencies?.oxfmt) return true
    }

    return false
  },
}

/**
 * Biome 格式化器
 *
 * 快速的 JavaScript/TypeScript 格式化器。
 * 通过查找 biome.json 或 biome.jsonc 配置文件来启用。
 */
export const biome: Info = {
  name: "biome",
  command: [BunProc.which(), "x", "@biomejs/biome", "check", "--write", "$FILE"],
  environment: {
    BUN_BE_BUN: "1",
  },
  extensions: [
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".ts",
    ".tsx",
    ".mts",
    ".cts",
    ".html",
    ".htm",
    ".css",
    ".scss",
    ".sass",
    ".less",
    ".vue",
    ".svelte",
    ".json",
    ".jsonc",
    ".yaml",
    ".yml",
    ".toml",
    ".xml",
    ".md",
    ".mdx",
    ".graphql",
    ".gql",
  ],
  async enabled() {
    // 检查 Biome 配置文件
    const configs = ["biome.json", "biome.jsonc"]
    for (const config of configs) {
      const found = await Filesystem.findUp(config, Instance.directory, Instance.worktree)
      if (found.length > 0) {
        return true
      }
    }
    return false
  },
}

/**
 * Zig 语言格式化器
 *
 * 使用 zig fmt 命令格式化 Zig 文件。
 */
export const zig: Info = {
  name: "zig",
  command: ["zig", "fmt", "$FILE"],
  extensions: [".zig", ".zon"],
  async enabled() {
    // 检查 zig 命令是否可用
    return Bun.which("zig") !== null
  },
}

/**
 * Clang C/C++ 格式化器
 *
 * 使用 clang-format 命令格式化 C/C++ 文件。
 * 通过查找 .clang-format 配置文件来启用。
 */
export const clang: Info = {
  name: "clang-format",
  command: ["clang-format", "-i", "$FILE"],
  extensions: [".c", ".cc", ".cpp", ".cxx", "c++", ".h", ".hh", ".hpp", ".hxx", "h++", ".ino", ".C", ".H"],
  async enabled() {
    // 检查 .clang-format 配置文件
    const items = await Filesystem.findUp(".clang-format", Instance.directory, Instance.worktree)
    return items.length > 0
  },
}

/**
 * Ktlint Kotlin 格式化器
 *
 * 使用 ktlint 命令格式化 Kotlin 文件。
 */
export const ktlint: Info = {
  name: "ktlint",
  command: ["ktlint", "-F", "$FILE"],
  extensions: [".kt", ".kts"],
  async enabled() {
    // 检查 ktlint 命令是否可用
    return Bun.which("ktlint") !== null
  },
}

/**
 * Ruff Python 格式化器
 *
 * 快速的 Python 代码格式化器。
 * 通过查找配置文件或依赖来启用。
 */
export const ruff: Info = {
  name: "ruff",
  command: ["ruff", "format", "$FILE"],
  extensions: [".py", ".pyi"],
  async enabled() {
    // 首先检查 ruff 命令是否可用
    if (!Bun.which("ruff")) return false

    // 检查配置文件
    const configs = ["pyproject.toml", "ruff.toml", ".ruff.toml"]
    for (const config of configs) {
      const found = await Filesystem.findUp(config, Instance.directory, Instance.worktree)
      if (found.length > 0) {
        // 对于 pyproject.toml，需要检查是否包含 [tool.ruff]
        if (config === "pyproject.toml") {
          const content = await Bun.file(found[0]).text()
          if (content.includes("[tool.ruff]")) return true
        } else {
          return true
        }
      }
    }

    // 检查依赖文件中是否包含 ruff
    const deps = ["requirements.txt", "pyproject.toml", "Pipfile"]
    for (const dep of deps) {
      const found = await Filesystem.findUp(dep, Instance.directory, Instance.worktree)
      if (found.length > 0) {
        const content = await Bun.file(found[0]).text()
        if (content.includes("ruff")) return true
      }
    }

    return false
  },
}

/**
 * R 语言格式化器
 *
 * 使用 air 命令格式化 R 文件。
 * 通过运行 air --help 并检查输出来验证是否是 R 语言格式化器。
 */
export const rlang: Info = {
  name: "air",
  command: ["air", "format", "$FILE"],
  extensions: [".R"],
  async enabled() {
    // 检查 air 命令是否可用
    const airPath = Bun.which("air")
    if (airPath == null) return false

    try {
      // 运行 air --help 检查是否是 R 语言格式化器
      const proc = Bun.spawn(["air", "--help"], {
        stdout: "pipe",
        stderr: "pipe",
      })
      await proc.exited
      const output = await readableStreamToText(proc.stdout)

      // 检查输出是否包含 "Air: An R language server and formatter"
      const firstLine = output.split("\n")[0]
      const hasR = firstLine.includes("R language")
      const hasFormatter = firstLine.includes("formatter")
      return hasR && hasFormatter
    } catch (error) {
      return false
    }
  },
}

/**
 * UV Python 格式化器
 *
 * 使用 uv format 命令格式化 Python 文件。
 * 只在 ruff 不可用时启用。
 */
export const uvformat: Info = {
  name: "uv format",
  command: ["uv", "format", "--", "$FILE"],
  extensions: [".py", ".pyi"],
  async enabled() {
    // 如果 ruff 可用，不启用 uv format（避免冲突）
    if (await ruff.enabled()) return false

    // 检查 uv 命令是否可用并支持 format 子命令
    if (Bun.which("uv") !== null) {
      const proc = Bun.spawn(["uv", "format", "--help"], { stderr: "pipe", stdout: "pipe" })
      const code = await proc.exited
      return code === 0
    }

    return false
  },
}

/**
 * RuboCop Ruby 格式化器
 *
 * 使用 rubocop --autocorrect 命令格式化 Ruby 文件。
 */
export const rubocop: Info = {
  name: "rubocop",
  command: ["rubocop", "--autocorrect", "$FILE"],
  extensions: [".rb", ".rake", ".gemspec", ".ru"],
  async enabled() {
    // 检查 rubocop 命令是否可用
    return Bun.which("rubocop") !== null
  },
}

/**
 * StandardRB Ruby 标准格式化器
 *
 * 使用 standardrb --fix 命令格式化 Ruby 文件。
 */
export const standardrb: Info = {
  name: "standardrb",
  command: ["standardrb", "--fix", "$FILE"],
  extensions: [".rb", ".rake", ".gemspec", ".ru"],
  async enabled() {
    // 检查 standardrb 命令是否可用
    return Bun.which("standardrb") !== null
  },
}

/**
 * HTML Beautifier 格式化器
 *
 * 使用 htmlbeautifier 命令格式化 ERB 文件。
 */
export const htmlbeautifier: Info = {
  name: "htmlbeautifier",
  command: ["htmlbeautifier", "$FILE"],
  extensions: [".erb", ".html.erb"],
  async enabled() {
    // 检查 htmlbeautifier 命令是否可用
    return Bun.which("htmlbeautifier") !== null
  },
}

/**
 * Dart 语言格式化器
 *
 * 使用 dart format 命令格式化 Dart 文件。
 */
export const dart: Info = {
  name: "dart",
  command: ["dart", "format", "$FILE"],
  extensions: [".dart"],
  async enabled() {
    // 检查 dart 命令是否可用
    return Bun.which("dart") !== null
  },
}

/**
 * OCaml 语言格式化器
 *
 * 使用 ocamlformat 命令格式化 OCaml 文件。
 * 通过查找 .ocamlformat 配置文件来启用。
 */
export const ocamlformat: Info = {
  name: "ocamlformat",
  command: ["ocamlformat", "-i", "$FILE"],
  extensions: [".ml", ".mli"],
  async enabled() {
    // 首先检查 ocamlformat 命令是否可用
    if (!Bun.which("ocamlformat")) return false

    // 检查 .ocamlformat 配置文件
    const items = await Filesystem.findUp(".ocamlformat", Instance.directory, Instance.worktree)
    return items.length > 0
  },
}

/**
 * Terraform 格式化器
 *
 * 使用 terraform fmt 命令格式化 Terraform 文件。
 */
export const terraform: Info = {
  name: "terraform",
  command: ["terraform", "fmt", "$FILE"],
  extensions: [".tf", ".tfvars"],
  async enabled() {
    // 检查 terraform 命令是否可用
    return Bun.which("terraform") !== null
  },
}

/**
 * LaTeX 格式化器
 *
 * 使用 latexindent 命令格式化 LaTeX 文件。
 */
export const latexindent: Info = {
  name: "latexindent",
  command: ["latexindent", "-w", "-s", "$FILE"],
  extensions: [".tex"],
  async enabled() {
    // 检查 latexindent 命令是否可用
    return Bun.which("latexindent") !== null
  },
}

/**
 * Gleam 语言格式化器
 *
 * 使用 gleam format 命令格式化 Gleam 文件。
 */
export const gleam: Info = {
  name: "gleam",
  command: ["gleam", "format", "$FILE"],
  extensions: [".gleam"],
  async enabled() {
    // 检查 gleam 命令是否可用
    return Bun.which("gleam") !== null
  },
}

/**
 * Shell 脚本格式化器
 *
 * 使用 shfmt 命令格式化 Shell 脚本。
 */
export const shfmt: Info = {
  name: "shfmt",
  command: ["shfmt", "-w", "$FILE"],
  extensions: [".sh", ".bash"],
  async enabled() {
    // 检查 shfmt 命令是否可用
    return Bun.which("shfmt") !== null
  },
}

/**
 * Nix 格式化器
 *
 * 使用 nixfmt 命令格式化 Nix 文件。
 */
export const nixfmt: Info = {
  name: "nixfmt",
  command: ["nixfmt", "$FILE"],
  extensions: [".nix"],
  async enabled() {
    // 检查 nixfmt 命令是否可用
    return Bun.which("nixfmt") !== null
  },
}

/**
 * Rust 格式化器
 *
 * 使用 rustfmt 命令格式化 Rust 文件。
 * 通过查找 rustfmt.toml 或 .rustfmt.toml 配置文件来启用。
 */
export const rustfmt: Info = {
  name: "rustfmt",
  command: ["rustfmt", "$FILE"],
  extensions: [".rs"],
  async enabled() {
    // 首先检查 rustfmt 命令是否可用
    if (!Bun.which("rustfmt")) return false

    // 检查配置文件
    const configs = ["rustfmt.toml", ".rustfmt.toml"]
    for (const config of configs) {
      const found = await Filesystem.findUp(config, Instance.directory, Instance.worktree)
      if (found.length > 0) return true
    }

    return false
  },
}

/**
 * Cargo Rust 格式化器
 *
 * 使用 cargo fmt 命令格式化 Rust 文件。
 * 通过查找 Cargo.toml 文件来启用。
 */
export const cargofmt: Info = {
  name: "cargofmt",
  command: ["cargo", "fmt", "--", "$FILE"],
  extensions: [".rs"],
  async enabled() {
    // 首先检查 cargo 命令是否可用
    if (!Bun.which("cargo")) return false

    // 检查 Cargo.toml 文件
    const found = await Filesystem.findUp("Cargo.toml", Instance.directory, Instance.worktree)
    return found.length > 0
  },
}
