import { spawn, type ChildProcessWithoutNullStreams } from "child_process"
import type { App } from "../app/app"
import path from "path"
import { Global } from "../global"
import { Log } from "../util/log"
import { BunProc } from "../bun"
import { $ } from "bun"
import fs from "fs/promises"

export namespace LSPServer {
  const log = Log.create({ service: "lsp.server" })

  export interface Handle {
    process: ChildProcessWithoutNullStreams
    initialization?: Record<string, any>
  }

  export interface Info {
    id: string
    extensions: string[]
    spawn(app: App.Info): Promise<Handle | undefined>
  }

  export const Typescript: Info = {
    id: "typescript",
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"],
    async spawn(app) {
      const tsserver = await Bun.resolve("typescript/lib/tsserver.js", app.path.cwd).catch(() => {})
      if (!tsserver) return
      const proc = spawn(BunProc.which(), ["x", "typescript-language-server", "--stdio"], {
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

  export const Gopls: Info = {
    id: "golang",
    extensions: [".go"],
    async spawn() {
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
        process: spawn(bin!),
      }
    },
  }

  export const RubyLsp: Info = {
    id: "ruby-lsp",
    extensions: [".rb", ".rake", ".gemspec", ".ru"],
    async spawn() {
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
        process: spawn(bin!, ["--stdio"]),
      }
    },
  }

  export const Pyright: Info = {
    id: "pyright",
    extensions: [".py", ".pyi"],
    async spawn() {
      const proc = spawn(BunProc.which(), ["x", "pyright-langserver", "--stdio"], {
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
    async spawn() {
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
        process: spawn(binary),
      }
    },
  }

  export const Zls: Info = {
    id: "zls",
    extensions: [".zig", ".zon"],
    async spawn() {
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
          log.error("Unsupported platform/architecture for zls", { platform, arch, assetName })
          return
        }

        const asset = release.assets?.find((a: any) => a.name === assetName)

        if (!asset) {
          log.error("Could not find zls download for platform", { platform, arch, assetName })
          return
        }

        const downloadUrl = asset.browser_download_url
        log.info("downloading zls", { url: downloadUrl })

        const response = await fetch(downloadUrl)
        if (!response.ok) {
          log.error("Failed to download zls")
          return
        }

        const isZip = assetName.endsWith(".zip")
        const archivePath = path.join(Global.Path.bin, isZip ? "zls.zip" : "zls.tar.xz")
        await Bun.file(archivePath).write(response)

        if (isZip) {
          await $`unzip -o -q ${archivePath} -d ${Global.Path.bin}`.nothrow()
        } else {
          await $`tar -xf ${archivePath} -C ${Global.Path.bin}`.quiet()
        }

        await fs.rm(archivePath, { force: true })

        if (platform !== "win32") {
          bin = path.join(Global.Path.bin, "zls")
          await $`chmod +x ${bin}`.quiet()
        } else {
          bin = path.join(Global.Path.bin, "zls.exe")
        }

        log.info("installed zls", { bin })
      }

      return {
        process: spawn(bin!),
      }
    },
  }
}
