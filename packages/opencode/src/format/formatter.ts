import { text } from "node:stream/consumers"
import { Instance } from "../project/instance"
import { Filesystem } from "../util/filesystem"
import { Process } from "../util/process"
import { which } from "../util/which"
import { Flag } from "@/flag/flag"
import { Npm } from "@/npm"

export interface Info {
  name: string
  environment?: Record<string, string>
  extensions: string[]
  enabled(): Promise<string[] | false>
}

export const gofmt: Info = {
  name: "gofmt",
  extensions: [".go"],
  async enabled() {
    const p = which("gofmt")
    if (p === null) return false
    return [p, "-w", "$FILE"]
  },
}

export const mix: Info = {
  name: "mix",
  extensions: [".ex", ".exs", ".eex", ".heex", ".leex", ".neex", ".sface"],
  async enabled() {
    const p = which("mix")
    if (p === null) return false
    return [p, "format", "$FILE"]
  },
}

export const prettier: Info = {
  name: "prettier",
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
    const items = await Filesystem.findUp("package.json", Instance.directory, Instance.worktree)
    for (const item of items) {
      const json = await Filesystem.readJson<{
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
      }>(item)
      if (json.dependencies?.prettier || json.devDependencies?.prettier) {
        const bin = await Npm.which("prettier").catch(() => null)
        if (!bin) return false
        return [bin, "--write", "$FILE"]
      }
    }
    return false
  },
}

export const oxfmt: Info = {
  name: "oxfmt",
  extensions: [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"],
  async enabled() {
    if (!Flag.OPENCODE_EXPERIMENTAL_OXFMT) return false
    const items = await Filesystem.findUp("package.json", Instance.directory, Instance.worktree)
    for (const item of items) {
      const json = await Filesystem.readJson<{
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
      }>(item)
      if (json.dependencies?.oxfmt || json.devDependencies?.oxfmt) {
        const bin = await Npm.which("oxfmt")
        if (!bin) return false
        return [bin, "$FILE"]
      }
    }
    return false
  },
}

export const biome: Info = {
  name: "biome",
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
    const configs = ["biome.json", "biome.jsonc"]
    for (const config of configs) {
      const found = await Filesystem.findUp(config, Instance.directory, Instance.worktree)
      if (found.length > 0) {
        const bin = await Npm.which("@biomejs/biome")
        if (!bin) return false
        return [bin, "check", "--write", "$FILE"]
      }
    }
    return false
  },
}

export const zig: Info = {
  name: "zig",
  extensions: [".zig", ".zon"],
  async enabled() {
    const p = which("zig")
    if (p === null) return false
    return [p, "fmt", "$FILE"]
  },
}

export const clang: Info = {
  name: "clang-format",
  extensions: [".c", ".cc", ".cpp", ".cxx", ".c++", ".h", ".hh", ".hpp", ".hxx", ".h++", ".ino", ".C", ".H"],
  async enabled() {
    const items = await Filesystem.findUp(".clang-format", Instance.directory, Instance.worktree)
    if (items.length === 0) return false
    return ["clang-format", "-i", "$FILE"]
  },
}

export const ktlint: Info = {
  name: "ktlint",
  extensions: [".kt", ".kts"],
  async enabled() {
    const p = which("ktlint")
    if (p === null) return false
    return [p, "-F", "$FILE"]
  },
}

export const ruff: Info = {
  name: "ruff",
  extensions: [".py", ".pyi"],
  async enabled() {
    const p = which("ruff")
    if (p === null) return false
    const configs = ["pyproject.toml", "ruff.toml", ".ruff.toml"]
    for (const config of configs) {
      const found = await Filesystem.findUp(config, Instance.directory, Instance.worktree)
      if (found.length > 0) {
        if (config === "pyproject.toml") {
          const content = await Filesystem.readText(found[0])
          if (content.includes("[tool.ruff]")) return [p, "format", "$FILE"]
        } else {
          return [p, "format", "$FILE"]
        }
      }
    }
    const deps = ["requirements.txt", "pyproject.toml", "Pipfile"]
    for (const dep of deps) {
      const found = await Filesystem.findUp(dep, Instance.directory, Instance.worktree)
      if (found.length > 0) {
        const content = await Filesystem.readText(found[0])
        if (content.includes("ruff")) return [p, "format", "$FILE"]
      }
    }
    return false
  },
}

export const rlang: Info = {
  name: "air",
  extensions: [".R"],
  async enabled() {
    const airPath = which("air")
    if (airPath == null) return false

    try {
      const proc = Process.spawn([airPath, "--help"], {
        stdout: "pipe",
        stderr: "pipe",
      })
      await proc.exited
      if (!proc.stdout) return false
      const output = await text(proc.stdout)

      // Check for "Air: An R language server and formatter"
      const firstLine = output.split("\n")[0]
      const hasR = firstLine.includes("R language")
      const hasFormatter = firstLine.includes("formatter")
      if (hasR && hasFormatter) {
        return [airPath, "format", "$FILE"]
      }
      return false
    } catch (error) {
      return false
    }
  },
}

export const uvformat: Info = {
  name: "uv",
  extensions: [".py", ".pyi"],
  async enabled() {
    if (await ruff.enabled()) return false
    const uvPath = which("uv")
    if (uvPath !== null) {
      const proc = Process.spawn([uvPath, "format", "--help"], { stderr: "pipe", stdout: "pipe" })
      const code = await proc.exited
      if (code === 0) return [uvPath, "format", "--", "$FILE"]
    }
    return false
  },
}

export const rubocop: Info = {
  name: "rubocop",
  extensions: [".rb", ".rake", ".gemspec", ".ru"],
  async enabled() {
    const path = which("rubocop")
    if (path === null) return false
    return [path, "--autocorrect", "$FILE"]
  },
}

export const standardrb: Info = {
  name: "standardrb",
  extensions: [".rb", ".rake", ".gemspec", ".ru"],
  async enabled() {
    const path = which("standardrb")
    if (path === null) return false
    return [path, "--fix", "$FILE"]
  },
}

export const htmlbeautifier: Info = {
  name: "htmlbeautifier",
  extensions: [".erb", ".html.erb"],
  async enabled() {
    const path = which("htmlbeautifier")
    if (path === null) return false
    return [path, "$FILE"]
  },
}

export const dart: Info = {
  name: "dart",
  extensions: [".dart"],
  async enabled() {
    const path = which("dart")
    if (path === null) return false
    return [path, "format", "$FILE"]
  },
}

export const ocamlformat: Info = {
  name: "ocamlformat",
  extensions: [".ml", ".mli"],
  async enabled() {
    const path = which("ocamlformat")
    if (!path) return false
    const items = await Filesystem.findUp(".ocamlformat", Instance.directory, Instance.worktree)
    if (items.length === 0) return false
    return [path, "-i", "$FILE"]
  },
}

export const terraform: Info = {
  name: "terraform",
  extensions: [".tf", ".tfvars"],
  async enabled() {
    const path = which("terraform")
    if (path === null) return false
    return [path, "fmt", "$FILE"]
  },
}

export const latexindent: Info = {
  name: "latexindent",
  extensions: [".tex"],
  async enabled() {
    const path = which("latexindent")
    if (path === null) return false
    return [path, "-w", "-s", "$FILE"]
  },
}

export const gleam: Info = {
  name: "gleam",
  extensions: [".gleam"],
  async enabled() {
    const path = which("gleam")
    if (path === null) return false
    return [path, "format", "$FILE"]
  },
}

export const shfmt: Info = {
  name: "shfmt",
  extensions: [".sh", ".bash"],
  async enabled() {
    const path = which("shfmt")
    if (path === null) return false
    return [path, "-w", "$FILE"]
  },
}

export const nixfmt: Info = {
  name: "nixfmt",
  extensions: [".nix"],
  async enabled() {
    const path = which("nixfmt")
    if (path === null) return false
    return [path, "$FILE"]
  },
}

export const rustfmt: Info = {
  name: "rustfmt",
  extensions: [".rs"],
  async enabled() {
    const path = which("rustfmt")
    if (path === null) return false
    return [path, "$FILE"]
  },
}

export const pint: Info = {
  name: "pint",
  extensions: [".php"],
  async enabled() {
    const items = await Filesystem.findUp("composer.json", Instance.directory, Instance.worktree)
    for (const item of items) {
      const json = await Filesystem.readJson<{
        require?: Record<string, string>
        "require-dev"?: Record<string, string>
      }>(item)
      if (json.require?.["laravel/pint"] || json["require-dev"]?.["laravel/pint"]) {
        return ["./vendor/bin/pint", "$FILE"]
      }
    }
    return false
  },
}

export const ormolu: Info = {
  name: "ormolu",
  extensions: [".hs"],
  async enabled() {
    const path = which("ormolu")
    if (path === null) return false
    return [path, "-i", "$FILE"]
  },
}

export const cljfmt: Info = {
  name: "cljfmt",
  extensions: [".clj", ".cljs", ".cljc", ".edn"],
  async enabled() {
    const path = which("cljfmt")
    if (path === null) return false
    return [path, "fix", "--quiet", "$FILE"]
  },
}

export const dfmt: Info = {
  name: "dfmt",
  extensions: [".d"],
  async enabled() {
    const path = which("dfmt")
    if (path === null) return false
    return [path, "-i", "$FILE"]
  },
}
