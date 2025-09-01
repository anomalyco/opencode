import { Global } from "../../global"
import { Provider } from "../../provider/provider"
import { Server } from "../../server/server"
import { bootstrap } from "../bootstrap"
import { UI } from "../ui"
import { cmd } from "./cmd"
import path from "path"
import fs from "fs/promises"
import { Installation } from "../../installation"
import { Config } from "../../config/config"
import { Bus } from "../../bus"
import { Log } from "../../util/log"
import { FileWatcher } from "../../file/watch"
import { Ide } from "../../ide"
import { Auth } from "../../auth"

import { Flag } from "../../flag/flag"
import { Session } from "../../session"
import { Instance } from "../../project/instance"
import { ModelsDev } from "../../provider/models"

declare global {
  const OPENCODE_TUI_PATH: string
}

if (typeof OPENCODE_TUI_PATH !== "undefined") {
  await import(OPENCODE_TUI_PATH as string, {
    with: { type: "file" },
  })
}

export const TuiCommand = cmd({
  command: "$0 [project]",
  describe: "start opencode tui",
  builder: (yargs) =>
    yargs
      .positional("project", {
        type: "string",
        describe: "path to start opencode in",
      })
      .option("docker", {
        type: "boolean",
        describe: "run server in docker with current dir mounted",
      })
      .option("docker-image", {
        type: "string",
        describe: "docker image for server",
        default: "opencodeai/opencode:server",
        alias: ["dockerImage"],
      })
      .option("dockerfile", {
        type: "string",
        describe: "path to a local Dockerfile to build before running",
      })
      .option("docker-context", {
        type: "string",
        describe: "docker build context directory (defaults to Dockerfile's dir)",
        alias: ["dockerContext"],
      })
      .option("docker-build", {
        type: "boolean",
        describe: "force build the docker image before running",
        alias: ["dockerBuild"],
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to use in the format of provider/model",
      })
      .option("continue", {
        alias: ["c"],
        describe: "continue the last session",
        type: "boolean",
      })
      .option("session", {
        alias: ["s"],
        describe: "session id to continue",
        type: "string",
      })
      .option("prompt", {
        alias: ["p"],
        type: "string",
        describe: "prompt to use",
      })
      .option("agent", {
        type: "string",
        describe: "agent to use",
      })
      .option("port", {
        type: "number",
        describe: "port to listen on",
        default: 0,
      })
      .option("hostname", {
        alias: ["h"],
        type: "string",
        describe: "hostname to listen on",
        default: "127.0.0.1",
      }),
  handler: async (args) => {
    while (true) {
      const cwd = args.project ? path.resolve(args.project) : process.cwd()
      try {
        process.chdir(cwd)
      } catch (e) {
        UI.error("Failed to change directory to " + cwd)
        return
      }
      const result = await bootstrap(cwd, async () => {
        const sessionID = await (async () => {
          if (args.continue) {
            const it = Session.list()
            try {
              for await (const s of it) {
                if (s.parentID === undefined) {
                  return s.id
                }
              }
              return
            } finally {
              await it.return()
            }
          }
          if (args.session) {
            return args.session
          }
          return undefined
        })()
        FileWatcher.init()
        const providers = await Provider.list()
        if (Object.keys(providers).length === 0) {
          return "needs_provider"
        }
        const cfg = await Config.get()
<<<<<<< HEAD
        const useDocker = (args.docker ?? (cfg.server?.docker === true)) === true

        const server = await (async () => {
          if (!useDocker) {
=======
        const docker = (args.docker ?? (cfg.server?.docker === true)) === true

        const server = await (async () => {
          if (!docker) {
>>>>>>> 31983999 (feat(config): add server.docker (and image) to auto-use Docker server for TUI when enabled; update TUI to honor config)
            return Server.listen({ port: args.port, hostname: args.hostname })
          }

          const dockerBin = Bun.which("docker")
          if (!dockerBin) {
            UI.error("docker not found, starting server locally")
            return Server.listen({ port: args.port, hostname: args.hostname })
          }

          const df = (args as { dockerfile?: string }).dockerfile
          const needBuild = !!df || (args as { dockerBuild?: boolean }).dockerBuild === true
          const img = await (async () => {
            const defaultImg = "opencodeai/opencode:server"
            const configured = cfg.server?.image
            if (!needBuild) return (args as { dockerImage?: string }).dockerImage ?? configured ?? defaultImg
            const f = df ?? "Dockerfile"
            const ctx = (args as { dockerContext?: string }).dockerContext ?? path.dirname(path.resolve(f))
            const base = (args as { dockerImage?: string }).dockerImage ?? configured ?? defaultImg
            const tag = base === defaultImg ? "opencode:local" : base
            const b = Bun.spawn({ cmd: [dockerBin, "build", "-t", tag, "-f", f, ctx], stdout: "inherit", stderr: "inherit" })
            const code = await b.exited
            if (code !== 0) {
              UI.error("docker build failed, starting server locally")
              return base
            }
            return tag
          })()

          const alloc = () => {
            const s = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("ok") })
            const p = s.port
            s.stop()
            return p
          }

          const port = args.port && args.port > 0 ? args.port : alloc()
          const host = "127.0.0.1"
          const cport = 8080
          const vol = process.cwd() + ":/workspace"
          const db = await ModelsDev.get()
          const envlist: string[] = []
          for (const p of Object.values(db)) {
            for (const k of p.env) {
              const v = process.env[k]
              if (v) envlist.push(`${k}=${v}`)
            }
          }

          const cmd = [
            dockerBin,
            "run",
            "--rm",
            "-d",
            "-p",
            `${port}:${cport}`,
            "-v",
            vol,
            "-w",
            "/workspace",
            ...envlist.flatMap((e) => ["-e", e]),
            img,
            "bun",
            "run",
            "/app/src/index.ts",
            "serve",
            "--hostname",
            "0.0.0.0",
            "--port",
            String(cport),
          ]

          const proc = Bun.spawn({ cmd, stdout: "pipe", stderr: "pipe" })
          const code = await proc.exited
          const id = await new Response(proc.stdout).text().then((x) => x.trim())
          if (code !== 0 || !id) {
            UI.error("failed to start docker server, starting locally")
            return Server.listen({ port: args.port, hostname: args.hostname })
          }

          const url = new URL("http://" + host + ":" + String(port))
          const until = Date.now() + 20_000
          while (Date.now() < until) {
            const ok = await fetch(new URL("/doc", url)).then((r) => r.ok).catch(() => false)
            if (ok) break
            await Bun.sleep(200)
          }

          return {
            hostname: host,
            port,
            url,
            stop: async () => {
<<<<<<< HEAD
              const stop = Bun.spawn({ cmd: [dockerBin, "stop", id], stdout: "ignore", stderr: "inherit" })
              await stop.exited
            },
=======
            const stop = Bun.spawn({ cmd: [dockerBin, "stop", id], stdout: "ignore", stderr: "inherit" })
            await stop.exited
          },
>>>>>>> 31983999 (feat(config): add server.docker (and image) to auto-use Docker server for TUI when enabled; update TUI to honor config)
          }
        })()

        let cmd = ["go", "run", "./main.go"]
        let cwd = Bun.fileURLToPath(new URL("../../../../tui/cmd/opencode", import.meta.url))
        const tui = Bun.embeddedFiles.find((item) => (item as File).name.includes("tui")) as File
        if (tui) {
          let binaryName = tui.name
          if (process.platform === "win32" && !binaryName.endsWith(".exe")) {
            binaryName += ".exe"
          }
          const binary = path.join(Global.Path.cache, "tui", binaryName)
          const file = Bun.file(binary)
          if (!(await file.exists())) {
            await Bun.write(file, tui, { mode: 0o755 })
            await fs.chmod(binary, 0o755)
          }
          cwd = process.cwd()
          cmd = [binary]
        }
        Log.Default.info("tui", {
          cmd,
        })
<<<<<<< HEAD
        if (useDocker) {
=======
        if (docker) {
>>>>>>> 31983999 (feat(config): add server.docker (and image) to auto-use Docker server for TUI when enabled; update TUI to honor config)
          const auth = await Auth.all()
          await Promise.all(
            Object.entries(auth).map(([id, info]) =>
              fetch(new URL("/auth/" + encodeURIComponent(id), server.url), {
                method: "PUT",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(info),
              }).catch(() => {}),
            ),
          )
        }

        const proc = Bun.spawn({
          cmd: [
            ...cmd,
            ...(args.model ? ["--model", args.model] : []),
            ...(args.prompt ? ["--prompt", args.prompt] : []),
            ...(args.agent ? ["--agent", args.agent] : []),
            ...(sessionID ? ["--session", sessionID] : []),
          ],
          cwd,
          stdout: "inherit",
          stderr: "inherit",
          stdin: "inherit",
          env: {
            ...process.env,
            CGO_ENABLED: "0",
            OPENCODE_SERVER: server.url.toString(),
            OPENCODE_PROJECT: JSON.stringify(Instance.project),
          },
          onExit: () => {
            server.stop()
          },
        })

        ;(async () => {
          if (Installation.isDev()) return
          if (Installation.isSnapshot()) return
          const config = await Config.global()
          if (config.autoupdate === false || Flag.OPENCODE_DISABLE_AUTOUPDATE) return
          const latest = await Installation.latest().catch(() => {})
          if (!latest) return
          if (Installation.VERSION === latest) return
          const method = await Installation.method()
          if (method === "unknown") return
          await Installation.upgrade(method, latest)
            .then(() => Bus.publish(Installation.Event.Updated, { version: latest }))
            .catch(() => {})
        })()
        ;(async () => {
          if (Ide.alreadyInstalled()) return
          const ide = Ide.ide()
          if (ide === "unknown") return
          await Ide.install(ide)
            .then(() => Bus.publish(Ide.Event.Installed, { ide }))
            .catch(() => {})
        })()

        await proc.exited
        server.stop()

        return "done"
      })
      if (result === "done") break
      if (result === "needs_provider") {
        UI.empty()
        UI.println(UI.logo("   "))
        const result = await Bun.spawn({
          cmd: [...getOpencodeCommand(), "auth", "login"],
          cwd: process.cwd(),
          stdout: "inherit",
          stderr: "inherit",
          stdin: "inherit",
        }).exited
        if (result !== 0) return
        UI.empty()
      }
    }
  },
})

/**
 * Get the correct command to run opencode CLI
 * In development: ["bun", "run", "packages/opencode/src/index.ts"]
 * In production: ["/path/to/opencode"]
 */
function getOpencodeCommand(): string[] {
  // Check if OPENCODE_BIN_PATH is set (used by shell wrapper scripts)
  if (process.env["OPENCODE_BIN_PATH"]) {
    return [process.env["OPENCODE_BIN_PATH"]]
  }

  const execPath = process.execPath.toLowerCase()

  if (Installation.isDev()) {
    // In development, use bun to run the TypeScript entry point
    return [execPath, "run", process.argv[1]]
  }

  // In production, use the current executable path
  return [process.execPath]
}
