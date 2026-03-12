import type { Argv } from "yargs"
import { spawn } from "child_process"
import { Database } from "../../storage/db"
import { Database as BunDatabase } from "bun:sqlite"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { JsonMigration } from "../../storage/json-migration"
import { EOL, constants } from "os"

const QueryCommand = cmd({
  command: "$0 [query]",
  describe: "open an interactive sqlite3 shell or run a query",
  builder: (yargs: Argv) => {
    return yargs
      .positional("query", {
        type: "string",
        describe: "SQL query to execute",
      })
      .option("format", {
        type: "string",
        choices: ["json", "tsv"],
        default: "tsv",
        describe: "Output format",
      })
  },
  handler: async (args: { query?: string; format: string }) => {
    const query = args.query
    if (query) {
      const db = new BunDatabase(Database.Path, { readonly: true })
      try {
        const result = db.query(query).all() as Record<string, unknown>[]
        if (args.format === "json") {
          console.log(JSON.stringify(result, null, 2))
          return
        }
        if (result.length > 0) {
          const keys = Object.keys(result[0])
          console.log(keys.join("\t"))
          for (const row of result) {
            console.log(keys.map((k) => row[k]).join("\t"))
          }
        }
      } catch (err) {
        UI.error(err instanceof Error ? err.message : String(err))
        process.exit(1)
      } finally {
        db.close()
      }
      return
    }
    const child = spawn("sqlite3", [Database.Path], {
      stdio: "inherit",
    })

    const tty = process.stdin.isTTY
    const hups = process.listeners("SIGHUP")
    const noop = () => {}
    const int = tty ? noop : () => child.kill("SIGINT")
    const quit = tty ? noop : () => child.kill("SIGQUIT")
    const term = () => child.kill("SIGTERM")
    const hup = () => child.kill("SIGHUP")
    process.on("SIGINT", int)
    process.on("SIGQUIT", quit)
    process.on("SIGTERM", term)
    hups.forEach((fn) => process.off("SIGHUP", fn))
    process.on("SIGHUP", hup)

    const result = await new Promise<
      { kind: "error"; err: Error } | { kind: "close"; code: number | null; sig: NodeJS.Signals | null }
    >((resolve) => {
      child.once("error", (err) => resolve({ kind: "error", err }))
      child.once("close", (code, sig) => resolve({ kind: "close", code, sig }))
    }).finally(() => {
      process.off("SIGINT", int)
      process.off("SIGQUIT", quit)
      process.off("SIGTERM", term)
      process.off("SIGHUP", hup)
      hups.forEach((fn) => process.on("SIGHUP", fn))
    })

    if (result.kind === "error") {
      UI.error(`Failed to start sqlite3: ${result.err.message}`)
      process.exit(1)
    }

    if (result.sig) {
      const code = constants.signals[result.sig]
      if (result.sig === "SIGHUP") process.exit(code ? 128 + code : 1)
      setTimeout(() => process.exit(code ? 128 + code : 1), 50)
      process.kill(process.pid, result.sig)
      return
    }

    if (result.code != null && result.code !== 0) process.exit(result.code)
  },
})

const PathCommand = cmd({
  command: "path",
  describe: "print the database path",
  handler: () => {
    console.log(Database.Path)
  },
})

const MigrateCommand = cmd({
  command: "migrate",
  describe: "migrate JSON data to SQLite (merges with existing data)",
  handler: async () => {
    const sqlite = new BunDatabase(Database.Path)
    const tty = process.stderr.isTTY
    const width = 36
    const orange = "\x1b[38;5;214m"
    const muted = "\x1b[0;2m"
    const reset = "\x1b[0m"
    let last = -1
    if (tty) process.stderr.write("\x1b[?25l")
    try {
      const stats = await JsonMigration.run(sqlite, {
        progress: (event) => {
          const percent = Math.floor((event.current / event.total) * 100)
          if (percent === last) return
          last = percent
          if (tty) {
            const fill = Math.round((percent / 100) * width)
            const bar = `${"■".repeat(fill)}${"･".repeat(width - fill)}`
            process.stderr.write(
              `\r${orange}${bar} ${percent.toString().padStart(3)}%${reset} ${muted}${event.current}/${event.total}${reset} `,
            )
          } else {
            process.stderr.write(`sqlite-migration:${percent}${EOL}`)
          }
        },
      })
      if (tty) process.stderr.write("\n")
      if (tty) process.stderr.write("\x1b[?25h")
      else process.stderr.write(`sqlite-migration:done${EOL}`)
      UI.println(
        `Migration complete: ${stats.projects} projects, ${stats.sessions} sessions, ${stats.messages} messages`,
      )
      if (stats.errors.length > 0) {
        UI.println(`${stats.errors.length} errors occurred during migration`)
      }
    } catch (err) {
      if (tty) process.stderr.write("\x1b[?25h")
      UI.error(`Migration failed: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    } finally {
      sqlite.close()
    }
  },
})

export const DbCommand = cmd({
  command: "db",
  describe: "database tools",
  builder: (yargs: Argv) => {
    return yargs.command(QueryCommand).command(PathCommand).command(MigrateCommand).demandCommand()
  },
  handler: () => {},
})
