import { Effect } from "effect"
import { Channels } from "@/channels"
import { effectCmd, fail } from "../../effect-cmd"

export const ChannelAddCommand = effectCmd({
  command: "add <name>",
  describe: "add a new channel configuration",
  builder: (yargs) =>
    yargs
      .positional("name", {
        type: "string",
        demandOption: true,
        description: "Channel name",
      })
      .option("type", {
        type: "string",
        demandOption: true,
        description: "Channel type (slack or discord)",
      })
      .option("url", {
        type: "string",
        demandOption: true,
        description: "Channel webhook URL",
      }),
  handler: Effect.fn("Cli.ChannelAdd")(function* (args) {
    if (args.type !== "slack" && args.type !== "discord") {
      return yield* fail(`Invalid channel type: ${args.type}. Must be "slack" or "discord"`)
    }
    const svc = yield* Effect.provide(Channels.Service, Channels.layer)
    const channel = yield* svc.create({
      type: args.type,
      name: args.name,
      webhook_url: args.url,
    })
    console.log(`Channel added:`)
    console.log(`  name: ${channel.name}`)
    console.log(`  type: ${channel.type}`)
    console.log(`  url: ${channel.webhook_url}`)
    console.log(`  status: ${channel.enabled ? "enabled" : "disabled"}`)
  }),
})
