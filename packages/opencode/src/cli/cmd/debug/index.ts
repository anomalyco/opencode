import fs from "fs/promises"
import path from "path"
import { Global } from "../../../global"
import { bootstrap } from "../../bootstrap"
import { cmd } from "../cmd"
import { ConfigCommand } from "./config"
import { FileCommand } from "./file"
import { LSPCommand } from "./lsp"
import { RipgrepCommand } from "./ripgrep"
import { ScrapCommand } from "./scrap"
import { SkillCommand } from "./skill"
import { SnapshotCommand } from "./snapshot"
import { AgentCommand } from "./agent"

export const DebugCommand = cmd({
  command: "debug",
  describe: "debugging and troubleshooting tools",
  builder: (yargs) =>
    yargs
      .command(ConfigCommand)
      .command(LSPCommand)
      .command(RipgrepCommand)
      .command(FileCommand)
      .command(ScrapCommand)
      .command(SkillCommand)
      .command(SnapshotCommand)
      .command(AgentCommand)
      .command(PathsCommand)
      .command(LogsCommand)
      .command({
        command: "wait",
        describe: "wait indefinitely (for debugging)",
        async handler() {
          await bootstrap(process.cwd(), async () => {
            await new Promise((resolve) => setTimeout(resolve, 1_000 * 60 * 60 * 24))
          })
        },
      })
      .demandCommand(),
  async handler() {},
})

const PathsCommand = cmd({
  command: "paths",
  describe: "show global paths (data, config, cache, state)",
  handler() {
    for (const [key, value] of Object.entries(Global.Path)) {
      console.log(key.padEnd(10), value)
    }
  },
})

const LogsCommand = cmd({
  command: "logs [file]",
  describe: "list or view retention logs",
  builder: (yargs) =>
    yargs
      .positional("file", {
        type: "string",
        describe: "log file to view (index, partial name, or full path)",
      })
      .option("tail", {
        alias: "n",
        type: "number",
        describe: "show last N lines",
        default: 50,
      })
      .option("follow", {
        alias: "f",
        type: "boolean",
        describe: "follow log output (like tail -f)",
        default: false,
      })
      .option("list", {
        alias: "l",
        type: "boolean",
        describe: "list all log files",
        default: false,
      }),
  async handler(args) {
    const logDir = Global.Path.log
    const files = await fs.readdir(logDir).catch(() => [])
    const logs = files
      .filter((f) => f.endsWith(".log"))
      .sort()
      .reverse()

    if (args.list || !args.file) {
      console.log(`Log directory: ${logDir}\n`)
      if (logs.length === 0) {
        console.log("No log files found")
        return
      }
      for (let i = 0; i < logs.length; i++) {
        const file = logs[i]
        const stat = await fs.stat(path.join(logDir, file)).catch(() => null)
        const size = stat ? `${(stat.size / 1024).toFixed(1)}K` : "?"
        const age = stat ? formatAge(Date.now() - stat.mtimeMs) : "?"
        console.log(`${i.toString().padStart(3)}  ${file}  ${size.padStart(8)}  ${age}`)
      }
      return
    }

    // Resolve file argument
    let target: string
    const idx = parseInt(args.file, 10)
    if (!isNaN(idx) && idx >= 0 && idx < logs.length) {
      target = path.join(logDir, logs[idx])
    } else if (args.file.includes("/")) {
      target = args.file
    } else {
      const match = logs.find((f) => f.includes(args.file!))
      if (match) {
        target = path.join(logDir, match)
      } else {
        console.error(`Log file not found: ${args.file}`)
        process.exit(1)
      }
    }

    if (args.follow) {
      const file = Bun.file(target)
      let offset = (await file.exists()) ? file.size : 0
      // Print last N lines first
      const content = await file.text().catch(() => "")
      const lines = content.split("\n")
      const tail = lines.slice(-args.tail).join("\n")
      if (tail) process.stdout.write(tail + "\n")

      // Follow new content
      while (true) {
        await Bun.sleep(500)
        const newSize = Bun.file(target).size
        if (newSize > offset) {
          const chunk = await Bun.file(target).slice(offset, newSize).text()
          process.stdout.write(chunk)
          offset = newSize
        }
      }
    } else {
      const content = await Bun.file(target)
        .text()
        .catch(() => "")
      const lines = content.split("\n")
      const tail = lines.slice(-args.tail).join("\n")
      console.log(tail)
    }
  },
})

function formatAge(ms: number): string {
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const days = Math.floor(hr / 24)
  return `${days}d ago`
}
