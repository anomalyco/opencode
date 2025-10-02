import z from "zod/v4"
import { Tool } from "./tool"
import { ReminderManager } from "../reminder/manager"
import DESCRIPTION from "./reminderremove.txt"

const ReminderRemoveParameters = z.object({
  description_pattern: z.string().describe("What the user wants to stop (will match against reminder descriptions)"),
})

export const ReminderRemoveTool = Tool.define("reminderremove", {
  description: DESCRIPTION,
  parameters: ReminderRemoveParameters,
  async execute(args, ctx) {
    ReminderRemoveParameters.parse(args)
    const reminders = await ReminderManager.list(ctx.sessionID)
    const pattern = args.description_pattern.toLowerCase()

    const matches = reminders.filter(
      (r) => r.userDescription.toLowerCase().includes(pattern) || r.originalPrompt.toLowerCase().includes(pattern),
    )

    if (matches.length === 0) {
      return {
        title: "No matching reminder found",
        output: `No matching reminder found for \"${args.description_pattern}\". Active reminders:\n${reminders.map((r) => `- ${r.userDescription}`).join("\n") || "None"}`,
        metadata: {} as any,
      }
    }

    if (matches.length > 1) {
      return {
        title: "Multiple matches found",
        output: `Multiple reminders match \"${args.description_pattern}\":\n${matches.map((r) => `- ${r.userDescription}`).join("\n")}\nPlease be more specific.`,
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
