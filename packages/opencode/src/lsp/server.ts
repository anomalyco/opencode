import { spawn, type ChildProcessWithoutNullStreams } from "child_process"
import type { App } from "../app/app"
import path from "path"
import { Global } from "../global"
import { Log } from "../util/log"
import { BunProc } from "../bun"
import { $ } from "bun"
import fs from "fs/promises"
import { unique } from "remeda"
import { Ripgrep } from "../file/ripgrep"
import type { LSPClient } from "./client"
import { withTimeout } from "../util/timeout"

export namespace LSPServer {
  const log = Log.create({ service: "lsp.server" })

  export interface Handle {
    process: ChildProcessWithoutNullStreams
    initialization?: Record<string, any>
    onInitialized?: (lsp: LSPClient.Info) => Promise<void>
  }

  type RootsFunction = (app: App.Info) => Promise<string[]>

  const SimpleRoots = (patterns: string[]): RootsFunction => {
    return async (app) => {
      const glob = `**/*/{${patterns.join(",")}}`
      const files = await Ripgrep.files({
        glob: [glob],
        cwd: app.path.root,
      })
      const dirs = files.map((file) => path.dirname(file))
      return unique(dirs).map((dir) => path.join(app.path.root, dir))
    }
  }

  export interface Info {
    id: string
    extensions: string[]
    global?: boolean
    roots: (app: App.Info) => Promise<string[]>
    spawn(app: App.Info, root: string): Promise<Handle | undefined>
  }

  export const Typescript: Info = {
    id: "typescript",
    roots: async (app) => [app.path.root],
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
        // tsserver sucks and won't start processing codebase until you open a file
        onInitialized: async (lsp) => {
          const [hint] = await Ripgrep.files({
            cwd: lsp.root,
            glob: ["*.ts", "*.tsx", "*.js", "*.jsx", "*.mjs", "*.cjs", "*.mts", "*.cts"],
            limit: 1,
          })
          const wait = new Promise<void>(async (resolve) => {
            const notif = lsp.connection.onNotification("$/progress", (params) => {
              if (params.value.kind !== "end") return
              notif.dispose()
              resolve()
            })
            await lsp.notify.open({ path: path.join(lsp.root, hint) })
          })
          await withTimeout(wait, 5_000)
        },
      }
    },
  }

  export const Gopls: Info = {
    id: "golang",
    roots: SimpleRoots(["go.mod", "go.sum"]),
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
    roots: SimpleRoots(["Gemfile"]),
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
    roots: SimpleRoots([
      "pyproject.toml",
      "setup.py",
      "setup.cfg",
      "requirements.txt",
      "Pipfile",
      "pyrightconfig.json",
    ]),
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
    roots: SimpleRoots(["mix.exs", "mix.lock"]),
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
}
