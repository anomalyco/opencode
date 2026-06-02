import { Effect } from "effect"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "channels.slack" })

export const sendSlack = Effect.fn("Channels.sendSlack")(function* (webhookURL: string, message: string) {
  const response = yield* Effect.promise(() =>
    fetch(webhookURL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message }),
    }),
  )
  if (!response.ok) {
    const body = yield* Effect.promise(() => response.text())
    log.error("slack send failed", { status: response.status, body })
  }
})
