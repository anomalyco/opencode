/**
 * 桌面端 sidecar 入口：仅启动 HTTP serve，不加载 TUI/React 依赖。
 */
import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { drizzle } from "drizzle-orm/bun-sqlite"
import path from "path"
import { EOL } from "os"
import { ServeCommand } from "./cli/cmd/serve"
import { FormatError } from "./cli/error"
import { Heap } from "./cli/heap"
import { UI } from "./cli/ui"
import { Installation } from "./installation"
import { InstallationVersion } from "@yunpat/core/installation/version"
import { NamedError } from "@yunpat/core/util/error"
import * as Log from "@yunpat/core/util/log"
import { Global } from "@yunpat/core/global"
import { ensureProcessMetadata } from "@yunpat/core/util/opencode-process"
import { Database } from "@/storage/db"
import { JsonMigration } from "@/storage/json-migration"
import { Filesystem } from "@/util/filesystem"
import { errorMessage } from "./util/error"

const processMetadata = ensureProcessMetadata("desktop-serve")

process.on("unhandledRejection", (e) => {
  Log.Default.error("rejection", { e: errorMessage(e) })
})

process.on("uncaughtException", (e) => {
  Log.Default.error("exception", { e: errorMessage(e) })
})

const args = hideBin(process.argv)

const cli = yargs(args)
  .parserConfiguration({ "populate--": true })
  .scriptName("yunpat-serve")
  .wrap(100)
  .help("help", "show help")
  .alias("help", "h")
  .version("version", "show version number", InstallationVersion)
  .alias("version", "v")
  .option("print-logs", { describe: "print logs to stderr", type: "boolean" })
  .option("log-level", {
    describe: "log level",
    type: "string",
    choices: ["DEBUG", "INFO", "WARN", "ERROR"],
  })
  .middleware(async (opts) => {
    await Log.init({
      print: process.argv.includes("--print-logs"),
      dev: Installation.isLocal(),
      level: (() => {
        if (opts.logLevel) return opts.logLevel as Log.Level
        if (Installation.isLocal()) return "DEBUG"
        return "INFO"
      })(),
    })

    Heap.start()

    process.env.AGENT = "1"
    process.env.OPENCODE = "1"
    process.env.OPENCODE_PID = String(process.pid)

    Log.Default.info("yunpat-serve", {
      version: InstallationVersion,
      args: process.argv.slice(2),
      process_role: processMetadata.processRole,
      run_id: processMetadata.runID,
    })

    const marker = path.join(Global.Path.data, "opencode.db")
    if (!(await Filesystem.exists(marker))) {
      process.stderr.write("Performing one time database migration, may take a few minutes..." + EOL)
      await JsonMigration.run(drizzle({ client: Database.Client().$client }), {
        progress: (event) => {
          const percent = Math.floor((event.current / event.total) * 100)
          process.stderr.write(`sqlite-migration:${percent}${EOL}`)
        },
      })
      process.stderr.write("Database migration complete." + EOL)
    }
  })
  .usage("")
  .command(ServeCommand)
  .fail((msg, err) => {
    if (
      msg?.startsWith("Unknown argument") ||
      msg?.startsWith("Not enough non-option arguments") ||
      msg?.startsWith("Invalid values:")
    ) {
      if (err) throw err
      cli.showHelp((err2, _argv, out) => {
        if (err2) throw err2
        if (out) process.stderr.write(out)
      })
    }
    if (err) throw err
    process.exit(1)
  })
  .strict()

try {
  await cli.parse()
} catch (e) {
  Log.Default.error("fatal", { message: errorMessage(e) })
  const formatted = FormatError(e)
  if (formatted) UI.error(formatted)
  if (!formatted) process.stderr.write(errorMessage(e) + EOL)
  process.exitCode = 1
} finally {
  process.exit()
}
