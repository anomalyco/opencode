import type { ChildProcessWithoutNullStreams } from "child_process"
import path from "path"
import os from "os"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"
import { text } from "node:stream/consumers"
import fs from "fs/promises"
import { Filesystem } from "@/util/filesystem"
import type { InstanceContext } from "../project/instance"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Archive } from "@/util/archive"
import { Process } from "@/util/process"
import { which } from "../util/which"
import { Module } from "@opencode-ai/core/util/module"
import { spawn } from "./launch"
import { Npm } from "@opencode-ai/core/npm"

const log = Log.create({ service: "lsp.server" })
const pathExists = async (p: string) =>
  fs
    .stat(p)
    .then(() => true)
    .catch(() => false)
const run = (cmd: string[], opts: Process.RunOptions = {}) => Process.run(cmd, { ...opts, nothrow: true })
const output = (cmd: string[], opts: Process.RunOptions = {}) => Process.text(cmd, { ...opts, nothrow: true })

export interface Handle {
  process: ChildProcessWithoutNullStreams
  initialization?: Record<string, any>
}

type RootFunction = (file: string, ctx: InstanceContext) => Promise<string | undefined>

const NearestRoot = (includePatterns: string[], excludePatterns?: string[]): RootFunction => {
  return async (file, ctx) => {
    if (excludePatterns) {
      const excludedFiles = Filesystem.up({
        targets: excludePatterns,
        start: path.dirname(file),
        stop: ctx.directory,
      })
      const excluded = await excludedFiles.next()
      await excludedFiles.return()
      if (excluded.value) return undefined
    }
    const files = Filesystem.up({
      targets: includePatterns,
      start: path.dirname(file),
      stop: ctx.directory,
    })
    const first = await files.next()
    await files.return()
    if (!first.value) return ctx.directory
    return path.dirname(first.value)
  }
}

export interface Info {
  id: string
  extensions: string[]
  global?: boolean
  root: RootFunction
  spawn(root: string, ctx: InstanceContext): Promise<Handle | undefined>
}

export const Deno: Info = {
  id: "deno",
  root: async (file, ctx) => {
    const files = Filesystem.up({
      targets: ["deno.json", "deno.jsonc"],
      start: path.dirname(file),
      stop: ctx.directory,
    })
    const first = await files.next()
    await files.return()
    if (!first.value) return undefined
    return path.dirname(first.value)
  },
  extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs"],
  async spawn(root) {
    const deno = which("deno")
    if (!deno) {
      log.info("deno not found, please install deno first")
      return
    }
    return {
      process: spawn(deno, ["lsp"], {
        cwd: root,
      }),
    }
  },
}

export const Typescript: Info = {
  id: "typescript",
  root: NearestRoot(
    ["package-lock.json", "bun.lockb", "bun.lock", "pnpm-lock.yaml", "yarn.lock"],
    ["deno.json", "deno.jsonc"],
  ),
  extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"],
  async spawn(root, ctx) {
    const tsserver = Module.resolve("typescript/lib/tsserver.js", ctx.directory)
    log.info("typescript server", { tsserver })
    if (!tsserver) return
    const bin = await Npm.which("typescript-language-server")
    if (!bin) return
    const proc = spawn(bin, ["--stdio"], {
      cwd: root,
      env: {
        ...process.env,
      },
    })
    return {
      process: proc,
      initialization: {
        tsserver: {
          path: tsserver,
        },
      },
    }
  },
}

export const Vue: Info = {
  id: "vue",
  extensions: [".vue"],
  root: NearestRoot(["package-lock.json", "bun.lockb", "bun.lock", "pnpm-lock.yaml", "yarn.lock"]),
  async spawn(root) {
    let binary = which("vue-language-server")
    const args: string[] = []
    if (!binary) {
      if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
      const resolved = await Npm.which("@vue/language-server")
      if (!resolved) return
      binary = resolved
    }
    args.push("--stdio")
    const proc = spawn(binary, args, {
      cwd: root,
      env: {
        ...process.env,
      },
    })
    return {
      process: proc,
      initialization: {
        // Leave empty; the server will auto-detect workspace TypeScript.
      },
    }
  },
}

export const ESLint: Info = {
  id: "eslint",
  root: NearestRoot(["package-lock.json", "bun.lockb", "bun.lock", "pnpm-lock.yaml", "yarn.lock"]),
  extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".vue"],
  async spawn(root, ctx) {
    const eslint = Module.resolve("eslint", ctx.directory)
    if (!eslint) return
    log.info("spawning eslint server")
    const serverPath = path.join(Global.Path.bin, "vscode-eslint", "server", "out", "eslintServer.js")
    if (!(await Filesystem.exists(serverPath))) {
      if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
      log.info("downloading and building VS Code ESLint server")
      const response = await fetch("https://github.com/microsoft/vscode-eslint/archive/refs/heads/main.zip")
      if (!response.ok) return

      const zipPath = path.join(Global.Path.bin, "vscode-eslint.zip")
      if (response.body) await Filesystem.writeStream(zipPath, response.body)

      const ok = await Archive.extractZip(zipPath, Global.Path.bin)
        .then(() => true)
        .catch((error) => {
          log.error("Failed to extract vscode-eslint archive", { error })
          return false
        })
      if (!ok) return
      await fs.rm(zipPath, { force: true })

      const extractedPath = path.join(Global.Path.bin, "vscode-eslint-main")
      const finalPath = path.join(Global.Path.bin, "vscode-eslint")

      const stats = await fs.stat(finalPath).catch(() => undefined)
      if (stats) {
        log.info("removing old eslint installation", { path: finalPath })
        await fs.rm(finalPath, { force: true, recursive: true })
      }
      await fs.rename(extractedPath, finalPath)

      const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm"
      await Process.run([npmCmd, "install"], { cwd: finalPath })
      await Process.run([npmCmd, "run", "compile"], { cwd: finalPath })

      log.info("installed VS Code ESLint server", { serverPath })
    }

    const proc = spawn("node", [serverPath, "--stdio"], {
      cwd: root,
      env: {
        ...process.env,
      },
    })

    return {
      process: proc,
    }
  },
}

export const Oxlint: Info = {
  id: "oxlint",
  root: NearestRoot([
    ".oxlintrc.json",
    "package-lock.json",
    "bun.lockb",
    "bun.lock",
    "pnpm-lock.yaml",
    "yarn.lock",
    "package.json",
  ]),
  extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".vue", ".astro", ".svelte"],
  async spawn(root, ctx) {
    const ext = process.platform === "win32" ? ".cmd" : ""

    const serverTarget = path.join("node_modules", ".bin", "oxc_language_server" + ext)
    const lintTarget = path.join("node_modules", ".bin", "oxlint" + ext)

    const resolveBin = async (target: string) => {
      const localBin = path.join(root, target)
      if (await Filesystem.exists(localBin)) return localBin

      const candidates = Filesystem.up({
        targets: [target],
        start: root,
        stop: ctx.worktree,
      })
      const first = await candidates.next()
      await candidates.return()
      if (first.value) return first.value

      return undefined
    }

    let lintBin = await resolveBin(lintTarget)
    if (!lintBin) {
      const found = which("oxlint")
      if (found) lintBin = found
    }

    if (lintBin) {
      const proc = spawn(lintBin, ["--help"])
      await proc.exited
      if (proc.stdout) {
        const help = await text(proc.stdout)
        if (help.includes("--lsp")) {
          return {
            process: spawn(lintBin, ["--lsp"], {
              cwd: root,
            }),
          }
        }
      }
    }

    let serverBin = await resolveBin(serverTarget)
    if (!serverBin) {
      const found = which("oxc_language_server")
      if (found) serverBin = found
    }
    if (serverBin) {
      return {
        process: spawn(serverBin, [], {
          cwd: root,
        }),
      }
    }

    log.info("oxlint not found, please install oxlint")
    return
  },
}

export const Biome: Info = {
  id: "biome",
  root: NearestRoot([
    "biome.json",
    "biome.jsonc",
    "package-lock.json",
    "bun.lockb",
    "bun.lock",
    "pnpm-lock.yaml",
    "yarn.lock",
  ]),
  extensions: [
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".mts",
    ".cts",
    ".json",
    ".jsonc",
    ".vue",
    ".astro",
    ".svelte",
    ".css",
    ".graphql",
    ".gql",
    ".html",
  ],
  async spawn(root) {
    const localBin = path.join(root, "node_modules", ".bin", "biome")
    let bin: string | undefined
    if (await Filesystem.exists(localBin)) bin = localBin
    if (!bin) {
      const found = which("biome")
      if (found) bin = found
    }

    let args = ["lsp-proxy", "--stdio"]

    if (!bin) {
      const resolved = Module.resolve("biome", root)
      if (!resolved) return
      bin = await Npm.which("biome")
      if (!bin) return
      args = ["lsp-proxy", "--stdio"]
    }

    const proc = spawn(bin, args, {
      cwd: root,
      env: {
        ...process.env,
      },
    })

    return {
      process: proc,
    }
  },
}

export const Gopls: Info = {
  id: "gopls",
  root: async (file, ctx) => {
    const work = await NearestRoot(["go.work"])(file, ctx)
    if (work) return work
    return NearestRoot(["go.mod", "go.sum"])(file, ctx)
  },
  extensions: [".go"],
  async spawn(root) {
    let bin = which("gopls")
    if (!bin) {
      if (!which("go")) return
      if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return

      log.info("installing gopls")
      const proc = Process.spawn(["go", "install", "golang.org/x/tools/gopls@latest"], {
        env: { ...process.env, GOBIN: Global.Path.bin },
        stdout: "pipe",
        stderr: "pipe",
        stdin: "pipe",
      })
      const exit = await proc.exited
      if (exit !== 0) {
        log.error("Failed to install gopls")
        return
      }
      bin = path.join(Global.Path.bin, "gopls" + (process.platform === "win32" ? ".exe" : ""))
      log.info(`installed gopls`, {
        bin,
      })
    }
    return {
      process: spawn(bin!, {
        cwd: root,
      }),
    }
  },
}

export const Rubocop: Info = {
  id: "ruby-lsp",
  root: NearestRoot(["Gemfile"]),
  extensions: [".rb", ".rake", ".gemspec", ".ru"],
  async spawn(root) {
    let bin = which("rubocop")
    if (!bin) {
      const ruby = which("ruby")
      const gem = which("gem")
      if (!ruby || !gem) {
        log.info("Ruby not found, please install Ruby first")
        return
      }
      if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
      log.info("installing rubocop")
      const proc = Process.spawn(["gem", "install", "rubocop", "--bindir", Global.Path.bin], {
        stdout: "pipe",
        stderr: "pipe",
        stdin: "pipe",
      })
      const exit = await proc.exited
      if (exit !== 0) {
        log.error("Failed to install rubocop")
        return
      }
      bin = path.join(Global.Path.bin, "rubocop" + (process.platform === "win32" ? ".exe" : ""))
      log.info(`installed rubocop`, {
        bin,
      })
    }
    return {
      process: spawn(bin!, ["--lsp"], {
        cwd: root,
      }),
    }
  },
}

export const Ty: Info = {
  id: "ty",
  extensions: [".py", ".pyi"],
  root: NearestRoot([
    "pyproject.toml",
    "ty.toml",
    "setup.py",
    "setup.cfg",
    "requirements.txt",
    "Pipfile",
    "pyrightconfig.json",
  ]),
  async spawn(root) {
    if (!Flag.OPENCODE_EXPERIMENTAL_LSP_TY) {
      return undefined
    }

    let binary = which("ty")

    const initialization: Record<string, string> = {}

    const potentialVenvPaths = [process.env["VIRTUAL_ENV"], path.join(root, ".venv"), path.join(root, "venv")].filter(
      (p): p is string => p !== undefined,
    )
    for (const venvPath of potentialVenvPaths) {
      const isWindows = process.platform === "win32"
      const potentialPythonPath = isWindows
        ? path.join(venvPath, "Scripts", "python.exe")
        : path.join(venvPath, "bin", "python")
      if (await Filesystem.exists(potentialPythonPath)) {
        initialization["pythonPath"] = potentialPythonPath
        break
      }
    }

    if (!binary) {
      for (const venvPath of potentialVenvPaths) {
        const isWindows = process.platform === "win32"
        const potentialTyPath = isWindows ? path.join(venvPath, "Scripts", "ty.exe") : path.join(venvPath, "bin", "ty")
        if (await Filesystem.exists(potentialTyPath)) {
          binary = potentialTyPath
          break
        }
      }
    }

    if (!binary) {
      log.error("ty not found, please install ty first")
      return
    }

    const proc = spawn(binary, ["server"], {
      cwd: root,
    })

    return {
      process: proc,
      initialization,
    }
  },
}

export const Pyright: Info = {
  id: "pyright",
  extensions: [".py", ".pyi"],
  root: NearestRoot(["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "Pipfile", "pyrightconfig.json"]),
  async spawn(root) {
    let binary = which("pyright-langserver")
    const args = []
    if (!binary) {
      if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
      const resolved = await Npm.which("pyright", "pyright-langserver")
      if (!resolved) return
      binary = resolved
    }
    args.push("--stdio")

    const initialization: Record<string, string> = {}

    const potentialVenvPaths = [process.env["VIRTUAL_ENV"], path.join(root, ".venv"), path.join(root, "venv")].filter(
      (p): p is string => p !== undefined,
    )
    for (const venvPath of potentialVenvPaths) {
      const isWindows = process.platform === "win32"
      const potentialPythonPath = isWindows
        ? path.join(venvPath, "Scripts", "python.exe")
        : path.join(venvPath, "bin", "python")
      if (await Filesystem.exists(potentialPythonPath)) {
        initialization["pythonPath"] = potentialPythonPath
        break
      }
    }

    const proc = spawn(binary, args, {
      cwd: root,
      env: {
        ...process.env,
      },
    })
    return {
      process: proc,
      initialization,
    }
  },
}

export const ElixirLS: Info = {
  id: "elixir-ls",
  extensions: [".ex", ".exs"],
  root: NearestRoot(["mix.exs", "mix.lock"]),
  async spawn(root) {
    let binary = which("elixir-ls")
    if (!binary) {
      const elixirLsPath = path.join(Global.Path.bin, "elixir-ls")
      binary = path.join(
        Global.Path.bin,
        "elixir-ls-master",
        "release",
        process.platform === "win32" ? "language_server.bat" : "language_server.sh",
      )

      if (!(await Filesystem.exists(binary))) {
        const elixir = which("elixir")
        if (!elixir) {
          log.error("elixir is required to run elixir-ls")
          return
        }

        if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
        log.info("downloading elixir-ls from GitHub releases")

        const response = await fetch("https://github.com/elixir-lsp/elixir-ls/archive/refs/heads/master.zip")
        if (!response.ok) return
        const zipPath = path.join(Global.Path.bin, "elixir-ls.zip")
        if (response.body) await Filesystem.writeStream(zipPath, response.body)

        const ok = await Archive.extractZip(zipPath, Global.Path.bin)
          .then(() => true)
          .catch((error) => {
            log.error("Failed to extract elixir-ls archive", { error })
            return false
          })
        if (!ok) return

        await fs.rm(zipPath, {
          force: true,
          recursive: true,
        })

        const cwd = path.join(Global.Path.bin, "elixir-ls-master")
        const env = { MIX_ENV: "prod", ...process.env }
        await Process.run(["mix", "deps.get"], { cwd, env })
        await Process.run(["mix", "compile"], { cwd, env })
        await Process.run(["mix", "elixir_ls.release2", "-o", "release"], { cwd, env })

        log.info(`installed elixir-ls`, {
          path: elixirLsPath,
        })
      }
    }

    return {
      process: spawn(binary, {
        cwd: root,
      }),
    }
  },
}

export const Zls: Info = {
  id: "zls",
  extensions: [".zig", ".zon"],
  root: NearestRoot(["build.zig"]),
  async spawn(root) {
    let bin = which("zls")

    if (!bin) {
      const zig = which("zig")
      if (!zig) {
        log.error("Zig is required to use zls. Please install Zig first.")
        return
      }

      if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
      log.info("downloading zls from GitHub releases")

      const releaseResponse = await fetch("https://api.github.com/repos/zigtools/zls/releases/latest")
      if (!releaseResponse.ok) {
        log.error("Failed to fetch zls release info")
        return
      }

      const release = (await releaseResponse.json()) as {
        assets?: { name?: string; browser_download_url?: string }[]
      }

      const platform = process.platform
      const arch = process.arch
      let assetName = ""

      let zlsArch: string = arch
      if (arch === "arm64") zlsArch = "aarch64"
      else if (arch === "x64") zlsArch = "x86_64"
      else if (arch === "ia32") zlsArch = "x86"

      let zlsPlatform: string = platform
      if (platform === "darwin") zlsPlatform = "macos"
      else if (platform === "win32") zlsPlatform = "windows"

      const ext = platform === "win32" ? "zip" : "tar.xz"

      assetName = `zls-${zlsArch}-${zlsPlatform}.${ext}`

      const supportedCombos = [
        "zls-x86_64-linux.tar.xz",
        "zls-x86_64-macos.tar.xz",
        "zls-x86_64-windows.zip",
        "zls-aarch64-linux.tar.xz",
        "zls-aarch64-macos.tar.xz",
        "zls-aarch64-windows.zip",
        "zls-x86-linux.tar.xz",
        "zls-x86-windows.zip",
      ]

      if (!supportedCombos.includes(assetName)) {
        log.error(`Platform ${platform} and architecture ${arch} is not supported by zls`)
        return
      }

      const asset = release.assets?.find((a) => a.name === assetName)
      if (!asset?.browser_download_url) {
        log.error(`Could not find asset ${assetName} in latest zls release`)
        return
      }

      const downloadUrl = asset.browser_download_url
      const downloadResponse = await fetch(downloadUrl)
      if (!downloadResponse.ok) {
        log.error("Failed to download zls")
        return
      }

      const tempPath = path.join(Global.Path.bin, assetName)
      if (downloadResponse.body) await Filesystem.writeStream(tempPath, downloadResponse.body)

      if (ext === "zip") {
        const ok = await Archive.extractZip(tempPath, Global.Path.bin)
          .then(() => true)
          .catch((error) => {
            log.error("Failed to extract zls archive", { error })
            return false
          })
        if (!ok) return
      } else {
        await run(["tar", "-xf", tempPath], { cwd: Global.Path.bin })
      }

      await fs.rm(tempPath, { force: true })

      bin = path.join(Global.Path.bin, "zls" + (platform === "win32" ? ".exe" : ""))

      if (!(await Filesystem.exists(bin))) {
        log.error("Failed to extract zls binary")
        return
      }

      if (platform !== "win32") {
        await fs.chmod(bin, 0o755).catch(() => {})
      }

      log.info(`installed zls`, { bin })
    }

    return {
      process: spawn(bin, {
        cwd: root,
      }),
    }
  },
}

export const CSharp: Info = {
  id: "csharp",
  root: NearestRoot([".slnx", ".sln", ".csproj", "global.json"]),
  extensions: [".cs", ".csx"],
  async spawn(root) {
    const bin = await getRoslynLanguageServer()
    if (!bin) return

    return {
      process: spawn(bin, ["--stdio", "--autoLoadProjects"], {
        cwd: root,
      }),
    }
  },
}

export const Razor: Info = {
  id: "razor",
  root: NearestRoot([".slnx", ".sln", ".csproj", "global.json"]),
  extensions: [".razor", ".cshtml"],
  async spawn(root) {
    const bin = await getRoslynLanguageServer()
    if (!bin) return

    const razor = await findVscodeRazorExtension()
    if (!razor) {
      log.info("VS Code C# extension with Razor support not found, skipping Razor LSP")
      return
    }

    log.info("using VS Code Razor extension for roslyn-language-server", { extension: razor.extension })
    return {
      process: spawn(
        bin,
        [
          "--stdio",
          "--autoLoadProjects",
          `--razorSourceGenerator=${razor.compiler}`,
          `--razorDesignTimePath=${razor.targets}`,
          "--extension",
          razor.extension,
        ],
        {
          cwd: root,
        },
      ),
    }
  },
}

let roslynLanguageServerInstall: Promise<string | undefined> | undefined

async function getRoslynLanguageServer() {
  const existing = which("roslyn-language-server")
  if (existing) return existing

  const global = await roslynLanguageServerGlobalPath()
  if (global) return global

  roslynLanguageServerInstall ||= installRoslynLanguageServer().finally(() => {
    roslynLanguageServerInstall = undefined
  })
  return roslynLanguageServerInstall
}

async function installRoslynLanguageServer() {
  if (!which("dotnet")) {
    log.error(".NET SDK is required to install roslyn-language-server")
    return
  }

  if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
  log.info("installing roslyn-language-server via dotnet tool")
  const proc = Process.spawn(["dotnet", "tool", "install", "--global", "roslyn-language-server", "--prerelease"], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
  })
  const exit = await proc.exited
  if (exit !== 0) {
    log.error("Failed to install roslyn-language-server")
    return
  }

  const resolved = which("roslyn-language-server")
  if (resolved) {
    log.info(`installed roslyn-language-server`, { bin: resolved })
    return resolved
  }

  const global = await roslynLanguageServerGlobalPath()
  if (global) {
    log.info(`installed roslyn-language-server`, { bin: global })
    return global
  }

  log.error("Installed roslyn-language-server but could not resolve executable")
}

async function roslynLanguageServerGlobalPath() {
  const bin = path.join(
    process.env.DOTNET_CLI_HOME ?? os.homedir(),
    ".dotnet",
    "tools",
    "roslyn-language-server" + (process.platform === "win32" ? ".cmd" : ""),
  )
  return (await pathExists(bin)) ? bin : undefined
}

async function findVscodeRazorExtension() {
  const roots = [
    process.env.VSCODE_EXTENSIONS,
    path.join(os.homedir(), ".vscode", "extensions"),
    path.join(os.homedir(), ".vscode-insiders", "extensions"),
    path.join(os.homedir(), ".vscode-server", "extensions"),
    path.join(os.homedir(), ".vscode-server-insiders", "extensions"),
  ].filter((item) => item !== undefined)

  for (const root of [...new Set(roots)]) {
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
    const candidates = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && entry.name.startsWith("ms-dotnettools.csharp-"))
        .map(async (entry) => ({
          path: path.join(root, entry.name, ".razorExtension"),
          modified: (await fs.stat(path.join(root, entry.name)).catch(() => undefined))?.mtimeMs ?? 0,
        })),
    )
    for (const entry of candidates.sort((a, b) => b.modified - a.modified).map((candidate) => candidate.path)) {
      const result = {
        compiler: path.join(entry, "Microsoft.CodeAnalysis.Razor.Compiler.dll"),
        targets: path.join(entry, "Targets", "Microsoft.NET.Sdk.Razor.DesignTime.targets"),
        extension: path.join(entry, "Microsoft.VisualStudioCode.RazorExtension.dll"),
      }
      if (
        (await pathExists(result.compiler)) &&
        (await pathExists(result.targets)) &&
        (await pathExists(result.extension))
      ) {
        return result
      }
    }
  }
}

export const FSharp: Info = {
  id: "fsharp",
  root: NearestRoot([".slnx", ".sln", ".fsproj", "global.json"]),
  extensions: [".fs", ".fsi", ".fsx", ".fsscript"],
  async spawn(root) {
    let bin = which("fsautocomplete")
    if (!bin) {
      if (!which("dotnet")) {
        log.error(".NET SDK is required to install fsautocomplete")
        return
      }

      if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
      log.info("installing fsautocomplete via dotnet tool")
      const proc = Process.spawn(["dotnet", "tool", "install", "fsautocomplete", "--tool-path", Global.Path.bin], {
        stdout: "pipe",
        stderr: "pipe",
        stdin: "pipe",
      })
      const exit = await proc.exited
      if (exit !== 0) {
        log.error("Failed to install fsautocomplete")
        return
      }

      bin = path.join(Global.Path.bin, "fsautocomplete" + (process.platform === "win32" ? ".exe" : ""))
      log.info(`installed fsautocomplete`, { bin })
    }

    return {
      process: spawn(bin, {
        cwd: root,
      }),
    }
  },
}

export const SourceKit: Info = {
  id: "sourcekit-lsp",
  extensions: [".swift", ".objc", "objcpp"],
  root: NearestRoot(["Package.swift", "*.xcodeproj", "*.xcworkspace"]),
  async spawn(root) {
    // Check if sourcekit-lsp is available in the PATH
    // This is installed with the Swift toolchain
    const sourcekit = which("sourcekit-lsp")
    if (sourcekit) {
      return {
        process: spawn(sourcekit, {
          cwd: root,
        }),
      }
    }

    // If sourcekit-lsp not found, check if xcrun is available
    // This is specific to macOS where sourcekit-lsp is typically installed with Xcode
    if (!which("xcrun")) return

    const lspLoc = await output(["xcrun", "--find", "sourcekit-lsp"])

    if (lspLoc.code !== 0) return

    const bin = lspLoc.text.trim()

    return {
      process: spawn(bin, {
        cwd: root,
      }),
    }
  },
}

export const RustAnalyzer: Info = {
  id: "rust",
  root: async (file, ctx) => {
    const crateRoot = await NearestRoot(["Cargo.toml", "Cargo.lock"])(file, ctx)
    if (crateRoot === undefined) {
      return undefined
    }
    let currentDir = crateRoot

    while (currentDir !== path.dirname(currentDir)) {
      // Stop at filesystem root
      const cargoTomlPath = path.join(currentDir, "Cargo.toml")
      try {
        const cargoTomlContent = await Filesystem.readText(cargoTomlPath)
        if (cargoTomlContent.includes("[workspace]")) {
          return currentDir
        }
      } catch {
        // File doesn't exist or can't be read, continue searching up
      }

      const parentDir = path.dirname(currentDir)
      if (parentDir === currentDir) break // Reached filesystem root
      currentDir = parentDir

      // Stop if we've gone above the app root
      if (!currentDir.startsWith(ctx.worktree)) break
    }

    return crateRoot
  },
  extensions: [".rs"],
  async spawn(root) {
    const bin = which("rust-analyzer")
    if (!bin) {
      log.info("rust-analyzer not found in path, please install it")
      return
    }
    return {
      process: spawn(bin, {
        cwd: root,
      }),
    }
  },
}

export const Clangd: Info = {
  id: "clangd",
  root: NearestRoot(["compile_commands.json", "compile_flags.txt", ".clangd"]),
  extensions: [".c", ".cpp", ".cc", ".cxx", ".c++", ".h", ".hpp", ".hh", ".hxx", ".h++"],
  async spawn(root) {
    const args = ["--background-index", "--clang-tidy"]
    const fromPath = which("clangd")
    if (fromPath) {
      return {
        process: spawn(fromPath, args, {
          cwd: root,
        }),
      }
    }

    const ext = process.platform === "win32" ? ".exe" : ""
    const direct = path.join(Global.Path.bin, "clangd" + ext)
    if (await Filesystem.exists(direct)) {
      return {
        process: spawn(direct, args, {
          cwd: root,
        }),
      }
    }

    const entries = await fs.readdir(Global.Path.bin, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (!entry.name.startsWith("clangd_")) continue
      const candidate = path.join(Global.Path.bin, entry.name, "bin", "clangd" + ext)
      if (await Filesystem.exists(candidate)) {
        return {
          process: spawn(candidate, args, {
            cwd: root,
          }),
        }
      }
    }

    if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
    log.info("downloading clangd from GitHub releases")

    const releaseResponse = await fetch("https://api.github.com/repos/clangd/clangd/releases/latest")
    if (!releaseResponse.ok) {
      log.error("Failed to fetch clangd release info")
      return
    }

    const release: {
      tag_name?: string
      assets?: { name?: string; browser_download_url?: string }[]
    } = await releaseResponse.json()

    const tag = release.tag_name
    if (!tag) {
      log.error("clangd release did not include a tag name")
      return
    }
    const platform = process.platform
    const tokens: Record<string, string> = {
      darwin: "mac",
      linux: "linux",
      win32: "windows",
    }
    const token = tokens[platform]
    if (!token) {
      log.error(`Platform ${platform} is not supported by clangd auto-download`)
      return
    }

    const assets = release.assets ?? []
    const valid = (item: { name?: string; browser_download_url?: string }) => {
      if (!item.name) return false
      if (!item.browser_download_url) return false
      if (!item.name.includes(token)) return false
      return item.name.includes(tag)
    }

    const asset =
      assets.find((item) => valid(item) && item.name?.endsWith(".zip")) ??
      assets.find((item) => valid(item) && item.name?.endsWith(".tar.xz")) ??
      assets.find((item) => valid(item))
    if (!asset?.name || !asset.browser_download_url) {
      log.error("clangd could not match release asset", { tag, platform })
      return
    }

    const name = asset.name
    const downloadResponse = await fetch(asset.browser_download_url)
    if (!downloadResponse.ok) {
      log.error("Failed to download clangd")
      return
    }

    const archive = path.join(Global.Path.bin, name)
    const buf = await downloadResponse.arrayBuffer()
    if (buf.byteLength === 0) {
      log.error("Failed to write clangd archive")
      return
    }
    await Filesystem.write(archive, Buffer.from(buf))

    const zip = name.endsWith(".zip")
    const tar = name.endsWith(".tar.xz")
    if (!zip && !tar) {
      log.error("clangd encountered unsupported asset", { asset: name })
      return
    }

    if (zip) {
      const ok = await Archive.extractZip(archive, Global.Path.bin)
        .then(() => true)
        .catch((error) => {
          log.error("Failed to extract clangd archive", { error })
          return false
        })
      if (!ok) return
    }
    if (tar) {
      await run(["tar", "-xf", archive], { cwd: Global.Path.bin })
    }
    await fs.rm(archive, { force: true })

    const bin = path.join(Global.Path.bin, "clangd_" + tag, "bin", "clangd" + ext)
    if (!(await Filesystem.exists(bin))) {
      log.error("Failed to extract clangd binary")
      return
    }

    if (platform !== "win32") {
      await fs.chmod(bin, 0o755).catch(() => {})
    }

    await fs.unlink(path.join(Global.Path.bin, "clangd")).catch(() => {})
    await fs.symlink(bin, path.join(Global.Path.bin, "clangd")).catch(() => {})

    log.info(`installed clangd`, { bin })

    return {
      process: spawn(bin, args, {
        cwd: root,
      }),
    }
  },
}

export const Svelte: Info = {
  id: "svelte",
  extensions: [".svelte"],
  root: NearestRoot(["package-lock.json", "bun.lockb", "bun.lock", "pnpm-lock.yaml", "yarn.lock"]),
  async spawn(root) {
    let binary = which("svelteserver")
    const args: string[] = []
    if (!binary) {
      if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
      const resolved = await Npm.which("svelte-language-server")
      if (!resolved) return
      binary = resolved
    }
    args.push("--stdio")
    const proc = spawn(binary, args, {
      cwd: root,
      env: {
        ...process.env,
      },
    })
    return {
      process: proc,
      initialization: {},
    }
  },
}

export const Astro: Info = {
  id: "astro",
  extensions: [".astro"],
  root: NearestRoot(["package-lock.json", "bun.lockb", "bun.lock", "pnpm-lock.yaml", "yarn.lock"]),
  async spawn(root, ctx) {
    const tsserver = Module.resolve("typescript/lib/tsserver.js", ctx.directory)
    if (!tsserver) {
      log.info("typescript not found, required for Astro language server")
      return
    }
    const tsdk = path.dirname(tsserver)

    let binary = which("astro-ls")
    const args: string[] = []
    if (!binary) {
      if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
      const resolved = await Npm.which("@astrojs/language-server")
      if (!resolved) return
      binary = resolved
    }
    args.push("--stdio")
    const proc = spawn(binary, args, {
      cwd: root,
      env: {
        ...process.env,
      },
    })
    return {
      process: proc,
      initialization: {
        typescript: {
          tsdk,
        },
      },
    }
  },
}

export const JDTLS: Info = {
  id: "jdtls",
  root: async (file, ctx) => {
    // Without exclusions, NearestRoot defaults to instance directory so we can't
    // distinguish between a) no project found and b) project found at instance dir.
    // So we can't choose the root from (potential) monorepo markers first.
    // Look for potential subproject markers first while excluding potential monorepo markers.
    const settingsMarkers = ["settings.gradle", "settings.gradle.kts"]
    const gradleMarkers = ["gradlew", "gradlew.bat"]
    const exclusionsForMonorepos = gradleMarkers.concat(settingsMarkers)

    const [projectRoot, wrapperRoot, settingsRoot] = await Promise.all([
      NearestRoot(["pom.xml", "build.gradle", "build.gradle.kts", ".project", ".classpath"], exclusionsForMonorepos)(
        file,
        ctx,
      ),
      NearestRoot(gradleMarkers, settingsMarkers)(file, ctx),
      NearestRoot(settingsMarkers)(file, ctx),
    ])

    // If projectRoot is undefined we know we are in a monorepo or no project at all.
    // So can safely fall through to the other roots
    if (projectRoot) return projectRoot
    if (wrapperRoot) return wrapperRoot
    if (settingsRoot) return settingsRoot
  },
  extensions: [".java"],
  async spawn(root) {
    const java = which("java")
    if (!java) {
      log.error("Java 21 or newer is required to run the JDTLS. Please install it first.")
      return
    }
    const javaMajorVersion = await run(["java", "-version"]).then((result) => {
      const m = /"(\d+)\.\d+\.\d+"/.exec(result.stderr.toString())
      return !m ? undefined : parseInt(m[1])
    })
    if (javaMajorVersion == null || javaMajorVersion < 21) {
      log.error("JDTLS requires at least Java 21.")
      return
    }
    const distPath = path.join(Global.Path.bin, "jdtls")
    const launcherDir = path.join(distPath, "plugins")
    const installed = await pathExists(launcherDir)
    if (!installed) {
      if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
      log.info("Downloading JDTLS LSP server.")
      await fs.mkdir(distPath, { recursive: true })
      const releaseURL =
        "https://www.eclipse.org/downloads/download.php?file=/jdtls/snapshots/jdt-language-server-latest.tar.gz"
      const archiveName = "release.tar.gz"

      log.info("Downloading JDTLS archive", { url: releaseURL, dest: distPath })
      const download = await fetch(releaseURL)
      if (!download.ok || !download.body) {
        log.error("Failed to download JDTLS", { status: download.status, statusText: download.statusText })
        return
      }
      await Filesystem.writeStream(path.join(distPath, archiveName), download.body)

      log.info("Extracting JDTLS archive")
      const tarResult = await run(["tar", "-xzf", archiveName], { cwd: distPath })
      if (tarResult.code !== 0) {
        log.error("Failed to extract JDTLS", { exitCode: tarResult.code, stderr: tarResult.stderr.toString() })
        return
      }

      await fs.rm(path.join(distPath, archiveName), { force: true })
      log.info("JDTLS download and extraction completed")
    }
    const jarFileName =
      (await fs.readdir(launcherDir).catch(() => []))
        .find((item) => /^org\.eclipse\.equinox\.launcher_.*\.jar$/.test(item))
        ?.trim() ?? ""
    const launcherJar = path.join(launcherDir, jarFileName)
    if (!(await pathExists(launcherJar))) {
      log.error(`Failed to locate the JDTLS launcher module in the installed directory: ${distPath}.`)
      return
    }
    const configFile = path.join(
      distPath,
      (() => {
        switch (process.platform) {
          case "darwin":
            return "config_mac"
          case "linux":
            return "config_linux"
          case "win32":
            return "config_win"
          default:
            return "config_linux"
        }
      })(),
    )
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-jdtls-data"))
    return {
      process: spawn(
        java,
        [
          "-jar",
          launcherJar,
          "-configuration",
          configFile,
          "-data",
          dataDir,
          "-Declipse.application=org.eclipse.jdt.ls.core.id1",
          "-Dosgi.bundles.defaultStartLevel=4",
          "-Declipse.product=org.eclipse.jdt.ls.core.product",
          "-Dlog.level=ALL",
          "--add-modules=ALL-SYSTEM",
          "--add-opens java.base/java.util=ALL-UNNAMED",
          "--add-opens java.base/java.lang=ALL-UNNAMED",
        ],
        {
          cwd: root,
        },
      ),
    }
  },
}

export const KotlinLS: Info = {
  id: "kotlin-ls",
  extensions: [".kt", ".kts"],
  root: async (file, ctx) => {
    // 1) Nearest Gradle root (multi-project or included build)
    const settingsRoot = await NearestRoot(["settings.gradle.kts", "settings.gradle"])(file, ctx)
    if (settingsRoot) return settingsRoot
    // 2) Gradle wrapper (strong root signal)
    const wrapperRoot = await NearestRoot(["gradlew", "gradlew.bat"])(file, ctx)
    if (wrapperRoot) return wrapperRoot
    // 3) Single-project or module-level build
    const buildRoot = await NearestRoot(["build.gradle.kts", "build.gradle"])(file, ctx)
    if (buildRoot) return buildRoot
    // 4) Maven fallback
    return NearestRoot(["pom.xml"])(file, ctx)
  },
  async spawn(root) {
    const distPath = path.join(Global.Path.bin, "kotlin-ls")
    const launcherScript =
      process.platform === "win32" ? path.join(distPath, "kotlin-lsp.cmd") : path.join(distPath, "kotlin-lsp.sh")
    const installed = await Filesystem.exists(launcherScript)
    if (!installed) {
      if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
      log.info("Downloading Kotlin Language Server from GitHub.")

      const releaseResponse = await fetch("https://api.github.com/repos/Kotlin/kotlin-lsp/releases/latest")
      if (!releaseResponse.ok) {
        log.error("Failed to fetch kotlin-lsp release info")
        return
      }

      const release = await releaseResponse.json()
      const version = release.name?.replace(/^v/, "")

      if (!version) {
        log.error("Could not determine Kotlin LSP version from release")
        return
      }

      const platform = process.platform
      const arch = process.arch

      let kotlinArch: string = arch
      if (arch === "arm64") kotlinArch = "aarch64"
      else if (arch === "x64") kotlinArch = "x64"

      let kotlinPlatform: string = platform
      if (platform === "darwin") kotlinPlatform = "mac"
      else if (platform === "linux") kotlinPlatform = "linux"
      else if (platform === "win32") kotlinPlatform = "win"

      const supportedCombos = ["mac-x64", "mac-aarch64", "linux-x64", "linux-aarch64", "win-x64", "win-aarch64"]

      const combo = `${kotlinPlatform}-${kotlinArch}`

      if (!supportedCombos.includes(combo)) {
        log.error(`Platform ${platform}/${arch} is not supported by Kotlin LSP`)
        return
      }

      const assetName = `kotlin-lsp-${version}-${kotlinPlatform}-${kotlinArch}.zip`
      const releaseURL = `https://download-cdn.jetbrains.com/kotlin-lsp/${version}/${assetName}`

      await fs.mkdir(distPath, { recursive: true })
      const archivePath = path.join(distPath, "kotlin-ls.zip")
      const download = await fetch(releaseURL)
      if (!download.ok || !download.body) {
        log.error("Failed to download Kotlin Language Server", {
          status: download.status,
          statusText: download.statusText,
        })
        return
      }
      await Filesystem.writeStream(archivePath, download.body)
      const ok = await Archive.extractZip(archivePath, distPath)
        .then(() => true)
        .catch((error) => {
          log.error("Failed to extract Kotlin LS archive", { error })
          return false
        })
      if (!ok) return
      await fs.rm(archivePath, { force: true })
      if (process.platform !== "win32") {
        await fs.chmod(launcherScript, 0o755).catch(() => {})
      }
      log.info("Installed Kotlin Language Server", { path: launcherScript })
    }
    if (!(await Filesystem.exists(launcherScript))) {
      log.error(`Failed to locate the Kotlin LS launcher script in the installed directory: ${distPath}.`)
      return
    }
    return {
      process: spawn(launcherScript, ["--stdio"], {
        cwd: root,
      }),
    }
  },
}

export const YamlLS: Info = {
  id: "yaml-ls",
  extensions: [".yaml", ".yml"],
  root: NearestRoot(["package-lock.json", "bun.lockb", "bun.lock", "pnpm-lock.yaml", "yarn.lock"]),
  async spawn(root) {
    let binary = which("yaml-language-server")
    const args: string[] = []
    if (!binary) {
      if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
      const resolved = await Npm.which("yaml-language-server")
      if (!resolved) return
      binary = resolved
    }
    args.push("--stdio")
    const proc = spawn(binary, args, {
      cwd: root,
      env: {
        ...process.env,
      },
    })
    return {
      process: proc,
    }
  },
}

export const LuaLS: Info = {
  id: "lua-ls",
  root: NearestRoot([
    ".luarc.json",
    ".luarc.jsonc",
    ".luacheckrc",
    ".stylua.toml",
    "stylua.toml",
    "selene.toml",
    "selene.yml",
  ]),
  extensions: [".lua"],
  async spawn(root) {
    let bin = which("lua-language-server")

    if (!bin) {
      if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
      log.info("downloading lua-language-server from GitHub releases")

      const releaseResponse = await fetch("https://api.github.com/repos/LuaLS/lua-language-server/releases/latest")
      if (!releaseResponse.ok) {
        log.error("Failed to fetch lua-language-server release info")
        return
      }

      const release = await releaseResponse.json()

      const platform = process.platform
      const arch = process.arch
      let assetName = ""

      let lualsArch: string = arch
      if (arch === "arm64") lualsArch = "arm64"
      else if (arch === "x64") lualsArch = "x64"
      else if (arch === "ia32") lualsArch = "ia32"

      let lualsPlatform: string = platform
      if (platform === "darwin") lualsPlatform = "darwin"
      else if (platform === "linux") lualsPlatform = "linux"
      else if (platform === "win32") lualsPlatform = "win32"

      const ext = platform === "win32" ? "zip" : "tar.gz"

      assetName = `lua-language-server-${release.tag_name}-${lualsPlatform}-${lualsArch}.${ext}`

      const supportedCombos = [
        "darwin-arm64.tar.gz",
        "darwin-x64.tar.gz",
        "linux-x64.tar.gz",
        "linux-arm64.tar.gz",
        "win32-x64.zip",
        "win32-ia32.zip",
      ]

      const assetSuffix = `${lualsPlatform}-${lualsArch}.${ext}`
      if (!supportedCombos.includes(assetSuffix)) {
        log.error(`Platform ${platform} and architecture ${arch} is not supported by lua-language-server`)
        return
      }

      const asset = release.assets.find((a: any) => a.name === assetName)
      if (!asset) {
        log.error(`Could not find asset ${assetName} in latest lua-language-server release`)
        return
      }

      const downloadUrl = asset.browser_download_url
      const downloadResponse = await fetch(downloadUrl)
      if (!downloadResponse.ok) {
        log.error("Failed to download lua-language-server")
        return
      }

      const tempPath = path.join(Global.Path.bin, assetName)
      if (downloadResponse.body) await Filesystem.writeStream(tempPath, downloadResponse.body)

      // Unlike zls which is a single self-contained binary,
      // lua-language-server needs supporting files (meta/, locale/, etc.)
      // Extract entire archive to dedicated directory to preserve all files
      const installDir = path.join(Global.Path.bin, `lua-language-server-${lualsArch}-${lualsPlatform}`)

      // Remove old installation if exists
      const stats = await fs.stat(installDir).catch(() => undefined)
      if (stats) {
        await fs.rm(installDir, { force: true, recursive: true })
      }

      await fs.mkdir(installDir, { recursive: true })

      if (ext === "zip") {
        const ok = await Archive.extractZip(tempPath, installDir)
          .then(() => true)
          .catch((error) => {
            log.error("Failed to extract lua-language-server archive", { error })
            return false
          })
        if (!ok) return
      } else {
        const ok = await run(["tar", "-xzf", tempPath, "-C", installDir])
          .then((result) => result.code === 0)
          .catch((error: unknown) => {
            log.error("Failed to extract lua-language-server archive", { error })
            return false
          })
        if (!ok) return
      }

      await fs.rm(tempPath, { force: true })

      // Binary is located in bin/ subdirectory within the extracted archive
      bin = path.join(installDir, "bin", "lua-language-server" + (platform === "win32" ? ".exe" : ""))

      if (!(await Filesystem.exists(bin))) {
        log.error("Failed to extract lua-language-server binary")
        return
      }

      if (platform !== "win32") {
        const ok = await fs
          .chmod(bin, 0o755)
          .then(() => true)
          .catch((error: unknown) => {
            log.error("Failed to set executable permission for lua-language-server binary", {
              error,
            })
            return false
          })
        if (!ok) return
      }

      log.info(`installed lua-language-server`, { bin })
    }

    return {
      process: spawn(bin, {
        cwd: root,
      }),
    }
  },
}

export const PHPIntelephense: Info = {
  id: "php intelephense",
  extensions: [".php"],
  root: NearestRoot(["composer.json", "composer.lock", ".php-version"]),
  async spawn(root) {
    let binary = which("intelephense")
    const args: string[] = []
    if (!binary) {
      if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
      const resolved = await Npm.which("intelephense")
      if (!resolved) return
      binary = resolved
    }
    args.push("--stdio")
    const proc = spawn(binary, args, {
      cwd: root,
      env: {
        ...process.env,
      },
    })
    return {
      process: proc,
      initialization: {
        telemetry: {
          enabled: false,
        },
      },
    }
  },
}

export const Prisma: Info = {
  id: "prisma",
  extensions: [".prisma"],
  root: NearestRoot(["schema.prisma", "prisma/schema.prisma", "prisma"], ["package.json"]),
  async spawn(root) {
    const prisma = which("prisma")
    if (!prisma) {
      log.info("prisma not found, please install prisma")
      return
    }
    return {
      process: spawn(prisma, ["language-server"], {
        cwd: root,
      }),
    }
  },
}

export const Dart: Info = {
  id: "dart",
  extensions: [".dart"],
  root: NearestRoot(["pubspec.yaml", "analysis_options.yaml"]),
  async spawn(root) {
    const dart = which("dart")
    if (!dart) {
      log.info("dart not found, please install dart first")
      return
    }
    return {
      process: spawn(dart, ["language-server", "--lsp"], {
        cwd: root,
      }),
    }
  },
}

export const Ocaml: Info = {
  id: "ocaml-lsp",
  extensions: [".ml", ".mli"],
  root: NearestRoot(["dune-project", "dune-workspace", ".merlin", "opam"]),
  async spawn(root) {
    const bin = which("ocamllsp")
    if (!bin) {
      log.info("ocamllsp not found, please install ocaml-lsp-server")
      return
    }
    return {
      process: spawn(bin, {
        cwd: root,
      }),
    }
  },
}
export const BashLS: Info = {
  id: "bash",
  extensions: [".sh", ".bash", ".zsh", ".ksh"],
  root: async (_file, ctx) => ctx.directory,
  async spawn(root) {
    let binary = which("bash-language-server")
    const args: string[] = []
    if (!binary) {
      if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
      const resolved = await Npm.which("bash-language-server")
      if (!resolved) return
      binary = resolved
    }
    args.push("start")
    const proc = spawn(binary, args, {
      cwd: root,
      env: {
        ...process.env,
      },
    })
    return {
      process: proc,
    }
  },
}

export const TerraformLS: Info = {
  id: "terraform",
  extensions: [".tf", ".tfvars"],
  root: NearestRoot([".terraform.lock.hcl", "terraform.tfstate", "*.tf"]),
  async spawn(root) {
    let bin = which("terraform-ls")

    if (!bin) {
      if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
      log.info("downloading terraform-ls from HashiCorp releases")

      const releaseResponse = await fetch("https://api.releases.hashicorp.com/v1/releases/terraform-ls/latest")
      if (!releaseResponse.ok) {
        log.error("Failed to fetch terraform-ls release info")
        return
      }

      const release = (await releaseResponse.json()) as {
        version?: string
        builds?: { arch?: string; os?: string; url?: string }[]
      }

      const platform = process.platform
      const arch = process.arch

      const tfArch = arch === "arm64" ? "arm64" : "amd64"
      const tfPlatform = platform === "win32" ? "windows" : platform

      const builds = release.builds ?? []
      const build = builds.find((b) => b.arch === tfArch && b.os === tfPlatform)
      if (!build?.url) {
        log.error(`Could not find build for ${tfPlatform}/${tfArch} terraform-ls release version ${release.version}`)
        return
      }

      const downloadResponse = await fetch(build.url)
      if (!downloadResponse.ok) {
        log.error("Failed to download terraform-ls")
        return
      }

      const tempPath = path.join(Global.Path.bin, "terraform-ls.zip")
      if (downloadResponse.body) await Filesystem.writeStream(tempPath, downloadResponse.body)

      const ok = await Archive.extractZip(tempPath, Global.Path.bin)
        .then(() => true)
        .catch((error) => {
          log.error("Failed to extract terraform-ls archive", { error })
          return false
        })
      if (!ok) return
      await fs.rm(tempPath, { force: true })

      bin = path.join(Global.Path.bin, "terraform-ls" + (platform === "win32" ? ".exe" : ""))

      if (!(await Filesystem.exists(bin))) {
        log.error("Failed to extract terraform-ls binary")
        return
      }

      if (platform !== "win32") {
        await fs.chmod(bin, 0o755).catch(() => {})
      }

      log.info(`installed terraform-ls`, { bin })
    }

    return {
      process: spawn(bin, ["serve"], {
        cwd: root,
      }),
      initialization: {
        experimentalFeatures: {
          prefillRequiredFields: true,
          validateOnSave: true,
        },
      },
    }
  },
}

export const TexLab: Info = {
  id: "texlab",
  extensions: [".tex", ".bib"],
  root: NearestRoot([".latexmkrc", "latexmkrc", ".texlabroot", "texlabroot"]),
  async spawn(root) {
    let bin = which("texlab")

    if (!bin) {
      if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
      log.info("downloading texlab from GitHub releases")

      const response = await fetch("https://api.github.com/repos/latex-lsp/texlab/releases/latest")
      if (!response.ok) {
        log.error("Failed to fetch texlab release info")
        return
      }

      const release = (await response.json()) as {
        tag_name?: string
        assets?: { name?: string; browser_download_url?: string }[]
      }
      const version = release.tag_name?.replace("v", "")
      if (!version) {
        log.error("texlab release did not include a version tag")
        return
      }

      const platform = process.platform
      const arch = process.arch

      const texArch = arch === "arm64" ? "aarch64" : "x86_64"
      const texPlatform = platform === "darwin" ? "macos" : platform === "win32" ? "windows" : "linux"
      const ext = platform === "win32" ? "zip" : "tar.gz"
      const assetName = `texlab-${texArch}-${texPlatform}.${ext}`

      const assets = release.assets ?? []
      const asset = assets.find((a) => a.name === assetName)
      if (!asset?.browser_download_url) {
        log.error(`Could not find asset ${assetName} in texlab release`)
        return
      }

      const downloadResponse = await fetch(asset.browser_download_url)
      if (!downloadResponse.ok) {
        log.error("Failed to download texlab")
        return
      }

      const tempPath = path.join(Global.Path.bin, assetName)
      if (downloadResponse.body) await Filesystem.writeStream(tempPath, downloadResponse.body)

      if (ext === "zip") {
        const ok = await Archive.extractZip(tempPath, Global.Path.bin)
          .then(() => true)
          .catch((error) => {
            log.error("Failed to extract texlab archive", { error })
            return false
          })
        if (!ok) return
      }
      if (ext === "tar.gz") {
        await run(["tar", "-xzf", tempPath], { cwd: Global.Path.bin })
      }

      await fs.rm(tempPath, { force: true })

      bin = path.join(Global.Path.bin, "texlab" + (platform === "win32" ? ".exe" : ""))

      if (!(await Filesystem.exists(bin))) {
        log.error("Failed to extract texlab binary")
        return
      }

      if (platform !== "win32") {
        await fs.chmod(bin, 0o755).catch(() => {})
      }

      log.info("installed texlab", { bin })
    }

    return {
      process: spawn(bin, {
        cwd: root,
      }),
    }
  },
}

export const DockerfileLS: Info = {
  id: "dockerfile",
  extensions: [".dockerfile", "Dockerfile"],
  root: async (_file, ctx) => ctx.directory,
  async spawn(root) {
    let binary = which("docker-langserver")
    const args: string[] = []
    if (!binary) {
      if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
      const resolved = await Npm.which("dockerfile-language-server-nodejs")
      if (!resolved) return
      binary = resolved
    }
    args.push("--stdio")
    const proc = spawn(binary, args, {
      cwd: root,
      env: {
        ...process.env,
      },
    })
    return {
      process: proc,
    }
  },
}

export const Gleam: Info = {
  id: "gleam",
  extensions: [".gleam"],
  root: NearestRoot(["gleam.toml"]),
  async spawn(root) {
    const gleam = which("gleam")
    if (!gleam) {
      log.info("gleam not found, please install gleam first")
      return
    }
    return {
      process: spawn(gleam, ["lsp"], {
        cwd: root,
      }),
    }
  },
}

export const Clojure: Info = {
  id: "clojure-lsp",
  extensions: [".clj", ".cljs", ".cljc", ".edn"],
  root: NearestRoot(["deps.edn", "project.clj", "shadow-cljs.edn", "bb.edn", "build.boot"]),
  async spawn(root) {
    let bin = which("clojure-lsp")
    if (!bin && process.platform === "win32") {
      bin = which("clojure-lsp.exe")
    }
    if (!bin) {
      log.info("clojure-lsp not found, please install clojure-lsp first")
      return
    }
    return {
      process: spawn(bin, ["listen"], {
        cwd: root,
      }),
    }
  },
}

export const Nixd: Info = {
  id: "nixd",
  extensions: [".nix"],
  root: async (file, ctx) => {
    // First, look for flake.nix - the most reliable Nix project root indicator
    const flakeRoot = await NearestRoot(["flake.nix"])(file, ctx)
    if (flakeRoot && flakeRoot !== ctx.directory) return flakeRoot

    // If no flake.nix, fall back to git repository root
    if (ctx.worktree && ctx.worktree !== ctx.directory) return ctx.worktree

    // Finally, use the instance directory as fallback
    return ctx.directory
  },
  async spawn(root) {
    const nixd = which("nixd")
    if (!nixd) {
      log.info("nixd not found, please install nixd first")
      return
    }
    return {
      process: spawn(nixd, [], {
        cwd: root,
        env: {
          ...process.env,
        },
      }),
    }
  },
}

export const Tinymist: Info = {
  id: "tinymist",
  extensions: [".typ", ".typc"],
  root: NearestRoot(["typst.toml"]),
  async spawn(root) {
    let bin = which("tinymist")

    if (!bin) {
      if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
      log.info("downloading tinymist from GitHub releases")

      const response = await fetch("https://api.github.com/repos/Myriad-Dreamin/tinymist/releases/latest")
      if (!response.ok) {
        log.error("Failed to fetch tinymist release info")
        return
      }

      const release = (await response.json()) as {
        tag_name?: string
        assets?: { name?: string; browser_download_url?: string }[]
      }

      const platform = process.platform
      const arch = process.arch

      const tinymistArch = arch === "arm64" ? "aarch64" : "x86_64"
      let tinymistPlatform: string
      let ext: string

      if (platform === "darwin") {
        tinymistPlatform = "apple-darwin"
        ext = "tar.gz"
      } else if (platform === "win32") {
        tinymistPlatform = "pc-windows-msvc"
        ext = "zip"
      } else {
        tinymistPlatform = "unknown-linux-gnu"
        ext = "tar.gz"
      }

      const assetName = `tinymist-${tinymistArch}-${tinymistPlatform}.${ext}`

      const assets = release.assets ?? []
      const asset = assets.find((a) => a.name === assetName)
      if (!asset?.browser_download_url) {
        log.error(`Could not find asset ${assetName} in tinymist release`)
        return
      }

      const downloadResponse = await fetch(asset.browser_download_url)
      if (!downloadResponse.ok) {
        log.error("Failed to download tinymist")
        return
      }

      const tempPath = path.join(Global.Path.bin, assetName)
      if (downloadResponse.body) await Filesystem.writeStream(tempPath, downloadResponse.body)

      if (ext === "zip") {
        const ok = await Archive.extractZip(tempPath, Global.Path.bin)
          .then(() => true)
          .catch((error) => {
            log.error("Failed to extract tinymist archive", { error })
            return false
          })
        if (!ok) return
      } else {
        await run(["tar", "-xzf", tempPath, "--strip-components=1"], { cwd: Global.Path.bin })
      }

      await fs.rm(tempPath, { force: true })

      bin = path.join(Global.Path.bin, "tinymist" + (platform === "win32" ? ".exe" : ""))

      if (!(await Filesystem.exists(bin))) {
        log.error("Failed to extract tinymist binary")
        return
      }

      if (platform !== "win32") {
        await fs.chmod(bin, 0o755).catch(() => {})
      }

      log.info("installed tinymist", { bin })
    }

    return {
      process: spawn(bin, { cwd: root }),
    }
  },
}

export const HLS: Info = {
  id: "haskell-language-server",
  extensions: [".hs", ".lhs"],
  root: NearestRoot(["stack.yaml", "cabal.project", "hie.yaml", "*.cabal"]),
  async spawn(root) {
    const bin = which("haskell-language-server-wrapper")
    if (!bin) {
      log.info("haskell-language-server-wrapper not found, please install haskell-language-server")
      return
    }
    return {
      process: spawn(bin, ["--lsp"], {
        cwd: root,
      }),
    }
  },
}

export const JuliaLS: Info = {
  id: "julials",
  extensions: [".jl"],
  root: NearestRoot(["Project.toml", "Manifest.toml", "*.jl"]),
  async spawn(root) {
    const julia = which("julia")
    if (!julia) {
      log.info("julia not found, please install julia first (https://julialang.org/downloads/)")
      return
    }
    return {
      process: spawn(julia, ["--startup-file=no", "--history-file=no", "-e", "using LanguageServer; runserver()"], {
        cwd: root,
      }),
    }
  },
}
