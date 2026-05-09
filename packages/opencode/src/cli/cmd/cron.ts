import { Effect } from "effect"
import { Provider } from "@/provider/provider"
import { SchedulerStore } from "@/scheduler/store"
import { SchedulerRunner } from "@/scheduler/runner"
import { cmd } from "./cmd"
import { effectCmd } from "../effect-cmd"

function parseModel(input: unknown) {
  const text = String(input ?? "").trim()
  if (!text) return
  return Provider.parseModel(text)
}

type AddArgs = {
  schedule: string
  prompt: string
  agent?: string
  model?: string
  variant?: string
  enabled: boolean
}

type ListArgs = {
  json: boolean
}

type IDArgs = {
  id: string
}

const AddCommand = effectCmd({
  command: "add <schedule> <prompt>",
  describe: "add a cron job",
  builder: (yargs) =>
    yargs
      .positional("schedule", { type: "string", demandOption: true })
      .positional("prompt", { type: "string", demandOption: true })
      .option("agent", { type: "string" })
      .option("model", { type: "string" })
      .option("variant", { type: "string" })
      .option("enabled", { type: "boolean", default: true }),
  handler: Effect.fn("Cli.cron.add")(function* (args: AddArgs) {
    const job = yield* Effect.promise(() =>
      SchedulerStore.add({
        schedule: args.schedule,
        prompt: args.prompt,
        enabled: args.enabled,
        agent: args.agent,
        model: parseModel(args.model),
        variant: args.variant,
      }),
    )
    SchedulerRunner.notify()
    console.log(job.id)
  }),
})

const ListCommand = effectCmd({
  command: "list",
  aliases: ["ls"],
  describe: "list cron jobs",
  builder: (yargs) => yargs.option("json", { type: "boolean", default: false }),
  handler: Effect.fn("Cli.cron.list")(function* (args: ListArgs) {
    const jobs = yield* Effect.promise(() => SchedulerStore.list())
    if (args.json) {
      console.log(JSON.stringify(jobs, null, 2))
      return
    }
    for (const job of jobs) {
      console.log(`${job.id}\t${job.enabled ? "enabled" : "disabled"}\t${job.schedule}\t${job.prompt}`)
    }
  }),
})

const RemoveCommand = effectCmd({
  command: "remove <id>",
  describe: "remove cron job",
  builder: (yargs) => yargs.positional("id", { type: "string", demandOption: true }),
  handler: Effect.fn("Cli.cron.remove")(function* (args: IDArgs) {
    const ok = yield* Effect.promise(() => SchedulerStore.remove(args.id))
    if (!ok) throw new Error(`cron job not found: ${args.id}`)
    SchedulerRunner.notify()
    console.log("ok")
  }),
})

const RunCommand = effectCmd({
  command: "run <id>",
  describe: "run cron job now",
  builder: (yargs) => yargs.positional("id", { type: "string", demandOption: true }),
  handler: Effect.fn("Cli.cron.run")(function* (args: IDArgs) {
    const ok = yield* Effect.promise(() => SchedulerRunner.runNow(args.id))
    if (!ok) throw new Error(`cron job not found: ${args.id}`)
    console.log("ok")
  }),
})

const EnableCommand = effectCmd({
  command: "enable <id>",
  describe: "enable cron job",
  builder: (yargs) => yargs.positional("id", { type: "string", demandOption: true }),
  handler: Effect.fn("Cli.cron.enable")(function* (args: IDArgs) {
    const job = yield* Effect.promise(() => SchedulerStore.setEnabled(args.id, true))
    if (!job) throw new Error(`cron job not found: ${args.id}`)
    SchedulerRunner.notify()
    console.log("ok")
  }),
})

const DisableCommand = effectCmd({
  command: "disable <id>",
  describe: "disable cron job",
  builder: (yargs) => yargs.positional("id", { type: "string", demandOption: true }),
  handler: Effect.fn("Cli.cron.disable")(function* (args: IDArgs) {
    const job = yield* Effect.promise(() => SchedulerStore.setEnabled(args.id, false))
    if (!job) throw new Error(`cron job not found: ${args.id}`)
    SchedulerRunner.notify()
    console.log("ok")
  }),
})

export const CronCommand = cmd({
  command: "cron",
  describe: "manage scheduler jobs",
  builder: (yargs) =>
    yargs
      .command(AddCommand)
      .command(ListCommand)
      .command(RemoveCommand)
      .command(RunCommand)
      .command(EnableCommand)
      .command(DisableCommand)
      .demandCommand(),
  async handler() {},
})
