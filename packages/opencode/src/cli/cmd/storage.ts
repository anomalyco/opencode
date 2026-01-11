import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { Storage } from "../../storage/storage"

export const StorageCommand = cmd({
  command: "storage",
  describe: "manage storage",
  builder: (yargs: Argv) => yargs.command(StorageRepairCommand).demandCommand(),
  async handler() {},
})

export const StorageRepairCommand = cmd({
  command: "repair",
  describe: "scan storage, quarantine invalid JSON and clean temp files",
  builder: (yargs: Argv) => yargs,
  handler: async () => {
    await bootstrap(process.cwd(), async () => {
      const result = await Storage.repair()
      console.log(
        JSON.stringify(
          {
            quarantined: result.quarantined,
            tempRemoved: result.tempRemoved,
            quarantineRoot: result.quarantineRoot,
          },
          null,
          2,
        ),
      )
    })
  },
})
