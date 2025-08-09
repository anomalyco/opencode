import { spawn, type ChildProcessWithoutNullStreams } from "child_process"
import type { App } from "../app/app"
import path from "path"
import { Global } from "../global"
import { Log } from "../util/log"
import { BunProc } from "../bun"
import { $ } from "bun"
import fs from "fs/promises"
import { Filesystem } from "../util/filesystem"

export namespace LSPServer {
  const log = Log.create({ service: "lsp.server" })

  export interface Handle {
    process: ChildProcessWithoutNullStreams
    initialization?: Record<string, any>
  }

  type RootFunction = (file: string, app: App.Info) => Promise<string | undefined>

  const NearestRoot = (patterns: string[]): RootFunction => {
    return async (file, app) => {
      const files = Filesystem.up({
        targets: patterns,
        start: path.dirname(file),
        stop: app.path.root,
      })
      const first = await files.next()
      await files.return()
      if (!first.value) return app.path.root
      return path.dirname(first.value)
    }
  }

  export interface Info {
    id: string
    extensions: string[]
    global?: boolean
    root: RootFunction
    spawn(app: App.Info, root: string): Promise<Handle | undefined>
  }

  export const Typescript: Info = {
    id: "typescript",
    root: NearestRoot(["tsconfig.json", "package.json", "jsconfig.json"]),
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"],
    async spawn(app, root) {
      const tsserver = await Bun.resolve("typescript/lib/tsserver.js", app.path.cwd).catch(() => {})
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

  export const ESLint: Info = {
    id: "eslint",
    root: NearestRoot([
      "eslint.config.js",
      "eslint.config.mjs",
      "eslint.config.cjs",
      "eslint.config.ts",
      "eslint.config.mts",
      "eslint.config.cts",
      ".eslintrc.js",
      ".eslintrc.cjs",
      ".eslintrc.yaml",
      ".eslintrc.yml",
      ".eslintrc.json",
      "package.json",
    ]),
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"],
    async spawn(app, root) {
      const eslint = await Bun.resolve("eslint", app.path.cwd).catch(() => {})
      if (!eslint) return
      const serverPath = path.join(Global.Path.bin, "vscode-eslint", "server", "out", "eslintServer.js")
      if (!(await Bun.file(serverPath).exists())) {
        log.info("downloading and building VS Code ESLint server")
        const response = await fetch("https://github.com/microsoft/vscode-eslint/archive/refs/heads/main.zip")
        if (!response.ok) return

        const zipPath = path.join(Global.Path.bin, "vscode-eslint.zip")
        await Bun.file(zipPath).write(response)

        await $`unzip -o -q ${zipPath}`.cwd(Global.Path.bin).nothrow()
        await fs.rm(zipPath, { force: true })

        const extractedPath = path.join(Global.Path.bin, "vscode-eslint-main")
        const finalPath = path.join(Global.Path.bin, "vscode-eslint")

        if (await Bun.file(finalPath).exists()) {
          await fs.rm(finalPath, { force: true, recursive: true })
        }
        await fs.rename(extractedPath, finalPath)

        await $`npm install`.cwd(finalPath).quiet()
        await $`npm run compile`.cwd(finalPath).quiet()

        log.info("installed VS Code ESLint server", { serverPath })
      }

      const proc = spawn(BunProc.which(), ["--max-old-space-size=8192", serverPath, "--stdio"], {
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
    id: "golang",
    root: async (file, app) => {
      const work = await NearestRoot(["go.work"])(file, app)
      if (work) return work
      return NearestRoot(["go.mod", "go.sum"])(file, app)
    },
    extensions: [".go"],
    async spawn(_, root) {
      let bin = Bun.which("gopls", {
        PATH: process.env["PATH"] + ":" + Global.Path.bin,
      })
      if (!bin) {
        if (!Bun.which("go")) return
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

  export const RubyLsp: Info = {
    id: "ruby-lsp",
    root: NearestRoot(["Gemfile"]),
    extensions: [".rb", ".rake", ".gemspec", ".ru"],
    async spawn(_, root) {
      let bin = Bun.which("ruby-lsp", {
        PATH: process.env["PATH"] + ":" + Global.Path.bin,
      })
      if (!bin) {
        const ruby = Bun.which("ruby")
        const gem = Bun.which("gem")
        if (!ruby || !gem) {
          log.info("Ruby not found, please install Ruby first")
          return
        }
        log.info("installing ruby-lsp")
        const proc = Bun.spawn({
          cmd: ["gem", "install", "ruby-lsp", "--bindir", Global.Path.bin],
          stdout: "pipe",
          stderr: "pipe",
          stdin: "pipe",
        })
        const exit = await proc.exited
        if (exit !== 0) {
          log.error("Failed to install ruby-lsp")
          return
        }
        bin = path.join(Global.Path.bin, "ruby-lsp" + (process.platform === "win32" ? ".exe" : ""))
        log.info(`installed ruby-lsp`, {
          bin,
        })
      }
      return {
        process: spawn(bin!, ["--stdio"], {
          cwd: root,
        }),
      }
    },
  }

  export const Pyright: Info = {
    id: "pyright",
    extensions: [".py", ".pyi"],
    root: NearestRoot(["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "Pipfile", "pyrightconfig.json"]),
    async spawn(_, root) {
      const proc = spawn(BunProc.which(), ["x", "pyright-langserver", "--stdio"], {
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

  export const ElixirLS: Info = {
    id: "elixir-ls",
    extensions: [".ex", ".exs"],
    root: NearestRoot(["mix.exs", "mix.lock"]),
    async spawn(_, root) {
      let binary = Bun.which("elixir-ls")
      if (!binary) {
        const elixirLsPath = path.join(Global.Path.bin, "elixir-ls")
        binary = path.join(
          Global.Path.bin,
          "elixir-ls-master",
          "release",
          process.platform === "win32" ? "language_server.bar" : "language_server.sh",
        )

        if (!(await Bun.file(binary).exists())) {
          const elixir = Bun.which("elixir")
          if (!elixir) {
            log.error("elixir is required to run elixir-ls")
            return
          }

          log.info("downloading elixir-ls from GitHub releases")

          const response = await fetch("https://github.com/elixir-lsp/elixir-ls/archive/refs/heads/master.zip")
          if (!response.ok) return
          const zipPath = path.join(Global.Path.bin, "elixir-ls.zip")
          await Bun.file(zipPath).write(response)

          await $`unzip -o -q ${zipPath}`.cwd(Global.Path.bin).nothrow()

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
    async spawn(_, root) {
      let bin = Bun.which("zls", {
        PATH: process.env["PATH"] + ":" + Global.Path.bin,
      })

      if (!bin) {
        const zig = Bun.which("zig")
        if (!zig) {
          log.error("Zig is required to use zls. Please install Zig first.")
          return
        }

        log.info("downloading zls from GitHub releases")

        const releaseResponse = await fetch("https://api.github.com/repos/zigtools/zls/releases/latest")
        if (!releaseResponse.ok) {
          log.error("Failed to fetch zls release info")
          return
        }

        const release = await releaseResponse.json()

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
          await $`unzip -o -q ${tempPath}`.cwd(Global.Path.bin).nothrow()
        } else {
          await $`tar -xf ${tempPath}`.cwd(Global.Path.bin).nothrow()
        }

        await fs.rm(tempPath, { force: true })

        bin = path.join(Global.Path.bin, "zls" + (platform === "win32" ? ".exe" : ""))

        if (!(await Bun.file(bin).exists())) {
          log.error("Failed to extract zls binary")
          return
        }

        if (platform !== "win32") {
          await $`chmod +x ${bin}`.nothrow()
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
    async spawn(_, root) {
      let bin = Bun.which("csharp-ls", {
        PATH: process.env["PATH"] + ":" + Global.Path.bin,
      })
      if (!bin) {
        if (!Bun.which("dotnet")) {
          log.error(".NET SDK is required to install csharp-ls")
          return
        }

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
}
