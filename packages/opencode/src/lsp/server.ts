import { spawn, type ChildProcessWithoutNullStreams } from "child_process"
import path from "path"
import os from "os"
import { Global } from "../global"
import { Log } from "../util/log"
import { BunProc } from "../bun"
import { $, readableStreamToText } from "bun"
import fs from "fs/promises"
import { Filesystem } from "../util/filesystem"
import { Instance } from "../project/instance"
import { Flag } from "../flag/flag"
import { Archive } from "../util/archive"

export namespace LSPServer {
  const log = Log.create({ service: "lsp.server" })
  const pathExists = async (p: string) =>
    fs
      .stat(p)
      .then(() => true)
      .catch(() => false)

  export interface Handle {
    process: ChildProcessWithoutNullStreams
    initialization?: Record<string, any>
  }

  type RootFunction = (file: string) => Promise<string | undefined>

  const NearestRoot = (includePatterns: string[], excludePatterns?: string[]): RootFunction => {
    return async (file) => {
      if (excludePatterns) {
        const excludedFiles = Filesystem.up({
          targets: excludePatterns,
          start: path.dirname(file),
          stop: Instance.directory,
        })
        const excluded = await excludedFiles.next()
        await excludedFiles.return()
        if (excluded.value) return undefined
      }
      const files = Filesystem.up({
        targets: includePatterns,
        start: path.dirname(file),
        stop: Instance.directory,
      })
      const first = await files.next()
      await files.return()
      if (!first.value) return Instance.directory
      return path.dirname(first.value)
    }
  }

  export interface Info {
    id: string
    extensions: string[]
    global?: boolean
    root: RootFunction
    spawn(root: string): Promise<Handle | undefined>
  }

  export const Deno: Info = {
    id: "deno",
    root: async (file) => {
      const files = Filesystem.up({
        targets: ["deno.json", "deno.jsonc"],
        start: path.dirname(file),
        stop: Instance.directory,
      })
      const first = await files.next()
      await files.return()
      if (!first.value) return undefined
      return path.dirname(first.value)
    },
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs"],
    async spawn(root) {
      const deno = Bun.which("deno")
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
    async spawn(root) {
      const tsserver = await Bun.resolve("typescript/lib/tsserver.js", Instance.directory).catch(() => {})
      log.info("typescript server", { tsserver })
      if (!tsserver) return
      const proc = spawn(BunProc.which(), ["x", "typescript-language-server", "--stdio"], {
        cwd: root,
        env: {
          ...process.env,
          BUN_BE_BUN: "1",
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
      let binary = Bun.which("vue-language-server")
      const args: string[] = []
      if (!binary) {
        const js = path.join(
          Global.Path.bin,
          "node_modules",
          "@vue",
          "language-server",
          "bin",
          "vue-language-server.js",
        )
        if (!(await Bun.file(js).exists())) {
          if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
          await Bun.spawn([BunProc.which(), "install", "@vue/language-server"], {
            cwd: Global.Path.bin,
            env: {
              ...process.env,
              BUN_BE_BUN: "1",
            },
            stdout: "pipe",
            stderr: "pipe",
            stdin: "pipe",
          }).exited
        }
        binary = BunProc.which()
        args.push("run", js)
      }
      args.push("--stdio")
      const proc = spawn(binary, args, {
        cwd: root,
        env: {
          ...process.env,
          BUN_BE_BUN: "1",
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
    async spawn(root) {
      const eslint = await Bun.resolve("eslint", Instance.directory).catch(() => {})
      if (!eslint) return
      log.info("spawning eslint server")
      const serverPath = path.join(Global.Path.bin, "vscode-eslint", "server", "out", "eslintServer.js")
      if (!(await Bun.file(serverPath).exists())) {
        if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
        log.info("downloading and building VS Code ESLint server")
        const response = await fetch("https://github.com/microsoft/vscode-eslint/archive/refs/heads/main.zip")
        if (!response.ok) return

        const zipPath = path.join(Global.Path.bin, "vscode-eslint.zip")
        await Bun.file(zipPath).write(response)

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
        await $`${npmCmd} install`.cwd(finalPath).quiet()
        await $`${npmCmd} run compile`.cwd(finalPath).quiet()

        log.info("installed VS Code ESLint server", { serverPath })
      }

      const proc = spawn(BunProc.which(), [serverPath, "--stdio"], {
        cwd: root,
        env: {
          ...process.env,
          BUN_BE_BUN: "1",
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
    async spawn(root) {
      const ext = process.platform === "win32" ? ".cmd" : ""

      const serverTarget = path.join("node_modules", ".bin", "oxc_language_server" + ext)
      const lintTarget = path.join("node_modules", ".bin", "oxlint" + ext)

      const resolveBin = async (target: string) => {
        const localBin = path.join(root, target)
        if (await Bun.file(localBin).exists()) return localBin

        const candidates = Filesystem.up({
          targets: [target],
          start: root,
          stop: Instance.worktree,
        })
        const first = await candidates.next()
        await candidates.return()
        if (first.value) return first.value

        return undefined
      }

      let lintBin = await resolveBin(lintTarget)
      if (!lintBin) {
        const found = Bun.which("oxlint")
        if (found) lintBin = found
      }

      if (lintBin) {
        const proc = Bun.spawn([lintBin, "--help"], { stdout: "pipe" })
        await proc.exited
        const help = await readableStreamToText(proc.stdout)
        if (help.includes("--lsp")) {
          return {
            process: spawn(lintBin, ["--lsp"], {
              cwd: root,
            }),
          }
        }
      }

      let serverBin = await resolveBin(serverTarget)
      if (!serverBin) {
        const found = Bun.which("oxc_language_server")
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
      if (await Bun.file(localBin).exists()) bin = localBin
      if (!bin) {
        const found = Bun.which("biome")
        if (found) bin = found
      }

      let args = ["lsp-proxy", "--stdio"]

      if (!bin) {
        const resolved = await Bun.resolve("biome", root).catch(() => undefined)
        if (!resolved) return
        bin = BunProc.which()
        args = ["x", "biome", "lsp-proxy", "--stdio"]
      }

      const proc = spawn(bin, args, {
        cwd: root,
        env: {
          ...process.env,
          BUN_BE_BUN: "1",
        },
      })

      return {
        process: proc,
      }
    },
  }

  export const Gopls: Info = {
    id: "gopls",
    root: async (file) => {
      const work = await NearestRoot(["go.work"])(file)
      if (work) return work
      return NearestRoot(["go.mod", "go.sum"])(file)
    },
    extensions: [".go"],
    async spawn(root) {
      let bin = Bun.which("gopls", {
        PATH: process.env["PATH"] + path.delimiter + Global.Path.bin,
      })
      if (!bin) {
        if (!Bun.which("go")) return
        if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return

        log.info("installing gopls")
        const proc = Bun.spawn({
          cmd: ["go", "install", "golang.org/x/tools/gopls@latest"],
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
      let bin = Bun.which("rubocop", {
        PATH: process.env["PATH"] + path.delimiter + Global.Path.bin,
      })
      if (!bin) {
        const ruby = Bun.which("ruby")
        const gem = Bun.which("gem")
        if (!ruby || !gem) {
          log.info("Ruby not found, please install Ruby first")
          return
        }
        if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
        log.info("installing rubocop")
        const proc = Bun.spawn({
          cmd: ["gem", "install", "rubocop", "--bindir", Global.Path.bin],
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

      let binary = Bun.which("ty")

      const initialization: Record<string, string> = {}

      const potentialVenvPaths = [process.env["VIRTUAL_ENV"], path.join(root, ".venv"), path.join(root, "venv")].filter(
        (p): p is string => p !== undefined,
      )
      for (const venvPath of potentialVenvPaths) {
        const isWindows = process.platform === "win32"
        const potentialPythonPath = isWindows
          ? path.join(venvPath, "Scripts", "python.exe")
          : path.join(venvPath, "bin", "python")
        if (await Bun.file(potentialPythonPath).exists()) {
          initialization["pythonPath"] = potentialPythonPath
          break
        }
      }

      if (!binary) {
        for (const venvPath of potentialVenvPaths) {
          const isWindows = process.platform === "win32"
          const potentialTyPath = isWindows
            ? path.join(venvPath, "Scripts", "ty.exe")
            : path.join(venvPath, "bin", "ty")
          if (await Bun.file(potentialTyPath).exists()) {
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
      let binary = Bun.which("pyright-langserver")
      const args = []
      if (!binary) {
        const js = path.join(Global.Path.bin, "node_modules", "pyright", "dist", "pyright-langserver.js")
        if (!(await Bun.file(js).exists())) {
          if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
          await Bun.spawn([BunProc.which(), "install", "pyright"], {
            cwd: Global.Path.bin,
            env: {
              ...process.env,
              BUN_BE_BUN: "1",
            },
          }).exited
        }
        binary = BunProc.which()
        args.push(...["run", js])
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
        if (await Bun.file(potentialPythonPath).exists()) {
          initialization["pythonPath"] = potentialPythonPath
          break
        }
      }

      const proc = spawn(binary, args, {
        cwd: root,
        env: {
          ...process.env,
          BUN_BE_BUN: "1",
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
      let binary = Bun.which("elixir-ls")
      if (!binary) {
        const elixirLsPath = path.join(Global.Path.bin, "elixir-ls")
        binary = path.join(
          Global.Path.bin,
          "elixir-ls-master",
          "release",
          process.platform === "win32" ? "language_server.bat" : "language_server.sh",
        )

        if (!(await Bun.file(binary).exists())) {
          const elixir = Bun.which("elixir")
          if (!elixir) {
            log.error("elixir is required to run elixir-ls")
            return
          }

          if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
          log.info("downloading elixir-ls from GitHub releases")

          const response = await fetch("https://github.com/elixir-lsp/elixir-ls/archive/refs/heads/master.zip")
          if (!response.ok) return
          const zipPath = path.join(Global.Path.bin, "elixir-ls.zip")
          await Bun.file(zipPath).write(response)

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

          await $`mix deps.get && mix compile && mix elixir_ls.release2 -o release`
            .quiet()
            .cwd(path.join(Global.Path.bin, "elixir-ls-master"))
            .env({ MIX_ENV: "prod", ...process.env })

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
      let bin = Bun.which("zls", {
        PATH: process.env["PATH"] + path.delimiter + Global.Path.bin,
      })

      if (!bin) {
        const zig = Bun.which("zig")
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

        const release = (await releaseResponse.json()) as any

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

        const asset = release.assets.find((a: any) => a.name === assetName)
        if (!asset) {
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
        await Bun.file(tempPath).write(downloadResponse)

        if (ext === "zip") {
          const ok = await Archive.extractZip(tempPath, Global.Path.bin)
            .then(() => true)
            .catch((error) => {
              log.error("Failed to extract zls archive", { error })
              return false
            })
          if (!ok) return
        } else {
          await $`tar -xf ${tempPath}`.cwd(Global.Path.bin).quiet().nothrow()
        }

        await fs.rm(tempPath, { force: true })

        bin = path.join(Global.Path.bin, "zls" + (platform === "win32" ? ".exe" : ""))

        if (!(await Bun.file(bin).exists())) {
          log.error("Failed to extract zls binary")
          return
        }

        if (platform !== "win32") {
          await $`chmod +x ${bin}`.quiet().nothrow()
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
    root: NearestRoot([".sln", ".csproj", "global.json"]),
    extensions: [".cs"],
    async spawn(root) {
      let bin = Bun.which("csharp-ls", {
        PATH: process.env["PATH"] + path.delimiter + Global.Path.bin,
      })
      if (!bin) {
        if (!Bun.which("dotnet")) {
          log.error(".NET SDK is required to install csharp-ls")
          return
        }

        if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
        log.info("installing csharp-ls via dotnet tool")
        const proc = Bun.spawn({
          cmd: ["dotnet", "tool", "install", "csharp-ls", "--tool-path", Global.Path.bin],
          stdout: "pipe",
          stderr: "pipe",
          stdin: "pipe",
        })
        const exit = await proc.exited
        if (exit !== 0) {
          log.error("Failed to install csharp-ls")
          return
        }

        bin = path.join(Global.Path.bin, "csharp-ls" + (process.platform === "win32" ? ".exe" : ""))
        log.info(`installed csharp-ls`, { bin })
      }

      return {
        process: spawn(bin, {
          cwd: root,
        }),
      }
    },
  }

  export const FSharp: Info = {
    id: "fsharp",
    root: NearestRoot([".sln", ".fsproj", "global.json"]),
    extensions: [".fs", ".fsi", ".fsx", ".fsscript"],
    async spawn(root) {
      let bin = Bun.which("fsautocomplete", {
        PATH: process.env["PATH"] + path.delimiter + Global.Path.bin,
      })
      if (!bin) {
        if (!Bun.which("dotnet")) {
          log.error(".NET SDK is required to install fsautocomplete")
          return
        }

        if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
        log.info("installing fsautocomplete via dotnet tool")
        const proc = Bun.spawn({
          cmd: ["dotnet", "tool", "install", "fsautocomplete", "--tool-path", Global.Path.bin],
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
      const sourcekit = Bun.which("sourcekit-lsp")
      if (sourcekit) {
        return {
          process: spawn(sourcekit, {
            cwd: root,
          }),
        }
      }

      // If sourcekit-lsp not found, check if xcrun is available
      // This is specific to macOS where sourcekit-lsp is typically installed with Xcode
      if (!Bun.which("xcrun")) return

      const lspLoc = await $`xcrun --find sourcekit-lsp`.quiet().nothrow()

      if (lspLoc.exitCode !== 0) return

      const bin = lspLoc.text().trim()

      return {
        process: spawn(bin, {
          cwd: root,
        }),
      }
    },
  }

  export const RustAnalyzer: Info = {
    id: "rust",
    root: async (root) => {
      const crateRoot = await NearestRoot(["Cargo.toml", "Cargo.lock"])(root)
      if (crateRoot === undefined) {
        return undefined
      }
      let currentDir = crateRoot

      while (currentDir !== path.dirname(currentDir)) {
        // Stop at filesystem root
        const cargoTomlPath = path.join(currentDir, "Cargo.toml")
        try {
          const cargoTomlContent = await Bun.file(cargoTomlPath).text()
          if (cargoTomlContent.includes("[workspace]")) {
            return currentDir
          }
        } catch (err) {
          // File doesn't exist or can't be read, continue searching up
        }

        const parentDir = path.dirname(currentDir)
        if (parentDir === currentDir) break // Reached filesystem root
        currentDir = parentDir

        // Stop if we've gone above the app root
        if (!currentDir.startsWith(Instance.worktree)) break
      }

      return crateRoot
    },
    extensions: [".rs"],
    async spawn(root) {
      const bin = Bun.which("rust-analyzer")
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
    root: NearestRoot(["compile_commands.json", "compile_flags.txt", ".clangd", "CMakeLists.txt", "Makefile"]),
    extensions: [".c", ".cpp", ".cc", ".cxx", ".c++", ".h", ".hpp", ".hh", ".hxx", ".h++"],
    async spawn(root) {
      const args = ["--background-index", "--clang-tidy"]
      const fromPath = Bun.which("clangd")
      if (fromPath) {
        return {
          process: spawn(fromPath, args, {
            cwd: root,
          }),
        }
      }

      const ext = process.platform === "win32" ? ".exe" : ""
      const direct = path.join(Global.Path.bin, "clangd" + ext)
      if (await Bun.file(direct).exists()) {
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
        if (await Bun.file(candidate).exists()) {
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
      await Bun.write(archive, buf)

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
        await $`tar -xf ${archive}`.cwd(Global.Path.bin).quiet().nothrow()
      }
      await fs.rm(archive, { force: true })

      const bin = path.join(Global.Path.bin, "clangd_" + tag, "bin", "clangd" + ext)
      if (!(await Bun.file(bin).exists())) {
        log.error("Failed to extract clangd binary")
        return
      }

      if (platform !== "win32") {
        await $`chmod +x ${bin}`.quiet().nothrow()
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
      let binary = Bun.which("svelteserver")
      const args: string[] = []
      if (!binary) {
        const js = path.join(Global.Path.bin, "node_modules", "svelte-language-server", "bin", "server.js")
        if (!(await Bun.file(js).exists())) {
          if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
          await Bun.spawn([BunProc.which(), "install", "svelte-language-server"], {
            cwd: Global.Path.bin,
            env: {
              ...process.env,
              BUN_BE_BUN: "1",
            },
            stdout: "pipe",
            stderr: "pipe",
            stdin: "pipe",
          }).exited
        }
        binary = BunProc.which()
        args.push("run", js)
      }
      args.push("--stdio")
      const proc = spawn(binary, args, {
        cwd: root,
        env: {
          ...process.env,
          BUN_BE_BUN: "1",
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
    async spawn(root) {
      const tsserver = await Bun.resolve("typescript/lib/tsserver.js", Instance.directory).catch(() => {})
      if (!tsserver) {
        log.info("typescript not found, required for Astro language server")
        return
      }
      const tsdk = path.dirname(tsserver)

      let binary = Bun.which("astro-ls")
      const args: string[] = []
      if (!binary) {
        const js = path.join(Global.Path.bin, "node_modules", "@astrojs", "language-server", "bin", "nodeServer.js")
        if (!(await Bun.file(js).exists())) {
          if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
          await Bun.spawn([BunProc.which(), "install", "@astrojs/language-server"], {
            cwd: Global.Path.bin,
            env: {
              ...process.env,
              BUN_BE_BUN: "1",
            },
            stdout: "pipe",
            stderr: "pipe",
            stdin: "pipe",
          }).exited
        }
        binary = BunProc.which()
        args.push("run", js)
      }
      args.push("--stdio")
      const proc = spawn(binary, args, {
        cwd: root,
        env: {
          ...process.env,
          BUN_BE_BUN: "1",
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
    root: NearestRoot(["pom.xml", "build.gradle", "build.gradle.kts", ".project", ".classpath"]),
    extensions: [".java"],
    async spawn(root) {
      const java = Bun.which("java")
      if (!java) {
        log.error("Java 21 or newer is required to run the JDTLS. Please install it first.")
        return
      }
      const javaMajorVersion = await $`java -version`
        .quiet()
        .nothrow()
        .then(({ stderr }) => {
          const m = /"(\d+)\.\d+\.\d+"/.exec(stderr.toString())
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
        const archivePath = path.join(distPath, "release.tar.gz")
        await $`curl -L -o '${archivePath}' '${releaseURL}'`.quiet().nothrow()
        await $`tar -xzf ${archivePath}`.cwd(distPath).quiet().nothrow()
        await fs.rm(archivePath, { force: true })
      }
      const jarFileName = await $`ls org.eclipse.equinox.launcher_*.jar`
        .cwd(launcherDir)
        .quiet()
        .nothrow()
        .then(({ stdout }) => stdout.toString().trim())
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
    root: async (file) => {
      // 1) Nearest Gradle root (multi-project or included build)
      const settingsRoot = await NearestRoot(["settings.gradle.kts", "settings.gradle"])(file)
      if (settingsRoot) return settingsRoot
      // 2) Gradle wrapper (strong root signal)
      const wrapperRoot = await NearestRoot(["gradlew", "gradlew.bat"])(file)
      if (wrapperRoot) return wrapperRoot
      // 3) Single-project or module-level build
      const buildRoot = await NearestRoot(["build.gradle.kts", "build.gradle"])(file)
      if (buildRoot) return buildRoot
      // 4) Maven fallback
      return NearestRoot(["pom.xml"])(file)
    },
    async spawn(root) {
      const distPath = path.join(Global.Path.bin, "kotlin-ls")
      const launcherScript =
        process.platform === "win32" ? path.join(distPath, "kotlin-lsp.cmd") : path.join(distPath, "kotlin-lsp.sh")
      const installed = await Bun.file(launcherScript).exists()
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
        await $`curl -L -o '${archivePath}' '${releaseURL}'`.quiet().nothrow()
        const ok = await Archive.extractZip(archivePath, distPath)
          .then(() => true)
          .catch((error) => {
            log.error("Failed to extract Kotlin LS archive", { error })
            return false
          })
        if (!ok) return
        await fs.rm(archivePath, { force: true })
        if (process.platform !== "win32") {
          await $`chmod +x ${launcherScript}`.quiet().nothrow()
        }
        log.info("Installed Kotlin Language Server", { path: launcherScript })
      }
      if (!(await Bun.file(launcherScript).exists())) {
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
      let binary = Bun.which("yaml-language-server")
      const args: string[] = []
      if (!binary) {
        const js = path.join(
          Global.Path.bin,
          "node_modules",
          "yaml-language-server",
          "out",
          "server",
          "src",
          "server.js",
        )
        const exists = await Bun.file(js).exists()
        if (!exists) {
          if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
          await Bun.spawn([BunProc.which(), "install", "yaml-language-server"], {
            cwd: Global.Path.bin,
            env: {
              ...process.env,
              BUN_BE_BUN: "1",
            },
            stdout: "pipe",
            stderr: "pipe",
            stdin: "pipe",
          }).exited
        }
        binary = BunProc.which()
        args.push("run", js)
      }
      args.push("--stdio")
      const proc = spawn(binary, args, {
        cwd: root,
        env: {
          ...process.env,
          BUN_BE_BUN: "1",
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
      let bin = Bun.which("lua-language-server", {
        PATH: process.env["PATH"] + path.delimiter + Global.Path.bin,
      })

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
        await Bun.file(tempPath).write(downloadResponse)

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
          const ok = await $`tar -xzf ${tempPath} -C ${installDir}`
            .quiet()
            .then(() => true)
            .catch((error) => {
              log.error("Failed to extract lua-language-server archive", { error })
              return false
            })
          if (!ok) return
        }

        await fs.rm(tempPath, { force: true })

        // Binary is located in bin/ subdirectory within the extracted archive
        bin = path.join(installDir, "bin", "lua-language-server" + (platform === "win32" ? ".exe" : ""))

        if (!(await Bun.file(bin).exists())) {
          log.error("Failed to extract lua-language-server binary")
          return
        }

        if (platform !== "win32") {
          const ok = await $`chmod +x ${bin}`.quiet().catch((error) => {
            log.error("Failed to set executable permission for lua-language-server binary", {
              error,
            })
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
      let binary = Bun.which("intelephense")
      const args: string[] = []
      if (!binary) {
        const js = path.join(Global.Path.bin, "node_modules", "intelephense", "lib", "intelephense.js")
        if (!(await Bun.file(js).exists())) {
          if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
          await Bun.spawn([BunProc.which(), "install", "intelephense"], {
            cwd: Global.Path.bin,
            env: {
              ...process.env,
              BUN_BE_BUN: "1",
            },
            stdout: "pipe",
            stderr: "pipe",
            stdin: "pipe",
          }).exited
        }
        binary = BunProc.which()
        args.push("run", js)
      }
      args.push("--stdio")
      const proc = spawn(binary, args, {
        cwd: root,
        env: {
          ...process.env,
          BUN_BE_BUN: "1",
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
      const prisma = Bun.which("prisma")
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
      const dart = Bun.which("dart")
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
      const bin = Bun.which("ocamllsp")
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
    root: async () => Instance.directory,
    async spawn(root) {
      let binary = Bun.which("bash-language-server")
      const args: string[] = []
      if (!binary) {
        const js = path.join(Global.Path.bin, "node_modules", "bash-language-server", "out", "cli.js")
        if (!(await Bun.file(js).exists())) {
          if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
          await Bun.spawn([BunProc.which(), "install", "bash-language-server"], {
            cwd: Global.Path.bin,
            env: {
              ...process.env,
              BUN_BE_BUN: "1",
            },
            stdout: "pipe",
            stderr: "pipe",
            stdin: "pipe",
          }).exited
        }
        binary = BunProc.which()
        args.push("run", js)
      }
      args.push("start")
      const proc = spawn(binary, args, {
        cwd: root,
        env: {
          ...process.env,
          BUN_BE_BUN: "1",
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
      let bin = Bun.which("terraform-ls", {
        PATH: process.env["PATH"] + path.delimiter + Global.Path.bin,
      })

      if (!bin) {
        if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
        log.info("downloading terraform-ls from GitHub releases")

        const releaseResponse = await fetch("https://api.github.com/repos/hashicorp/terraform-ls/releases/latest")
        if (!releaseResponse.ok) {
          log.error("Failed to fetch terraform-ls release info")
          return
        }

        const release = (await releaseResponse.json()) as {
          tag_name?: string
          assets?: { name?: string; browser_download_url?: string }[]
        }
        const version = release.tag_name?.replace("v", "")
        if (!version) {
          log.error("terraform-ls release did not include a version tag")
          return
        }

        const platform = process.platform
        const arch = process.arch

        const tfArch = arch === "arm64" ? "arm64" : "amd64"
        const tfPlatform = platform === "win32" ? "windows" : platform

        const assetName = `terraform-ls_${version}_${tfPlatform}_${tfArch}.zip`

        const assets = release.assets ?? []
        const asset = assets.find((a) => a.name === assetName)
        if (!asset?.browser_download_url) {
          log.error(`Could not find asset ${assetName} in terraform-ls release`)
          return
        }

        const downloadResponse = await fetch(asset.browser_download_url)
        if (!downloadResponse.ok) {
          log.error("Failed to download terraform-ls")
          return
        }

        const tempPath = path.join(Global.Path.bin, assetName)
        await Bun.file(tempPath).write(downloadResponse)

        const ok = await Archive.extractZip(tempPath, Global.Path.bin)
          .then(() => true)
          .catch((error) => {
            log.error("Failed to extract terraform-ls archive", { error })
            return false
          })
        if (!ok) return
        await fs.rm(tempPath, { force: true })

        bin = path.join(Global.Path.bin, "terraform-ls" + (platform === "win32" ? ".exe" : ""))

        if (!(await Bun.file(bin).exists())) {
          log.error("Failed to extract terraform-ls binary")
          return
        }

        if (platform !== "win32") {
          await $`chmod +x ${bin}`.quiet().nothrow()
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
      let bin = Bun.which("texlab", {
        PATH: process.env["PATH"] + path.delimiter + Global.Path.bin,
      })

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
        await Bun.file(tempPath).write(downloadResponse)

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
          await $`tar -xzf ${tempPath}`.cwd(Global.Path.bin).quiet().nothrow()
        }

        await fs.rm(tempPath, { force: true })

        bin = path.join(Global.Path.bin, "texlab" + (platform === "win32" ? ".exe" : ""))

        if (!(await Bun.file(bin).exists())) {
          log.error("Failed to extract texlab binary")
          return
        }

        if (platform !== "win32") {
          await $`chmod +x ${bin}`.quiet().nothrow()
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
    root: async () => Instance.directory,
    async spawn(root) {
      let binary = Bun.which("docker-langserver")
      const args: string[] = []
      if (!binary) {
        const js = path.join(Global.Path.bin, "node_modules", "dockerfile-language-server-nodejs", "lib", "server.js")
        if (!(await Bun.file(js).exists())) {
          if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
          await Bun.spawn([BunProc.which(), "install", "dockerfile-language-server-nodejs"], {
            cwd: Global.Path.bin,
            env: {
              ...process.env,
              BUN_BE_BUN: "1",
            },
            stdout: "pipe",
            stderr: "pipe",
            stdin: "pipe",
          }).exited
        }
        binary = BunProc.which()
        args.push("run", js)
      }
      args.push("--stdio")
      const proc = spawn(binary, args, {
        cwd: root,
        env: {
          ...process.env,
          BUN_BE_BUN: "1",
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
      const gleam = Bun.which("gleam")
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
      let bin = Bun.which("clojure-lsp")
      if (!bin && process.platform === "win32") {
        bin = Bun.which("clojure-lsp.exe")
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
    root: async (file) => {
      // First, look for flake.nix - the most reliable Nix project root indicator
      const flakeRoot = await NearestRoot(["flake.nix"])(file)
      if (flakeRoot && flakeRoot !== Instance.directory) return flakeRoot

      // If no flake.nix, fall back to git repository root
      if (Instance.worktree && Instance.worktree !== Instance.directory) return Instance.worktree

      // Finally, use the instance directory as fallback
      return Instance.directory
    },
    async spawn(root) {
      const nixd = Bun.which("nixd")
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
      let bin = Bun.which("tinymist", {
        PATH: process.env["PATH"] + path.delimiter + Global.Path.bin,
      })

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
        await Bun.file(tempPath).write(downloadResponse)

        if (ext === "zip") {
          const ok = await Archive.extractZip(tempPath, Global.Path.bin)
            .then(() => true)
            .catch((error) => {
              log.error("Failed to extract tinymist archive", { error })
              return false
            })
          if (!ok) return
        } else {
          await $`tar -xzf ${tempPath} --strip-components=1`.cwd(Global.Path.bin).quiet().nothrow()
        }

        await fs.rm(tempPath, { force: true })

        bin = path.join(Global.Path.bin, "tinymist" + (platform === "win32" ? ".exe" : ""))

        if (!(await Bun.file(bin).exists())) {
          log.error("Failed to extract tinymist binary")
          return
        }

        if (platform !== "win32") {
          await $`chmod +x ${bin}`.quiet().nothrow()
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
      const bin = Bun.which("haskell-language-server-wrapper")
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
}
