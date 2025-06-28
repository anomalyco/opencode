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

export const TuiCommand = cmd({
  command: "$0 [project]",
  describe: "start opencode tui",
  builder: (yargs) =>
    yargs.positional("project", {
      type: "string",
      describe: "path to start opencode in",
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
      const result = await bootstrap({ cwd }, async (app) => {
        const providers = await Provider.list()
        if (Object.keys(providers).length === 0) {
          return "needs_provider"
        }

        const server = Server.listen({
          port: 0,
          hostname: "127.0.0.1",
        })

        let cmd = ["go", "run", "./main.go"]
        let cwd = Bun.fileURLToPath(
          new URL("../../../../tui/cmd/opencode", import.meta.url),
        )
        if (Bun.embeddedFiles.length > 0) {
          const blob = Bun.embeddedFiles[0] as File
          let binaryName = blob.name
          if (process.platform === "win32" && !binaryName.endsWith(".exe")) {
            binaryName += ".exe"
          }
          const binary = path.join(Global.Path.cache, "tui", binaryName)
          const file = Bun.file(binary)
          if (!(await file.exists())) {
            await Bun.write(file, blob, { mode: 0o755 })
            await fs.chmod(binary, 0o755)
          }
          cwd = process.cwd()
          cmd = [binary]
        }
        const proc = Bun.spawn({
          cmd: [...cmd, ...process.argv.slice(2)],
          cwd,
          stdout: "inherit",
          stderr: "inherit",
          stdin: "inherit",
          env: {
            ...process.env,
            OPENCODE_SERVER: server.url.toString(),
            OPENCODE_APP_INFO: JSON.stringify(app),
          },
          onExit: () => {
            server.stop()
          },
        })

        ;(async () => {
          if (Installation.VERSION === "dev") return
          if (Installation.isSnapshot()) return
          const config = await Config.global()
          if (config.autoupdate === false) return
          const latest = await Installation.latest().catch(() => {})
          if (!latest) return
          if (Installation.VERSION === latest) return
          const method = await Installation.method()
          if (method === "unknown") return
          await Installation.upgrade(method, latest)
            .then(() => {
              Bus.publish(Installation.Event.Updated, { version: latest })
            })
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
          cmd: [process.execPath, "auth", "login"],
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
