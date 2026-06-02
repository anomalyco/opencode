import { Effect } from "effect"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "channels.discord" })

export const sendDiscord = Effect.fn("Channels.sendDiscord")(function* (webhookURL: string, message: string) {
  const response = yield* Effect.promise(() =>
    fetch(webhookURL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message }),
    }),
  )
  if (!response.ok) {
    const body = yield* Effect.promise(() => response.text())
    log.error("discord send failed", { status: response.status, body })
  }
})
