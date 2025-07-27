import { App } from "../app/app"
import { BunProc } from "../bun"
import { Filesystem } from "../util/filesystem"
import path from "path"

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
    const app = App.info()
    const nms = await Filesystem.findUp("node_modules", app.path.cwd, app.path.root)
    for (const item of nms) {
      if (await Bun.file(path.join(item, ".bin", "prettier")).exists()) return true
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
    return Bun.which("clang-format") !== null
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
    const app = App.info()
    const configs = ["pyproject.toml", "ruff.toml", ".ruff.toml"]
    for (const config of configs) {
      const found = await Filesystem.findUp(config, app.path.cwd, app.path.root)
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
      const found = await Filesystem.findUp(dep, app.path.cwd, app.path.root)
      if (found.length > 0) {
        const content = await Bun.file(found[0]).text()
        if (content.includes("ruff")) return true
      }
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
