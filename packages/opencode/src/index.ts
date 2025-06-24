import "zod-openapi/extend"
import { App } from "./app/app"
import { Server } from "./server/server"
import fs from "fs/promises"
import path from "path"
import { Share } from "./share/share"
import url from "node:url"
import { Global } from "./global"
import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { RunCommand } from "./cli/cmd/run"
import { GenerateCommand } from "./cli/cmd/generate"
import { ScrapCommand } from "./cli/cmd/scrap"
import { Log } from "./util/log"
import { AuthCommand, AuthLoginCommand } from "./cli/cmd/auth"
import { UpgradeCommand } from "./cli/cmd/upgrade"
import { Provider } from "./provider/provider"
import { UI } from "./cli/ui"
import { Installation } from "./installation"
import { Bus } from "./bus"
import { Config } from "./config/config"
import { NamedError } from "./util/error"
import { FormatError } from "./cli/error"

const cancel = new AbortController()

const cli = yargs(hideBin(process.argv))
  .scriptName("opencode")
  .help("help", "show help")
  .alias("help", "h")
  .version("version", "show version number", Installation.VERSION)
  .alias("version", "v")
  .option("print-logs", {
    describe: "print logs to stderr",
    type: "boolean",
  })
  .middleware(async () => {
    await Log.init({ print: process.argv.includes("--print-logs") })
    Log.Default.info("opencode", {
      version: Installation.VERSION,
      args: process.argv.slice(2),
    })
  })
  .usage("\n" + UI.logo())
  .command({
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
        process.chdir(cwd)
        const result = await App.provide({ cwd }, async (app) => {
          const providers = await Provider.list()
          if (Object.keys(providers).length === 0) {
            return "needs_provider"
          }

          await Share.init()
          const server = Server.listen()

          let cmd = ["go", "run", "./main.go"]
          let cwd = url.fileURLToPath(new URL("../../tui/cmd/opencode", import.meta.url))
          if (Bun.embeddedFiles.length > 0) {
            const blob = Bun.embeddedFiles[0] as File
            const binary = path.join(Global.Path.cache, "tui", blob.name)
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
            signal: cancel.signal,
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
          UI.empty()
          await AuthLoginCommand.handler(args)
        }
      }
    },
  })
  .command(RunCommand)
  .command(GenerateCommand)
  .command(ScrapCommand)
  .command(AuthCommand)
  .command(UpgradeCommand)
  .fail((msg) => {
    if (
      msg.startsWith("Unknown argument") ||
      msg.startsWith("Not enough non-option arguments")
    ) {
      cli.showHelp("log")
    }
  })
  .strict()

try {
  await cli.parse()
} catch (e) {
  const data: Record<string, any> = {}
  if (e instanceof NamedError) {
    const obj = e.toObject()
    Object.assign(data, {
      ...obj.data,
    })
  }
  if (e instanceof Error) {
    Object.assign(data, {
      name: e.name,
      message: e.message,
      cause: e.cause?.toString(),
    })
  }
  Log.Default.error("fatal", data)
  const formatted = FormatError(e)
  if (formatted) UI.error(formatted)
  if (!formatted)
    UI.error(
      "Unexpected error, check log file at " + Log.file() + " for more details",
    )
}

cancel.abort()
