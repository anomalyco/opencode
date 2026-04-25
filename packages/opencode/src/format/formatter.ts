import { Npm } from "../npm"
import type { InstanceContext } from "../project/instance"
import { Filesystem } from "../util"
import { Process } from "../util"
import { which } from "../util/which"
import { Flag } from "@opencode-ai/core/flag/flag"

export interface Context extends Pick<InstanceContext, "directory" | "worktree"> {}

export interface Info {
  name: string
  environment?: Record<string, string>
  extensions: string[]
  enabled(context: Context): Promise<string[] | false>
}

export const gofmt: Info = {
  name: "gofmt",
  extensions: [".go"],
  async enabled() {
    const match = which("gofmt")
    if (!match) return false
    return [match, "-w", "$FILE"]
  },
}

export const mix: Info = {
  name: "mix",
  extensions: [".ex", ".exs", ".eex", ".heex", ".leex", ".neex", ".sface"],
  async enabled() {
    const match = which("mix")
    if (!match) return false
    return [match, "format", "$FILE"]
  },
}

export const prettier: Info = {
  name: "prettier",
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
  async enabled(context) {
    const items = await Filesystem.findUp("package.json", context.directory, context.worktree)
    for (const item of items) {
      const json = await Filesystem.readJson<{
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
      }>(item)
      if (json.dependencies?.prettier || json.devDependencies?.prettier) {
        const bin = await Npm.which("prettier")
        if (bin) return [bin, "--write", "$FILE"]
      }
    }
    return false
  },
}

export const oxfmt: Info = {
  name: "oxfmt",
  environment: {
    BUN_BE_BUN: "1",
  },
  extensions: [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"],
  async enabled(context) {
    if (!Flag.OPENCODE_EXPERIMENTAL_OXFMT) return false
    const items = await Filesystem.findUp("package.json", context.directory, context.worktree)
    for (const item of items) {
      const json = await Filesystem.readJson<{
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
      }>(item)
      if (json.dependencies?.oxfmt || json.devDependencies?.oxfmt) {
        const bin = await Npm.which("oxfmt")
        if (bin) return [bin, "$FILE"]
      }
    }
    return false
  },
}

export const biome: Info = {
  name: "biome",
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
  async enabled(context) {
    const configs = ["biome.json", "biome.jsonc"]
    for (const config of configs) {
      const found = await Filesystem.findUp(config, context.directory, context.worktree)
      if (found.length > 0) {
        const bin = await Npm.which("@biomejs/biome")
        if (bin) return [bin, "format", "--write", "$FILE"]
      }
    }
    return false
  },
}

export const zig: Info = {
  name: "zig",
  extensions: [".zig", ".zon"],
  async enabled() {
    const match = which("zig")
    if (!match) return false
    return [match, "fmt", "$FILE"]
  },
}

export const clang: Info = {
  name: "clang-format",
  extensions: [".c", ".cc", ".cpp", ".cxx", ".c++", ".h", ".hh", ".hpp", ".hxx", ".h++", ".ino", ".C", ".H"],
  async enabled(context) {
    const items = await Filesystem.findUp(".clang-format", context.directory, context.worktree)
    if (items.length > 0) {
      const match = which("clang-format")
      if (match) return [match, "-i", "$FILE"]
    }
    return false
  },
}

export const ktlint: Info = {
  name: "ktlint",
  extensions: [".kt", ".kts"],
  async enabled() {
    const match = which("ktlint")
    if (!match) return false
    return [match, "-F", "$FILE"]
  },
}

export const ruff: Info = {
  name: "ruff",
  extensions: [".py", ".pyi"],
  async enabled(context) {
    if (!which("ruff")) return false
    const configs = ["pyproject.toml", "ruff.toml", ".ruff.toml"]
    for (const config of configs) {
      const found = await Filesystem.findUp(config, context.directory, context.worktree)
      if (found.length > 0) {
        if (config === "pyproject.toml") {
          const content = await Filesystem.readText(found[0])
          if (content.includes("[tool.ruff]")) return ["ruff", "format", "$FILE"]
        } else {
          return ["ruff", "format", "$FILE"]
        }
      }
    }
    const deps = ["requirements.txt", "pyproject.toml", "Pipfile"]
    for (const dep of deps) {
      const found = await Filesystem.findUp(dep, context.directory, context.worktree)
      if (found.length > 0) {
        const content = await Filesystem.readText(found[0])
        if (content.includes("ruff")) return ["ruff", "format", "$FILE"]
      }
    }
    return false
  },
}

export const rlang: Info = {
  name: "air",
  extensions: [".R"],
  async enabled() {
    const air = which("air")
    if (air == null) return false

    const output = await Process.text([air, "--help"], { nothrow: true })

    // Check for "Air: An R language server and formatter"
    const firstLine = output.text.split("\n")[0]
    const hasR = firstLine.includes("R language")
    const hasFormatter = firstLine.includes("formatter")
    if (output.code === 0 && hasR && hasFormatter) return [air, "format", "$FILE"]
    return false
  },
}

export const uvformat: Info = {
  name: "uv",
  extensions: [".py", ".pyi"],
  async enabled(context) {
    if (await ruff.enabled(context)) return false
    const uv = which("uv")
    if (uv == null) return false
    const output = await Process.run([uv, "format", "--help"], { nothrow: true })
    if (output.code === 0) return [uv, "format", "--", "$FILE"]
    return false
  },
}

export const rubocop: Info = {
  name: "rubocop",
  extensions: [".rb", ".rake", ".gemspec", ".ru"],
  async enabled() {
    const match = which("rubocop")
    if (!match) return false
    return [match, "--autocorrect", "$FILE"]
  },
}

export const standardrb: Info = {
  name: "standardrb",
  extensions: [".rb", ".rake", ".gemspec", ".ru"],
  async enabled() {
    const match = which("standardrb")
    if (!match) return false
    return [match, "--fix", "$FILE"]
  },
}

export const htmlbeautifier: Info = {
  name: "htmlbeautifier",
  extensions: [".erb", ".html.erb"],
  async enabled() {
    const match = which("htmlbeautifier")
    if (!match) return false
    return [match, "$FILE"]
  },
}

export const dart: Info = {
  name: "dart",
  extensions: [".dart"],
  async enabled() {
    const match = which("dart")
    if (!match) return false
    return [match, "format", "$FILE"]
  },
}

export const ocamlformat: Info = {
  name: "ocamlformat",
  extensions: [".ml", ".mli"],
  async enabled(context) {
    if (!which("ocamlformat")) return false
    const items = await Filesystem.findUp(".ocamlformat", context.directory, context.worktree)
    if (items.length > 0) return ["ocamlformat", "-i", "$FILE"]
    return false
  },
}

export const terraform: Info = {
  name: "terraform",
  extensions: [".tf", ".tfvars"],
  async enabled() {
    const match = which("terraform")
    if (!match) return false
    return [match, "fmt", "$FILE"]
  },
}

export const latexindent: Info = {
  name: "latexindent",
  extensions: [".tex"],
  async enabled() {
    const match = which("latexindent")
    if (!match) return false
    return [match, "-w", "-s", "$FILE"]
  },
}

export const gleam: Info = {
  name: "gleam",
  extensions: [".gleam"],
  async enabled() {
    const match = which("gleam")
    if (!match) return false
    return [match, "format", "$FILE"]
  },
}

export const shfmt: Info = {
  name: "shfmt",
  extensions: [".sh", ".bash"],
  async enabled() {
    const match = which("shfmt")
    if (!match) return false
    return [match, "-w", "$FILE"]
  },
}

export const nixfmt: Info = {
  name: "nixfmt",
  extensions: [".nix"],
  async enabled() {
    const match = which("nixfmt")
    if (!match) return false
    return [match, "$FILE"]
  },
}

export const rustfmt: Info = {
  name: "rustfmt",
  extensions: [".rs"],
  async enabled() {
    const match = which("rustfmt")
    if (!match) return false
    return [match, "$FILE"]
  },
}

export const pint: Info = {
  name: "pint",
  extensions: [".php"],
  async enabled(context) {
    const items = await Filesystem.findUp("composer.json", context.directory, context.worktree)
    for (const item of items) {
      const json = await Filesystem.readJson<{
        require?: Record<string, string>
        "require-dev"?: Record<string, string>
      }>(item)
      if (json.require?.["laravel/pint"] || json["require-dev"]?.["laravel/pint"]) return ["./vendor/bin/pint", "$FILE"]
    }
    return false
  },
}

export const ormolu: Info = {
  name: "ormolu",
  extensions: [".hs"],
  async enabled() {
    const match = which("ormolu")
    if (!match) return false
    return [match, "-i", "$FILE"]
  },
}

export const cljfmt: Info = {
  name: "cljfmt",
  extensions: [".clj", ".cljs", ".cljc", ".edn"],
  async enabled() {
    const match = which("cljfmt")
    if (!match) return false
    return [match, "fix", "--quiet", "$FILE"]
  },
}

export const dfmt: Info = {
  name: "dfmt",
  extensions: [".d"],
  async enabled() {
    const match = which("dfmt")
    if (!match) return false
    return [match, "-i", "$FILE"]
  },
}
