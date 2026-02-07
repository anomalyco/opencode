import path from "path"
import { EOL } from "os"
import type { Argv } from "yargs"
import { Automation } from "../../automation"
import { Locale } from "../../util/locale"
import { bootstrap } from "../bootstrap"
import { cmd } from "./cmd"
import { Flag } from "../../flag/flag"
import { AutomationTransfer } from "@opencode-ai/util/automation-transfer"
import { getFilename } from "@opencode-ai/util/path"
import { slugify } from "@opencode-ai/util/slugify"
import { UI } from "../ui"
import * as prompts from "@clack/prompts"
import { Instance } from "../../project/instance"
import { mkdir } from "fs/promises"
import { Filesystem } from "../../util/filesystem"

export const AutomationCommand = cmd({
  command: "automation",
  describe: "manage automations",
  builder: (yargs: Argv) =>
    yargs
      .command(AutomationListCommand)
      .command(AutomationHistoryCommand)
      .command(AutomationCreateCommand)
      .command(AutomationUpdateCommand)
      .command(AutomationRemoveCommand)
      .command(AutomationRunCommand)
      .command(AutomationExportCommand)
      .command(AutomationImportCommand)
      .demandCommand(),
  async handler() {},
})

export const AutomationListCommand = cmd({
  command: "list",
  describe: "list automations",
  builder: (yargs: Argv) =>
    yargs
      .option("max-count", {
        alias: "n",
        describe: "limit to N most recent automations",
        type: "number",
      })
      .option("format", {
        describe: "output format",
        type: "string",
        choices: ["table", "json"],
        default: "table",
      }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const items = await Automation.list()
      const limited = args.maxCount ? items.slice(0, args.maxCount) : items
      if (limited.length === 0) return

      const output = args.format === "json" ? formatAutomationJSON(limited) : formatAutomationTable(limited)
      const shouldPaginate = process.stdout.isTTY && !args.maxCount && args.format === "table"

      if (shouldPaginate) {
        const proc = Bun.spawn({
          cmd: pagerCmd(),
          stdin: "pipe",
          stdout: "inherit",
          stderr: "inherit",
        })
        proc.stdin.write(output)
        proc.stdin.end()
        await proc.exited
        return
      }

      process.stdout.write(output + EOL)
    })
  },
})

export const AutomationCreateCommand = cmd({
  command: "create",
  describe: "create an automation",
  builder: (yargs: Argv) =>
    yargs
      .option("name", {
        type: "string",
        describe: "automation name",
        demandOption: true,
      })
      .option("prompt", {
        type: "string",
        describe: "prompt template",
        demandOption: true,
      })
      .option("project", {
        alias: "p",
        type: "string",
        array: true,
        describe: "project directories",
        demandOption: true,
      })
      .option("schedule", {
        type: "string",
        describe: "cron schedule (optional)",
      })
      .option("enabled", {
        type: "boolean",
        describe: "enable schedule",
      }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const result = await Automation.create({
        name: args.name,
        prompt: args.prompt,
        projects: args.project ?? [],
        schedule: args.schedule ?? null,
        enabled: args.enabled,
      })
      process.stdout.write(JSON.stringify(result, null, 2) + EOL)
    })
  },
})

export const AutomationHistoryCommand = cmd({
  command: "history <id>",
  describe: "show automation run history",
  builder: (yargs: Argv) =>
    yargs
      .positional("id", {
        type: "string",
        describe: "automation id",
        demandOption: true,
      })
      .option("max-count", {
        alias: "n",
        describe: "limit to N most recent runs",
        type: "number",
      })
      .option("format", {
        describe: "output format",
        type: "string",
        choices: ["table", "json"],
        default: "table",
      }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const items = await Automation.history({ id: args.id, limit: args.maxCount })
      if (items.length === 0) return

      const output = args.format === "json" ? formatRunJSON(items) : formatRunTable(items)
      const shouldPaginate = process.stdout.isTTY && !args.maxCount && args.format === "table"

      if (shouldPaginate) {
        const proc = Bun.spawn({
          cmd: pagerCmd(),
          stdin: "pipe",
          stdout: "inherit",
          stderr: "inherit",
        })
        proc.stdin.write(output)
        proc.stdin.end()
        await proc.exited
        return
      }

      process.stdout.write(output + EOL)
    })
  },
})

export const AutomationUpdateCommand = cmd({
  command: "update <id>",
  describe: "update an automation",
  builder: (yargs: Argv) =>
    yargs
      .positional("id", {
        type: "string",
        describe: "automation id",
        demandOption: true,
      })
      .option("name", {
        type: "string",
        describe: "automation name",
      })
      .option("prompt", {
        type: "string",
        describe: "prompt template",
      })
      .option("project", {
        alias: "p",
        type: "string",
        array: true,
        describe: "project directories",
      })
      .option("schedule", {
        type: "string",
        describe: "cron schedule (optional)",
      })
      .option("enabled", {
        type: "boolean",
        describe: "enable schedule",
      }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const changes = {
        id: args.id,
        name: args.name,
        prompt: args.prompt,
        projects: args.project,
        schedule: args.schedule,
        enabled: args.enabled,
      }

      if (!hasUpdate(changes)) return

      const result = await Automation.update(changes)
      process.stdout.write(JSON.stringify(result, null, 2) + EOL)
    })
  },
})

export const AutomationRemoveCommand = cmd({
  command: "remove <id>",
  describe: "remove an automation",
  builder: (yargs: Argv) =>
    yargs.positional("id", {
      type: "string",
      describe: "automation id",
      demandOption: true,
    }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      await Automation.remove(args.id)
      process.stdout.write(`Removed automation: ${args.id}` + EOL)
    })
  },
})

export const AutomationRunCommand = cmd({
  command: "run <id>",
  describe: "run an automation",
  builder: (yargs: Argv) =>
    yargs.positional("id", {
      type: "string",
      describe: "automation id",
      demandOption: true,
    }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const result = await Automation.run({ id: args.id })
      process.stdout.write(JSON.stringify(result, null, 2) + EOL)
    })
  },
})

export const AutomationExportCommand = cmd({
  command: "export [id]",
  describe: "export automation definitions as JSON",
  builder: (yargs: Argv) =>
    yargs
      .positional("id", {
        type: "string",
        describe: "automation id",
      })
      .option("dir", {
        type: "string",
        describe: "export to a directory (writes a JSON file)",
      })
      .option("project", {
        type: "boolean",
        default: false,
        describe: "export to .opencode/automations in the project root",
      })
      .option("all", {
        type: "boolean",
        default: false,
        describe: "export all automations",
      }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const items = await Automation.list()
      if (items.length === 0) return

      const dir = await resolveAutomationDir({ dir: args.dir, project: args.project })
      if (dir) {
        await mkdir(dir, { recursive: true })
      }

      if (args.all) {
        if (dir) {
          await writeExportFile(dir, "automations.json", items)
          return
        }
        process.stdout.write(JSON.stringify(AutomationTransfer.serialize(items), null, 2) + EOL)
        return
      }

      let selected = args.id

      if (!selected) {
        UI.empty()
        prompts.intro("Export automation", { output: process.stderr })

        const chosen = await prompts.autocomplete({
          message: "Select automation to export",
          maxItems: 10,
          options: items.map((automation) => ({
            label: automation.name,
            value: automation.id,
            hint: `${new Date(automation.time.updated).toLocaleString()} • ${automation.id.slice(-8)}`,
          })),
          output: process.stderr,
        })

        if (prompts.isCancel(chosen)) throw new UI.CancelledError()
        selected = chosen as string
        prompts.outro("Exporting automation...", { output: process.stderr })
      }

      const match = items.find((item) => item.id === selected)
      if (!match) {
        UI.error(`Automation not found: ${selected}`)
        process.exit(1)
      }
      if (dir) {
        const suffix = slugify(match.name) || match.id.slice(-8)
        await writeExportFile(dir, `automation-${suffix}.json`, [match])
        return
      }

      process.stdout.write(JSON.stringify(AutomationTransfer.serialize([match]), null, 2) + EOL)
    })
  },
})

export const AutomationImportCommand = cmd({
  command: "import [file]",
  describe: "import automations from JSON file",
  builder: (yargs: Argv) =>
    yargs
      .positional("file", {
        type: "string",
        describe: "path to JSON file",
      })
      .option("dir", {
        type: "string",
        describe: "import automations from all JSON files in a directory",
      })
      .option("project", {
        type: "boolean",
        default: false,
        describe: "import from .opencode/automations in the project root",
      }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const dir = await resolveAutomationDir({ dir: args.dir, project: args.project })
      const file = args.file
      if (!dir) {
        if (!file) {
          UI.error("Missing file path or --dir/--project option")
          process.exit(1)
        }
        const items = await readImportsFromFile(file)
        if (!items) return
        if (items.length === 0) return

        const created = await Promise.all(
          items.map((item) =>
            Automation.create({
              name: item.name,
              prompt: item.prompt,
              projects: item.projects,
              schedule: item.schedule ?? null,
              enabled: item.enabled,
            }),
          ),
        )

        process.stdout.write(`Imported ${created.length} automation${created.length === 1 ? "" : "s"}` + EOL)
        return
      }

      const items = await readImportsFromDir(dir)
      if (!items) return
      if (items.length === 0) return

      const created = await Promise.all(
        items.map((item) =>
          Automation.create({
            name: item.name,
            prompt: item.prompt,
            projects: item.projects,
            schedule: item.schedule ?? null,
            enabled: item.enabled,
          }),
        ),
      )

      process.stdout.write(`Imported ${created.length} automation${created.length === 1 ? "" : "s"}` + EOL)
    })
  },
})

function scheduleLabel(info: Automation.Info) {
  if (!info.schedule) return "Manual"

  const lines = info.schedule
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (!info.enabled) {
    const schedule = lines[0] ?? info.schedule
    return `Disabled - ${schedule}`
  }
  if (lines.length > 1) return `Multiple - ${lines.length}`
  return lines[0] ?? info.schedule
}

function runLabel(value?: number) {
  if (!value) return "Never"

  return Locale.todayTimeOrDateTime(value)
}

function resolveAutomationDir(input: { dir?: string; project?: boolean }) {
  if (input.dir) return path.resolve(input.dir)
  if (!input.project) return

  const root = Instance.worktree && Instance.worktree !== "/" ? Instance.worktree : Instance.directory
  return path.join(root, ".opencode", "automations")
}

async function writeExportFile(dir: string, filename: string, items: Automation.Info[]) {
  if (items.length === 0) return

  const filepath = path.join(dir, filename)
  await mkdir(dir, { recursive: true })
  await Bun.write(filepath, JSON.stringify(AutomationTransfer.serialize(items), null, 2))
  UI.println(`Exported ${items.length} automation${items.length === 1 ? "" : "s"} to ${filepath}`)
}

function parseImportPayload(data: unknown) {
  return AutomationTransfer.parse(data)
}

async function readImportsFromFile(filepath: string) {
  const file = Bun.file(filepath)
  const exists = await file.exists()
  if (!exists) {
    process.stdout.write(`File not found: ${filepath}` + EOL)
    return
  }

  const data = await file
    .text()
    .then((text) => JSON.parse(text))
    .catch(() => undefined)
  if (!data) {
    process.stdout.write(`Invalid automation import file: ${filepath}` + EOL)
    return
  }
  const items = parseImportPayload(data)
  if (items.length === 0) {
    process.stdout.write(`Invalid automation import file: ${filepath}` + EOL)
    return
  }
  return items
}

async function readImportsFromDir(dir: string) {
  const exists = await Filesystem.isDir(dir)
  if (!exists) {
    process.stdout.write(`Directory not found: ${dir}` + EOL)
    return
  }

  const glob = new Bun.Glob("*.json")
  const files: string[] = []
  for await (const match of glob.scan({ cwd: dir, absolute: true })) {
    files.push(match)
  }
  if (files.length === 0) {
    process.stdout.write(`No automation exports found in: ${dir}` + EOL)
    return
  }

  const items = (
    await Promise.all(
      files.map((file) =>
        Bun.file(file)
          .json()
          .then((data) => parseImportPayload(data))
          .catch(() => []),
      ),
    )
  ).flat()

  if (items.length === 0) {
    process.stdout.write(`No valid automations found in: ${dir}` + EOL)
    return
  }
  return items
}

function formatAutomationTable(items: Automation.Info[]): string {
  const rows = items.map((item) => ({
    id: item.id,
    name: item.name,
    projects: String(item.projects.length),
    schedule: scheduleLabel(item),
    next: runLabel(item.nextRun),
    last: runLabel(item.lastRun),
  }))

  const maxId = Math.max("Automation ID".length, ...rows.map((row) => row.id.length))
  const maxName = Math.min(32, Math.max("Name".length, ...rows.map((row) => row.name.length)))
  const maxProjects = Math.max("Projects".length, ...rows.map((row) => row.projects.length))
  const maxSchedule = Math.min(32, Math.max("Schedule".length, ...rows.map((row) => row.schedule.length)))
  const maxNext = Math.max("Next Run".length, ...rows.map((row) => row.next.length))
  const maxLast = Math.max("Last Run".length, ...rows.map((row) => row.last.length))

  const header =
    `Automation ID${" ".repeat(maxId - "Automation ID".length)}` +
    `  Name${" ".repeat(maxName - "Name".length)}` +
    `  Projects${" ".repeat(maxProjects - "Projects".length)}` +
    `  Schedule${" ".repeat(maxSchedule - "Schedule".length)}` +
    `  Next Run${" ".repeat(maxNext - "Next Run".length)}` +
    `  Last Run${" ".repeat(maxLast - "Last Run".length)}`

  const lines = [header, "-".repeat(header.length)]

  for (const row of rows) {
    const line =
      row.id.padEnd(maxId) +
      "  " +
      Locale.truncate(row.name, maxName).padEnd(maxName) +
      "  " +
      row.projects.padEnd(maxProjects) +
      "  " +
      Locale.truncate(row.schedule, maxSchedule).padEnd(maxSchedule) +
      "  " +
      row.next.padEnd(maxNext) +
      "  " +
      row.last.padEnd(maxLast)
    lines.push(line)
  }

  return lines.join(EOL)
}

function formatAutomationJSON(items: Automation.Info[]): string {
  return JSON.stringify(items, null, 2)
}

function formatRunTable(items: Automation.Run[]): string {
  const rows = items.map((item) => ({
    time: Locale.todayTimeOrDateTime(item.time),
    project: getFilename(item.directory),
    status: item.status,
    session: item.sessionID ?? "-",
  }))

  const maxTime = Math.max("Time".length, ...rows.map((row) => row.time.length))
  const maxProject = Math.max("Project".length, ...rows.map((row) => row.project.length))
  const maxStatus = Math.max("Status".length, ...rows.map((row) => row.status.length))
  const maxSession = Math.max("Session".length, ...rows.map((row) => row.session.length))

  const header =
    `Time${" ".repeat(maxTime - "Time".length)}` +
    `  Project${" ".repeat(maxProject - "Project".length)}` +
    `  Status${" ".repeat(maxStatus - "Status".length)}` +
    `  Session${" ".repeat(maxSession - "Session".length)}`

  const lines = [header, "-".repeat(header.length)]

  for (const row of rows) {
    const line =
      row.time.padEnd(maxTime) +
      "  " +
      row.project.padEnd(maxProject) +
      "  " +
      row.status.padEnd(maxStatus) +
      "  " +
      row.session.padEnd(maxSession)
    lines.push(line)
  }

  return lines.join(EOL)
}

function formatRunJSON(items: Automation.Run[]): string {
  return JSON.stringify(items, null, 2)
}

function hasUpdate(input: {
  name?: string
  prompt?: string
  projects?: string[]
  schedule?: string
  enabled?: boolean
}) {
  if (input.name !== undefined) return true
  if (input.prompt !== undefined) return true
  if (input.projects !== undefined) return true
  if (input.schedule !== undefined) return true
  if (input.enabled !== undefined) return true

  return false
}

function pagerCmd(): string[] {
  const lessOptions = ["-R", "-S"]
  if (process.platform !== "win32") {
    return ["less", ...lessOptions]
  }

  const lessOnPath = Bun.which("less")
  if (lessOnPath) {
    if (Bun.file(lessOnPath).size) return [lessOnPath, ...lessOptions]
  }

  if (Flag.OPENCODE_GIT_BASH_PATH) {
    const less = path.join(Flag.OPENCODE_GIT_BASH_PATH, "..", "..", "usr", "bin", "less.exe")
    if (Bun.file(less).size) return [less, ...lessOptions]
  }

  const git = Bun.which("git")
  if (git) {
    const less = path.join(git, "..", "..", "usr", "bin", "less.exe")
    if (Bun.file(less).size) return [less, ...lessOptions]
  }

  return ["cmd", "/c", "more"]
}
