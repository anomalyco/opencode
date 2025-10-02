import z from "zod/v4"
import { Tool } from "./tool"
import { ReminderManager } from "../reminder/manager"
import DESCRIPTION from "./reminderlist.txt"

const ReminderListParameters = z.object({})

export const ReminderListTool = Tool.define("reminderlist", {
  description: DESCRIPTION,
  parameters: ReminderListParameters,
  async execute(_, ctx) {
    ReminderListParameters.parse(_)
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
