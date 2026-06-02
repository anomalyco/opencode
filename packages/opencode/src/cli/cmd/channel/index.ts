import { cmd } from "../cmd"
import { ChannelListCommand } from "./list"
import { ChannelTestCommand } from "./test"
import { ChannelAddCommand } from "./add"
import { ChannelRemoveCommand } from "./remove"

export const ChannelCommand = cmd({
  command: "channel",
  describe: "channel management",
  builder: (yargs) =>
    yargs
      .command(ChannelListCommand)
      .command(ChannelTestCommand)
      .command(ChannelAddCommand)
      .command(ChannelRemoveCommand)
      .demandCommand(),
  async handler() {},
})

export * as Channel from "."
