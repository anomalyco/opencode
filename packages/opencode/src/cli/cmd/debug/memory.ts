import fs from "fs/promises"
import { EOL } from "os"
import path from "path"
import open from "open"
import { Memory } from "@/memory"
import { bootstrap } from "../../bootstrap"
import { cmd } from "../cmd"

export const MemoryCommand = cmd({
  command: "memory",
  describe: "memory dump debugging utilities",
  builder: (yargs) =>
    yargs
      .command(TriggerCommand)
      .command(CheckCommand)
      .command(ListCommand)
      .command(ShowCommand)
      .command(IssueCommand)
      .command(SendCommand)
      .demandCommand(),
  async handler() {},
})

const TriggerCommand = cmd({
  command: "trigger",
  describe: "force memory diagnostics artifact and event",
  async handler() {
    await bootstrap(process.cwd(), async () => {
      const result = await Memory.trigger()
      process.stdout.write(JSON.stringify(result, null, 2) + EOL)
    })
  },
})

const CheckCommand = cmd({
  command: "check",
  describe: "run one memory check immediately",
  async handler() {
    await bootstrap(process.cwd(), async () => {
      const result = await Memory.check()
      process.stdout.write(JSON.stringify(result, null, 2) + EOL)
    })
  },
})

const ListCommand = cmd({
  command: "list",
  describe: "list saved memory reports",
  async handler() {
    await bootstrap(process.cwd(), async () => {
      const reports = await Memory.reports()
      const output = reports.map((item) => ({
        id: item.id,
        created: item.created,
        rss_mb: Math.round(item.memory_usage.rss / 1024 / 1024),
        report_path: item.report_path,
        heapdump_path: item.heapdump_path,
        heapdump_exists: item.heapdump_exists,
      }))
      process.stdout.write(JSON.stringify(output, null, 2) + EOL)
    })
  },
})

const ShowCommand = cmd({
  command: "show [id]",
  describe: "view a memory report",
  builder: (yargs) =>
    yargs.positional("id", {
      type: "string",
      description: "report id (default: latest)",
      default: "latest",
    }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      const report = await Memory.report(args.id)
      if (!report) {
        process.stderr.write(`Memory report not found: ${args.id}` + EOL)
        process.exit(1)
      }
      process.stdout.write(JSON.stringify(report, null, 2) + EOL)
    })
  },
})

const IssueCommand = cmd({
  command: "issue [id]",
  describe: "create a pre-filled GitHub issue link",
  builder: (yargs) =>
    yargs
      .positional("id", {
        type: "string",
        description: "report id (default: latest)",
        default: "latest",
      })
      .option("open", {
        type: "boolean",
        description: "open issue URL in browser",
        default: false,
      }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      const report = await Memory.report(args.id)
      if (!report) {
        process.stderr.write(`Memory report not found: ${args.id}` + EOL)
        process.exit(1)
      }
      const url = issueURL(report)
      process.stdout.write(url + EOL)
      if (args.open) {
        await open(url).catch(() => undefined)
      }
    })
  },
})

const SendCommand = cmd({
  command: "send [id]",
  describe: "prepare local package for manual sharing",
  builder: (yargs) =>
    yargs.positional("id", {
      type: "string",
      description: "report id (default: latest)",
      default: "latest",
    }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      const report = await Memory.report(args.id)
      if (!report) {
        process.stderr.write(`Memory report not found: ${args.id}` + EOL)
        process.exit(1)
      }

      const dir = path.join(Memory.DIR, "send", report.id)
      await fs.rm(dir, { recursive: true, force: true })
      await fs.mkdir(dir, { recursive: true })

      const copied = [] as string[]
      const reportTarget = path.join(dir, path.basename(report.report_path))
      await fs.copyFile(report.report_path, reportTarget)
      copied.push(reportTarget)

      if (report.heapdump_path && report.heapdump_exists) {
        const heapTarget = path.join(dir, path.basename(report.heapdump_path))
        await fs.copyFile(report.heapdump_path, heapTarget)
        copied.push(heapTarget)
      }

      const instructions = path.join(dir, "README.txt")
      await Bun.write(
        instructions,
        [
          "OpenCode memory diagnostics package",
          "",
          `Report ID: ${report.id}`,
          "",
          "Files:",
          ...copied.map((item) => `- ${item}`),
          "",
          "Next steps:",
          "1. Create a GitHub issue with `opencode debug memory issue <id>`.",
          "2. Attach the files in this folder to the issue.",
        ].join("\n"),
      )

      process.stdout.write(
        JSON.stringify(
          {
            id: report.id,
            directory: dir,
            files: [...copied, instructions],
          },
          null,
          2,
        ) + EOL,
      )
    })
  },
})

function issueURL(report: Memory.SavedReport) {
  const body = [
    "## Memory Event",
    "",
    "A high-memory event was detected by OpenCode.",
    "",
    `- id: ${report.id}`,
    `- created: ${new Date(report.created).toISOString()}`,
    `- pid: ${report.pid}`,
    `- rss bytes: ${report.memory_usage.rss}`,
    `- report path: ${report.report_path}`,
    ...(report.heapdump_path ? [`- heapdump path: ${report.heapdump_path}`] : []),
    "",
    "Please attach the files from the paths above.",
  ].join("\n")

  const url = new URL("https://github.com/anomalyco/opencode/issues/new")
  url.searchParams.set("template", "bug-report.yml")
  url.searchParams.set("title", `memory: high usage (${report.id})`)
  url.searchParams.set("description", body)
  return url.toString()
}
