import { readableStreamToText } from "bun"
import { BunProc } from "../bun"
import { Instance } from "../project/instance"
import { Filesystem } from "../util/filesystem"
import { Flag } from "@/flag/flag"

export interface Info {
  name: string
  command: string[]
  environment?: Record<string, string>
  extensions: string[]
  enabled(): Promise<boolean>
}

export const gofmt: Info = {
  name: "gofmt",
  command: ["gofmt", "-w", "$FILE"],
  extensions: [".go"],
  async enabled() {
    return Bun.which("gofmt") !== null
  },
}

export const mix: Info = {
  name: "mix",
  command: ["mix", "format", "$FILE"],
  extensions: [".ex", ".exs", ".eex", ".heex", ".leex", ".neex", ".sface"],
  async enabled() {
    return Bun.which("mix") !== null
  },
}

export const prettier: Info = {
  name: "prettier",
  command: [BunProc.which(), "x", "prettier", "--write", "$FILE"],
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
    const items = await Filesystem.findUp("package.json", Instance.directory, Instance.worktree)
    for (const item of items) {
      const json = await Bun.file(item).json()
      if (json.dependencies?.prettier) return true
      if (json.devDependencies?.prettier) return true
    }
    return false
  },
}

export const oxfmt: Info = {
  name: "oxfmt",
  command: [BunProc.which(), "x", "oxfmt", "$FILE"],
  environment: {
    BUN_BE_BUN: "1",
  },
  extensions: [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"],
  async enabled() {
    if (!Flag.OPENCODE_EXPERIMENTAL_OXFMT) return false
    const items = await Filesystem.findUp("package.json", Instance.directory, Instance.worktree)
    for (const item of items) {
      const json = await Bun.file(item).json()
      if (json.dependencies?.oxfmt) return true
      if (json.devDependencies?.oxfmt) return true
    }
    return false
  },
}

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

export const zig: Info = {
  name: "zig",
  command: ["zig", "fmt", "$FILE"],
  extensions: [".zig", ".zon"],
  async enabled() {
    return Bun.which("zig") !== null
  },
}

export const clang: Info = {
  name: "clang-format",
  command: ["clang-format", "-i", "$FILE"],
  extensions: [".c", ".cc", ".cpp", ".cxx", ".c++", ".h", ".hh", ".hpp", ".hxx", ".h++", ".ino", ".C", ".H"],
  async enabled() {
    const items = await Filesystem.findUp(".clang-format", Instance.directory, Instance.worktree)
    return items.length > 0
  },
}

export const ktlint: Info = {
  name: "ktlint",
  command: ["ktlint", "-F", "$FILE"],
  extensions: [".kt", ".kts"],
  async enabled() {
    return Bun.which("ktlint") !== null
  },
}

export const ruff: Info = {
  name: "ruff",
  command: ["ruff", "format", "$FILE"],
  extensions: [".py", ".pyi"],
  async enabled() {
    if (!Bun.which("ruff")) return false
    const configs = ["pyproject.toml", "ruff.toml", ".ruff.toml"]
    for (const config of configs) {
      const found = await Filesystem.findUp(config, Instance.directory, Instance.worktree)
      if (found.length > 0) {
        if (config === "pyproject.toml") {
          const content = await Bun.file(found[0]).text()
          if (content.includes("[tool.ruff]")) return true
        } else {
          return true
        }
      }
    }
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

export const rlang: Info = {
  name: "air",
  command: ["air", "format", "$FILE"],
  extensions: [".R"],
  async enabled() {
    const airPath = Bun.which("air")
    if (airPath == null) return false

    try {
      const proc = Bun.spawn(["air", "--help"], {
        stdout: "pipe",
        stderr: "pipe",
      })
      await proc.exited
      const output = await readableStreamToText(proc.stdout)

      // Check for "Air: An R language server and formatter"
      const firstLine = output.split("\n")[0]
      const hasR = firstLine.includes("R language")
      const hasFormatter = firstLine.includes("formatter")
      return hasR && hasFormatter
    } catch (error) {
      return false
    }
  },
}

export const uvformat: Info = {
  name: "uv format",
  command: ["uv", "format", "--", "$FILE"],
  extensions: [".py", ".pyi"],
  async enabled() {
    if (await ruff.enabled()) return false
    if (Bun.which("uv") !== null) {
      const proc = Bun.spawn(["uv", "format", "--help"], { stderr: "pipe", stdout: "pipe" })
      const code = await proc.exited
      return code === 0
    }
    return false
  },
}

export const rubocop: Info = {
  name: "rubocop",
  command: ["rubocop", "--autocorrect", "$FILE"],
  extensions: [".rb", ".rake", ".gemspec", ".ru"],
  async enabled() {
    return Bun.which("rubocop") !== null
  },
}

export const standardrb: Info = {
  name: "standardrb",
  command: ["standardrb", "--fix", "$FILE"],
  extensions: [".rb", ".rake", ".gemspec", ".ru"],
  async enabled() {
    return Bun.which("standardrb") !== null
  },
}

export const htmlbeautifier: Info = {
  name: "htmlbeautifier",
  command: ["htmlbeautifier", "$FILE"],
  extensions: [".erb", ".html.erb"],
  async enabled() {
    return Bun.which("htmlbeautifier") !== null
  },
}

export const dart: Info = {
  name: "dart",
  command: ["dart", "format", "$FILE"],
  extensions: [".dart"],
  async enabled() {
    return Bun.which("dart") !== null
  },
}

export const ocamlformat: Info = {
  name: "ocamlformat",
  command: ["ocamlformat", "-i", "$FILE"],
  extensions: [".ml", ".mli"],
  async enabled() {
    if (!Bun.which("ocamlformat")) return false
    const items = await Filesystem.findUp(".ocamlformat", Instance.directory, Instance.worktree)
    return items.length > 0
  },
}

export const terraform: Info = {
  name: "terraform",
  command: ["terraform", "fmt", "$FILE"],
  extensions: [".tf", ".tfvars"],
  async enabled() {
    return Bun.which("terraform") !== null
  },
}

export const latexindent: Info = {
  name: "latexindent",
  command: ["latexindent", "-w", "-s", "$FILE"],
  extensions: [".tex"],
  async enabled() {
    return Bun.which("latexindent") !== null
  },
}

export const gleam: Info = {
  name: "gleam",
  command: ["gleam", "format", "$FILE"],
  extensions: [".gleam"],
  async enabled() {
    return Bun.which("gleam") !== null
  },
}

export const shfmt: Info = {
  name: "shfmt",
  command: ["shfmt", "-w", "$FILE"],
  extensions: [".sh", ".bash"],
  async enabled() {
    return Bun.which("shfmt") !== null
  },
}

export const nixfmt: Info = {
  name: "nixfmt",
  command: ["nixfmt", "$FILE"],
  extensions: [".nix"],
  async enabled() {
    return Bun.which("nixfmt") !== null
  },
}

export const rustfmt: Info = {
  name: "rustfmt",
  command: ["rustfmt", "$FILE"],
  extensions: [".rs"],
  async enabled() {
    if (!Bun.which("rustfmt")) return false
    const configs = ["rustfmt.toml", ".rustfmt.toml"]
    for (const config of configs) {
      const found = await Filesystem.findUp(config, Instance.directory, Instance.worktree)
      if (found.length > 0) return true
    }
    return false
  },
}

export const cargofmt: Info = {
  name: "cargofmt",
  command: ["cargo", "fmt", "--", "$FILE"],
  extensions: [".rs"],
  async enabled() {
    if (!Bun.which("cargo")) return false
    const found = await Filesystem.findUp("Cargo.toml", Instance.directory, Instance.worktree)
    return found.length > 0
  },
}
