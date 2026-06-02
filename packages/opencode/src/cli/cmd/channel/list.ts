import { Effect } from "effect"
import { Channels } from "@/channels"
import { effectCmd } from "../../effect-cmd"

export const ChannelListCommand = effectCmd({
  command: "list",
  describe: "list configured channels",
  builder: (yargs) => yargs,
  handler: Effect.fn("Cli.ChannelList")(function* () {
    const svc = yield* Effect.provide(Channels.Service, Channels.layer)
    const channels = yield* svc.list()
    if (channels.length === 0) {
      console.log("No channels configured.")
      return
    }
    for (const ch of channels) {
      const status = ch.enabled ? "enabled" : "disabled"
      console.log(`${ch.name} type=${ch.type} status=${status} url=${ch.webhook_url}`)
    }
  }),
})
