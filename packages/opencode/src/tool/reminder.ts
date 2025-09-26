import z from "zod/v4"
import { Tool } from "./tool"
import { Reminder } from "../reminder/reminder"
import { ReminderManager } from "../reminder/manager"
import { Identifier } from "../id/id"
import { Instance } from "../project/instance"
import { Config } from "../config/config"

export const AddReminderTool = Tool.define("add_reminder", {
  description:
    "Set up a reminder that will make me re-execute an action later. Use when user asks to 'remind me to...' or 'check X every Y time'. I'll actually perform the action when reminded, not just notify.",
  parameters: z.object({
    interval_seconds: z.number().min(30).describe("Time interval in seconds (minimum 30)"),
    type: z.enum(["one-time", "recurring"]).describe("Whether this reminder runs once or repeatedly"),
    action_prompt: z
      .string()
      .describe("Fully resolved action with absolute paths and specific identifiers - avoid 'this', 'that', 'latest'"),
    description: z.string().describe("Human-readable description for identification when listing/removing"),
  }),
  async execute(args, ctx) {
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
      id: Identifier.ascending("message"),
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

export const ListRemindersTool = Tool.define("list_reminders", {
  description:
    "List all active reminders in this session. Use when user asks 'what reminders do I have' or wants to see scheduled actions.",
  parameters: z.object({}),
  async execute(_, ctx) {
    const reminders = await ReminderManager.list(ctx.sessionID)

    if (reminders.length === 0) {
      return {
        title: "No active reminders",
        output: "No active reminders in this session.",
        metadata: {} as any,
      }
    }

    const output = reminders
      .map((r) => {
        const nextIn = Math.round((r.time.nextExecution - Date.now()) / 1000)
        const nextText = nextIn > 0 ? `in ${nextIn}s` : "overdue"
        return `- ${r.userDescription} (${r.type}, next execution ${nextText})`
      })
      .join("\n")

    return {
      title: `${reminders.length} active reminders`,
      output: `Active reminders:\n${output}`,
      metadata: { count: reminders.length } as any,
    }
  },
})

export const RemoveReminderTool = Tool.define("remove_reminder", {
  description:
    "Cancel a scheduled reminder. Use when user asks to 'stop checking X' or 'cancel the reminder for Y'. Will attempt to match user's description to existing reminders.",
  parameters: z.object({
    description_pattern: z.string().describe("What the user wants to stop (will match against reminder descriptions)"),
  }),
  async execute(args, ctx) {
    const reminders = await ReminderManager.list(ctx.sessionID)
    const pattern = args.description_pattern.toLowerCase()

    const matches = reminders.filter(
      (r) => r.userDescription.toLowerCase().includes(pattern) || r.originalPrompt.toLowerCase().includes(pattern),
    )

    if (matches.length === 0) {
      return {
        title: "No matching reminder found",
        output: `No matching reminder found for "${args.description_pattern}". Active reminders:\n${reminders.map((r) => `- ${r.userDescription}`).join("\n") || "None"}`,
        metadata: {} as any,
      }
    }

    if (matches.length > 1) {
      return {
        title: "Multiple matches found",
        output: `Multiple reminders match "${args.description_pattern}":\n${matches.map((r) => `- ${r.userDescription}`).join("\n")}\nPlease be more specific.`,
        metadata: { matches: matches.length } as any,
      }
    }

    const reminder = matches[0]
    await ReminderManager.cancel(reminder.id)

    return {
      title: "Reminder cancelled",
      output: `Reminder cancelled: ${reminder.userDescription}`,
      metadata: { reminderID: reminder.id } as any,
    }
  },
})
