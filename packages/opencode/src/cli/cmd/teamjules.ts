import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { TeamJules } from "@opencode-ai/core/teamjules"

export const TeamJulesCommand = effectCmd({
  command: "teamjules <action>",
  builder: (yargs) =>
    yargs
      .command(
        "submit",
        "Submit a new task",
        (yargs) =>
          yargs
            .option("repo", { type: "string", demandOption: true, describe: "Repository (owner/repo)" })
            .option("branch", { type: "string", default: "main", describe: "Base branch" })
            .option("prompt", { type: "string", demandOption: true, describe: "Task prompt" })
            .option("type", { type: "string", default: "manual", choices: ["issue", "pr", "manual"] }),
        async (args) => {
          const service = (await import("@opencode-ai/core/teamjules")).TeamJules.Service
          const task = await service.createTask({
            type: args.type as any,
            repo: args.repo,
            branch: args.branch,
            prompt: args.prompt,
          })
          console.log(`Task created: ${task.id}`)
        }
      )
      .command(
        "list",
        "List tasks",
        (yargs) =>
          yargs
            .option("status", { type: "string", describe: "Filter by status" })
            .option("repo", { type: "string", describe: "Filter by repo" })
            .option("limit", { type: "number", default: 20 }),
        async (args) => {
          const service = (await import("@opencode-ai/core/teamjules")).TeamJules.Service
          const tasks = await service.listTasks({
            status: args.status as any,
            repo: args.repo,
            limit: args.limit,
          })
          console.table(tasks.map((t) => ({
            id: t.id,
            status: t.status,
            repo: t.repo,
            prompt: t.prompt.slice(0, 50),
          })))
        }
      )
      .command(
        "status <taskID>",
        "Get task status",
        (yargs) => yargs.positional("taskID", { type: "string", demandOption: true }),
        async (args) => {
          const service = (await import("@opencode-ai/core/teamjules")).TeamJules.Service
          const task = await service.getTask(args.taskID as any)
          if (!task) {
            console.log("Task not found")
            return
          }
          console.log(JSON.stringify(task, null, 2))
        }
      )
      .command(
        "cancel <taskID>",
        "Cancel a task",
        (yargs) => yargs.positional("taskID", { type: "string", demandOption: true }),
        async (args) => {
          const service = (await import("@opencode-ai/core/teamjules")).TeamJules.Service
          await service.cancelTask(args.taskID as any)
          console.log("Task cancelled")
        }
      )
      .command(
        "retry <taskID>",
        "Retry a failed task",
        (yargs) => yargs.positional("taskID", { type: "string", demandOption: true }),
        async (args) => {
          const service = (await import("@opencode-ai/core/teamjules")).TeamJules.Service
          await service.retryTask(args.taskID as any)
          console.log("Task queued for retry")
        }
      )
      .demandCommand(1, "Please specify an action"),
  describe: "Manage TeamJules async coding tasks",
  instance: false,
  handler: Effect.fn("Cli.teamjules")(function* () {
    // Handler is handled by subcommands
  }),
})
