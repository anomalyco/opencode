import type { Argv } from "yargs"
import { EOL } from "os"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { UI } from "../ui"
import { Trigger } from "../../trigger"
import { Locale } from "../../util/locale"
import { SessionID } from "../../session/schema"

type CreateArgs = {
  interval?: number
  at?: number
  session?: string
  command?: string
  arguments?: string
  webhook?: string
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  body?: string
  webhookSecret?: string
}

type Action = NonNullable<Trigger.Info["action"]>

export const TriggerCommand = cmd({
  command: "trigger",
  describe: "manage triggers",
  builder: (yargs: Argv) =>
    yargs
      .command(TriggerListCommand)
      .command(TriggerCreateCommand)
      .command(TriggerFireCommand)
      .command(TriggerDeleteCommand)
      .command(TriggerEnableCommand)
      .command(TriggerDisableCommand)
      .demandCommand(),
  async handler() {},
})

export const TriggerListCommand = cmd({
  command: "list",
  describe: "list triggers",
  builder: (yargs: Argv) =>
    yargs.option("format", {
      describe: "output format",
      type: "string",
      choices: ["table", "json"],
      default: "table",
    }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const items = await Trigger.list()
      if (!items.length) return
      const output = args.format === "json" ? JSON.stringify(items, null, 2) : formatTriggerTable(items)
      process.stdout.write(output + EOL)
    })
  },
})

export const TriggerCreateCommand = cmd({
  command: "create",
  describe: "create a trigger",
  builder: (yargs: Argv) =>
    yargs
      .option("interval", {
        describe: "interval in milliseconds",
        type: "number",
      })
      .option("at", {
        describe: "one-time fire time as unix milliseconds",
        type: "number",
      })
      .option("session", {
        describe: "session ID for command actions",
        type: "string",
      })
      .option("command", {
        describe: "command to run for command actions",
        type: "string",
      })
      .option("arguments", {
        describe: "arguments for command actions",
        type: "string",
      })
      .option("webhook", {
        describe: "webhook URL for webhook actions",
        type: "string",
      })
      .option("method", {
        describe: "HTTP method for webhook actions",
        type: "string",
        choices: ["GET", "POST", "PUT", "PATCH", "DELETE"],
      })
      .option("body", {
        describe: "HTTP body for webhook actions",
        type: "string",
      })
      .option("webhook-secret", {
        describe: "secret required for external webhook firing",
        type: "string",
      }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const parsed = parseTriggerCreateInput(args as CreateArgs)
      if (typeof parsed === "string") {
        UI.error(parsed)
        process.exit(1)
      }
      const item = await Trigger.create(parsed)
      process.stdout.write(JSON.stringify(item, null, 2) + EOL)
    })
  },
})

const triggerId = (name: string, describe: string) =>
  cmd({
    command: `${name} <id>`,
    describe,
    builder: (yargs: Argv) =>
      yargs.positional("id", {
        describe: "trigger ID",
        type: "string",
        demandOption: true,
      }),
    async handler() {},
  })

export const TriggerFireCommand = { ...triggerId("fire", "fire a trigger now"), handler: runTrigger("fire") }
export const TriggerEnableCommand = { ...triggerId("enable", "enable a trigger"), handler: runTrigger("enable") }
export const TriggerDisableCommand = { ...triggerId("disable", "disable a trigger"), handler: runTrigger("disable") }
export const TriggerDeleteCommand = { ...triggerId("delete", "delete a trigger"), handler: runTrigger("delete") }

function runTrigger(action: "fire" | "enable" | "disable" | "delete") {
  return async (args: { id: string }) => {
    await bootstrap(process.cwd(), async () => {
      if (action === "delete") {
        await Trigger.remove(args.id)
        UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Trigger ${args.id} deleted` + UI.Style.TEXT_NORMAL)
        return
      }

      const item =
        action === "fire"
          ? await Trigger.fire(args.id)
          : action === "enable"
            ? await Trigger.enable(args.id)
            : await Trigger.disable(args.id)
      process.stdout.write(JSON.stringify(item, null, 2) + EOL)
    })
  }
}

export function parseTriggerCreateInput(args: CreateArgs): Trigger.CreateInput | string {
  if (args.interval !== undefined && args.at !== undefined) return "Choose either --interval or --at, not both"
  if (args.interval === undefined && args.at === undefined) return "Provide either --interval or --at"

  if (args.webhook && (args.command || args.session)) {
    return "Choose either a command action (--session + --command) or a webhook action (--webhook)"
  }

  let action: Action | undefined
  if (args.webhook) {
    action = {
      type: "webhook",
      url: args.webhook,
      ...(args.method ? { method: args.method } : {}),
      ...(args.body ? { body: args.body } : {}),
    }
  }

  if (args.command || args.session) {
    if (!args.command || !args.session) return "Command actions require both --session and --command"
    action = {
      type: "command",
      sessionID: SessionID.make(args.session),
      command: args.command,
      ...(args.arguments ? { arguments: args.arguments } : {}),
    }
  }

  if (args.interval !== undefined) {
    const result: Trigger.CreateInput = {
      interval: args.interval,
      ...(action ? { action } : {}),
      ...(args.webhookSecret ? { webhook_secret: args.webhookSecret } : {}),
    }
    return result
  }

  const result: Trigger.CreateInput = {
    schedule: { type: "once", at: args.at! },
    ...(action ? { action } : {}),
    ...(args.webhookSecret ? { webhook_secret: args.webhookSecret } : {}),
  }
  return result
}

export function formatTriggerTable(items: Trigger.Info[]) {
  const lines: string[] = []
  const id = Math.max(12, ...items.map((item) => item.id.length))
  const schedule = Math.max(12, ...items.map((item) => triggerSchedule(item).length))
  const action = Math.max(12, ...items.map((item) => triggerAction(item).length))
  const state = Math.max(8, ...items.map((item) => triggerState(item).length))
  const header = `ID${" ".repeat(id - 2)}  Schedule${" ".repeat(schedule - 8)}  Action${" ".repeat(action - 6)}  State${" ".repeat(state - 5)}  Next`
  lines.push(header)
  lines.push("─".repeat(header.length))
  for (const item of items) {
    lines.push(
      `${item.id.padEnd(id)}  ${triggerSchedule(item).padEnd(schedule)}  ${triggerAction(item).padEnd(action)}  ${triggerState(item).padEnd(state)}  ${Locale.todayTimeOrDateTime(item.time.next)}`,
    )
  }
  return lines.join(EOL)
}

function triggerSchedule(item: Trigger.Info) {
  return item.schedule.type === "interval" ? `every ${item.schedule.interval}ms` : `once @ ${item.schedule.at}`
}

function triggerAction(item: Trigger.Info) {
  if (!item.action) return "none"
  return item.action.type === "command" ? item.action.command : `${item.action.method ?? "GET"} webhook`
}

function triggerState(item: Trigger.Info) {
  if (!item.enabled) return "disabled"
  if (!item.last) return "ready"
  return item.last.status
}
