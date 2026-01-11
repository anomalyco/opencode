import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { Storage } from "../../storage/storage"

export const StorageCommand = cmd({
  command: "storage",
  describe: "manage storage",
  builder: (yargs: Argv) => yargs.command(StorageRepairCommand).command(StorageRestoreCommand).demandCommand(),
  async handler() {},
})

export const StorageRepairCommand = cmd({
  command: "repair",
  describe: "scan storage, quarantine invalid JSON and clean temp files",
  builder: (yargs: Argv) =>
    yargs
      .option("dry-run", {
        type: "boolean",
        describe: "do not modify files, only report actions",
        default: false,
      })
      .option("prefix", {
        type: "array",
        describe: "limit scan to a subpath prefix",
      })
      .option("max-files", {
        type: "number",
        describe: "maximum number of files to process",
      })
      .option("max-mib", {
        type: "number",
        describe: "maximum total megabytes to process",
      })
      .option("report", {
        type: "string",
        describe: "write a JSON report to the given path",
      }),
  handler: async (argv: any) => {
    await bootstrap(process.cwd(), async () => {
      const result = await Storage.repair({
        dryRun: !!argv["dry-run"],
        prefix: (argv.prefix as string[] | undefined)?.map(String),
        maxFiles: argv["max-files"] ? Number(argv["max-files"]) : undefined,
        maxMiB: argv["max-mib"] ? Number(argv["max-mib"]) : undefined,
        reportPath: argv.report as string | undefined,
      })
      console.log(
        JSON.stringify(
          {
            quarantined: result.quarantined,
            tempRemoved: result.tempRemoved,
            quarantineRoot: result.quarantineRoot,
            skippedLocked: result.skippedLocked,
            reportPath: result.reportPath,
          },
          null,
          2,
        ),
      )
    })
  },
})

export const StorageRestoreCommand = cmd({
  command: "restore <path>",
  describe: "restore quarantined files back to storage",
  builder: (yargs: Argv) =>
    yargs
      .positional("path", { describe: "path to a quarantined file or directory", type: "string" })
      .option("dry-run", { type: "boolean", describe: "do not move files, only report", default: false }),
  handler: async (argv: any) => {
    await bootstrap(process.cwd(), async () => {
      const result = await Storage.restore({ path: argv.path as string, dryRun: !!argv["dry-run"] })
      console.log(
        JSON.stringify(
          {
            restored: result.restored,
            skippedLocked: result.skippedLocked,
            files: result.files,
          },
          null,
          2,
        ),
      )
    })
  },
})
