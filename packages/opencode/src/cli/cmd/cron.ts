import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { JobStore, Job } from "../../scheduler/store"
import { CronParser } from "../../scheduler/cron-parser"
import { Instance } from "../../project/instance"

export const CronCommand = cmd({
  command: "cron",
  describe: "manage cron jobs",
  builder: (yargs: Argv) => {
    return yargs
      .command(CronListCommand)
      .command(CronCreateCommand)
      .command(CronDeleteCommand)
      .demandCommand(1, "You must specify a subcommand: list, create, or delete")
  },
  handler: () => {
    // This will never be called due to demandCommand
  },
})

export const CronListCommand = cmd({
  command: "list",
  describe: "list all cron jobs for current project",
  async handler() {
    await bootstrap(process.cwd(), async () => {
      const project = Instance.project
      const jobs = await JobStore.list(project.id)

      if (jobs.length === 0) {
        console.log("No cron jobs found for project:", project.id)
        return
      }

      displayJobs(jobs)
    })
  },
})

interface CronCreateArgs {
  cron: string
  prompt: string
  agent?: string
}

export const CronCreateCommand = cmd({
  command: "create <cron-expression> <prompt>",
  describe: "create a new cron job",
  builder: (yargs: Argv) =>
    yargs
      .positional("cron-expression", {
        describe: "cron expression (e.g., '0 0 * * *' for daily at midnight)",
        type: "string",
      })
      .positional("prompt", {
        describe: "prompt to execute when job runs",
        type: "string",
      })
      .option("agent", {
        describe: "agent to use for the job",
        type: "string",
        default: "build",
      }),
  async handler(args: any) {
    await bootstrap(process.cwd(), async () => {
      const project = Instance.project
      const cronExpr = args["cron-expression"]
      const prompt = args.prompt

      if (!CronParser.isValid(cronExpr)) {
        console.error("Error: Invalid cron expression:", cronExpr)
        console.error("Example: '0 0 * * *' for daily at midnight")
        process.exit(1)
      }

      const job = Job.create({
        cron: cronExpr,
        prompt: prompt,
        agent: args.agent || "build",
        projectID: project.id,
      })

      await JobStore.save(job)

      console.log("Created cron job:")
      console.log("┌────────────────────────────────────────────────────────┐")
      console.log("│                      JOB CREATED                       │")
      console.log("├────────────────────────────────────────────────────────┤")
      console.log(renderRow("ID", job.id))
      console.log(renderRow("Cron", cronExpr))
      console.log(renderRow("Schedule", CronParser.humanReadable(cronExpr)))
      console.log(renderRow("Agent", job.agent))
      console.log(renderRow("Status", job.enabled ? "enabled" : "disabled"))
      console.log(renderRow("Next Run", new Date(job.nextRun).toLocaleString()))
      console.log("└────────────────────────────────────────────────────────┘")
      console.log()
      console.log("Prompt:", job.prompt)
    })
  },
})

interface CronDeleteArgs {
  id: string
}

export const CronDeleteCommand = cmd({
  command: "delete <id>",
  describe: "delete a cron job by ID",
  builder: (yargs: Argv) =>
    yargs.positional("id", {
      describe: "job ID to delete",
      type: "string",
    }),
  async handler(args: any) {
    await bootstrap(process.cwd(), async () => {
      const project = Instance.project
      const id = args.id

      const success = await JobStore.remove(id, project.id)

      if (success) {
        console.log("Deleted cron job:", id)
      } else {
        console.error("Error: Job not found:", id)
        process.exit(1)
      }
    })
  },
})

function displayJobs(jobs: Job.Job[]): void {
  const width = 56

  console.log("┌────────────────────────────────────────────────────────┐")
  console.log("│                      CRON JOBS                         │")
  console.log("├────────────────────────────────────────────────────────┤")

  for (const job of jobs) {
    const status = job.enabled ? "enabled" : "disabled"
    const nextRun = new Date(job.nextRun).toLocaleString()
    const lastRun = job.lastRun ? new Date(job.lastRun).toLocaleString() : "never"

    console.log(`│ ${job.id.padEnd(54)} │`)
    console.log(renderRow("Cron", job.cron))
    console.log(renderRow("Schedule", CronParser.humanReadable(job.cron)))
    console.log(renderRow("Agent", job.agent))
    console.log(renderRow("Status", status))
    console.log(renderRow("Run Count", job.runCount.toString()))
    console.log(renderRow("Last Run", lastRun))
    console.log(renderRow("Next Run", nextRun))
    console.log("├────────────────────────────────────────────────────────┤")
  }

  // Remove last separator and add bottom border
  process.stdout.write("\x1B[1A") // Move up one line
  console.log("└────────────────────────────────────────────────────────┘")
  console.log()
}

function renderRow(label: string, value: string): string {
  const width = 56
  const availableWidth = width - 1
  const paddingNeeded = availableWidth - label.length - value.length
  const padding = Math.max(0, paddingNeeded)
  return `│${label}${" ".repeat(padding)}${value} │`
}
