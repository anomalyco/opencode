import { Effect } from "effect"
import { Channels } from "@/channels"
import { effectCmd, fail } from "../../effect-cmd"

export const ChannelTestCommand = effectCmd({
  command: "test <name>",
  describe: "test connection to a channel",
  builder: (yargs) =>
    yargs.positional("name", {
      type: "string",
      demandOption: true,
      description: "Channel name",
    }),
  handler: Effect.fn("Cli.ChannelTest")(function* (args) {
    const svc = yield* Effect.provide(Channels.Service, Channels.layer)
    const channels = yield* svc.list()
    const channel = channels.find((ch) => ch.name === args.name)
    if (!channel) {
      return yield* fail(`Channel not found: ${args.name}`)
    }
    if (!channel.enabled) {
      console.log(`Channel "${channel.name}" is disabled.`)
      return
    }
    const result = yield* svc.send(channel.id, "test message from opencode").pipe(
      Effect.as("success" as const),
      Effect.catch(() => Effect.succeed("failure" as const)),
    )
    if (result === "success") {
      console.log(`Channel "${channel.name}" (${channel.type}): connection successful`)
    } else {
      console.log(`Channel "${channel.name}" (${channel.type}): connection failed`)
    }
  }),
})
