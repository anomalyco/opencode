import { Effect } from "effect"
import { Channels } from "@/channels"
import { effectCmd, fail } from "../../effect-cmd"

export const ChannelRemoveCommand = effectCmd({
  command: "remove <name>",
  describe: "remove a channel configuration",
  builder: (yargs) =>
    yargs
      .positional("name", {
        type: "string",
        demandOption: true,
        description: "Channel name",
      })
      .option("force", {
        type: "boolean",
        default: false,
        description: "Skip confirmation",
      }),
  handler: Effect.fn("Cli.ChannelRemove")(function* (args) {
    const svc = yield* Effect.provide(Channels.Service, Channels.layer)
    const channels = yield* svc.list()
    const channel = channels.find((ch) => ch.name === args.name)
    if (!channel) {
      return yield* fail(`Channel not found: ${args.name}`)
    }
    if (!args.force) {
      console.log(`Remove channel "${channel.name}" (${channel.type})? Use --force to skip confirmation.`)
      return
    }
    yield* svc.remove(channel.id)
    console.log(`Channel "${channel.name}" removed.`)
  }),
})
