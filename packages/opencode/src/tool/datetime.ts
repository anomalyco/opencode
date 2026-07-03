import { Effect, Schema } from "effect"
import * as Tool from "./tool"

const DESCRIPTION = [
  "Get the REAL current date and time of the machine opencode is running on.",
  "",
  "Use this whenever the user asks about the current time/date, \"today\", \"now\", deadlines,",
  "elapsed time, scheduling, or timezone conversions. Do NOT guess the time from memory.",
  "",
  "Returns: ISO timestamp (UTC), Unix epoch, the machine's IANA timezone, local time, and",
  "(if 'timezone' is given) the same instant rendered in that timezone.",
].join("\n")

export const Parameters = Schema.Struct({
  timezone: Schema.optional(Schema.String).annotate({
    description: "Optional IANA timezone to also display, e.g. 'America/New_York', 'Europe/Madrid', 'Asia/Tokyo'.",
  }),
})

export const DatetimeTool = Tool.define(
  "datetime",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const now = new Date()
          const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone
          const fmt = (tz?: string) =>
            new Intl.DateTimeFormat("en-CA", {
              dateStyle: "full",
              timeStyle: "long",
              ...(tz ? { timeZone: tz } : {}),
            }).format(now)

          const lines = [
            `ISO (UTC):     ${now.toISOString()}`,
            `Unix epoch:    ${Math.floor(now.getTime() / 1000)}`,
            `Machine TZ:    ${localTz}`,
            `Local time:    ${fmt()}`,
          ]

          if (params.timezone) {
            try {
              lines.push(`${params.timezone}: ${fmt(params.timezone)}`)
            } catch {
              lines.push(`Invalid timezone "${params.timezone}" (use an IANA name like 'Europe/Madrid').`)
            }
          }

          return {
            title: "current date/time",
            metadata: { timezone: localTz },
            output: lines.join("\n"),
          }
        }),
    }
  }),
)
