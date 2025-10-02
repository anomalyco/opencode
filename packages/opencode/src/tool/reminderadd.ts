import z from "zod/v4"
import { Tool } from "./tool"
import { Reminder } from "../reminder/reminder"
import { ReminderManager } from "../reminder/manager"
import DESCRIPTION from "./reminderadd.txt"
import { Identifier } from "../id/id"
import { Instance } from "../project/instance"
import { Config } from "../config/config"

const ReminderAddParameters = z.object({
  interval_seconds: z.number().min(30).describe("Time interval in seconds (minimum 30)"),
  type: z.enum(["one-time", "recurring"]).describe("Whether this reminder runs once or repeatedly"),
  action_prompt: z
    .string()
    .describe("Fully resolved action with absolute paths and specific identifiers - avoid 'this', 'that', 'latest'"),
  description: z.string().describe("Human-readable description for identification when listing/removing"),
})

export const ReminderAddTool = Tool.define("reminderadd", {
  description: DESCRIPTION,
  parameters: ReminderAddParameters,
  async execute(args, ctx) {
    // Enforce Zod validation for minimum interval and other params
    ReminderAddParameters.parse(args)
    const config = await Config.get()
    const maxReminders = config.reminders?.max_reminders_per_project ?? 50

    const existing = await ReminderManager.list(ctx.sessionID)
    if (existing.length >= maxReminders) {
      return {
        title: "Reminder limit reached",
        output: `Can't set more reminders, too many reminders already active (${existing.length}/${maxReminders}). Current reminders:\n${existing.map((r) => `- ${r.userDescription}`).join("\n")}`,
        metadata: {} as any,
      }
    }

    const reminder: Reminder.Info = {
      id: Identifier.ascending("reminder"),
      sessionID: ctx.sessionID,
      projectID: Instance.project.id,
      type: args.type,
      interval: args.interval_seconds * 1000,
      originalPrompt: args.action_prompt,
      userDescription: args.description,
      time: {
        created: Date.now(),
        nextExecution: Date.now() + args.interval_seconds * 1000,
      },
      status: "active",
    }

    await ReminderManager.schedule(reminder)

    return {
      title: "Reminder set",
      output: `Reminder set: ${args.description} (${args.type === "one-time" ? "in" : "every"} ${args.interval_seconds} seconds)`,
      metadata: { reminderID: reminder.id } as any,
    }
  },
})
