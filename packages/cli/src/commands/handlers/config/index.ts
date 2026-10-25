import { cmd } from "../cmd"
import { DiffCommand } from "./diff"
import { DoctorCommand } from "./doctor"
import { GetCommand, SetCommand, UnsetCommand } from "./edit"
import { EditCommand } from "./editor"

export const ConfigCommand = cmd({
  command: "config",
  describe: "inspect and manage configuration",
  builder: (yargs) =>
    yargs
      .command(DiffCommand)
      .command(DoctorCommand)
      .command(EditCommand)
      .command(GetCommand)
      .command(SetCommand)
      .command(UnsetCommand)
      .demandCommand(),
  async handler() {},
})
