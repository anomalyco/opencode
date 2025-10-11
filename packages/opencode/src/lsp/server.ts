import { spawn, type ChildProcessWithoutNullStreams } from "child_process"
import path from "path"
import os from "os"
import { Global } from "../global"
import { Log } from "../util/log"
import { BunProc } from "../bun"
import { $ } from "bun"
import fs from "fs/promises"
import { Filesystem } from "../util/filesystem"
import { Instance } from "../project/instance"
import { Flag } from "../flag/flag"

export namespace LSPServer {
  const log = Log.create({ service: "lsp.server" })

  export interface Handle {
    process: ChildProcessWithoutNullStreams
    initialization?: Record<string, any>
  }

  type RootFunction = (file: string) => Promise<string | undefined>

  const NearestRoot = (patterns: string[]): RootFunction => {
    return async (file) => {
      const files = Filesystem.up({
        targets: patterns,
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

  export const Typescript: Info = {
    id: "typescript",
    root: NearestRoot(["package-lock.json", "bun.lockb", "bun.lock", "pnpm-lock.yaml", "yarn.lock"]),
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"],
    async spawn(root) {
      const tsserver = await Bun.resolve("typescript/lib/tsserver.js", Instance.directory).catch(() => {})
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

        await $`unzip -o -q ${zipPath}`.quiet().cwd(Global.Path.bin).nothrow()
        await fs.rm(zipPath, { force: true })

        const extractedPath = path.join(Global.Path.bin, "vscode-eslint-main")
        const finalPath = path.join(Global.Path.bin, "vscode-eslint")

        const stats = await fs.stat(finalPath).catch(() => undefined)
        if (stats) {
          log.info("removing old eslint installation", { path: finalPath })
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
    id: "gopls",
    root: async (file) => {
      const work = await NearestRoot(["go.work"])(file)
      if (work) return work
      return NearestRoot(["go.mod", "go.sum"])(file)
    },
    extensions: [".go"],
    async spawn(root) {
      let bin = Bun.which("gopls", {
        PATH: process.env["PATH"] + ":" + Global.Path.bin,
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

  export const RubyLsp: Info = {
    id: "ruby-lsp",
    root: NearestRoot(["Gemfile"]),
    extensions: [".rb", ".rake", ".gemspec", ".ru"],
    async spawn(root) {
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
        if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
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
          process.platform === "win32" ? "language_server.bar" : "language_server.sh",
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

          await $`unzip -o -q ${zipPath}`.quiet().cwd(Global.Path.bin).nothrow()

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
        PATH: process.env["PATH"] + ":" + Global.Path.bin,
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
          await $`unzip -o -q ${tempPath}`.quiet().cwd(Global.Path.bin).nothrow()
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
    async spawn(root) {
      let bin = Bun.which("csharp-ls", {
        PATH: process.env["PATH"] + ":" + Global.Path.bin,
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
      let bin = Bun.which("clangd", {
        PATH: process.env["PATH"] + ":" + Global.Path.bin,
      })
      if (!bin) {
        if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
        log.info("downloading clangd from GitHub releases")

        const releaseResponse = await fetch("https://api.github.com/repos/clangd/clangd/releases/latest")
        if (!releaseResponse.ok) {
          log.error("Failed to fetch clangd release info")
          return
        }

        const release = await releaseResponse.json()

        const platform = process.platform
        let assetName = ""

        if (platform === "darwin") {
          assetName = "clangd-mac-"
        } else if (platform === "linux") {
          assetName = "clangd-linux-"
        } else if (platform === "win32") {
          assetName = "clangd-windows-"
        } else {
          log.error(`Platform ${platform} is not supported by clangd auto-download`)
          return
        }

        assetName += release.tag_name + ".zip"

        const asset = release.assets.find((a: any) => a.name === assetName)
        if (!asset) {
          log.error(`Could not find asset ${assetName} in latest clangd release`)
          return
        }

        const downloadUrl = asset.browser_download_url
        const downloadResponse = await fetch(downloadUrl)
        if (!downloadResponse.ok) {
          log.error("Failed to download clangd")
          return
        }

        const zipPath = path.join(Global.Path.bin, "clangd.zip")
        await Bun.file(zipPath).write(downloadResponse)

        await $`unzip -o -q ${zipPath}`.quiet().cwd(Global.Path.bin).nothrow()
        await fs.rm(zipPath, { force: true })

        const extractedDir = path.join(Global.Path.bin, assetName.replace(".zip", ""))
        bin = path.join(extractedDir, "bin", "clangd" + (platform === "win32" ? ".exe" : ""))

        if (!(await Bun.file(bin).exists())) {
          log.error("Failed to extract clangd binary")
          return
        }

        if (platform !== "win32") {
          await $`chmod +x ${bin}`.nothrow()
        }

        log.info(`installed clangd`, { bin })
      }

      return {
        process: spawn(bin, ["--background-index", "--clang-tidy"], {
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
      const installed = await fs.exists(launcherDir)
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
      if (!(await fs.exists(launcherJar))) {
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
              return "config_windows"
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
}
