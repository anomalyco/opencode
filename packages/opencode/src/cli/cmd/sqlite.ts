import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { SqliteStorage } from "../../util/sqlite-storage"
import { ENTITY_TYPES } from "../../storage/sqlite-provider"
import * as prompts from "@clack/prompts"

export const SqliteCommand = cmd({
  command: "sqlite",
  describe: "manage SQLite storage backend",
  builder: (yargs: Argv) =>
    yargs.command(SqliteInitCommand).command(SqliteImportCommand).command(SqliteExportCommand).demandCommand(),
  async handler() {},
})

export const SqliteInitCommand = cmd({
  command: "init",
  describe: "initialize SQLite database",
  builder: (yargs: Argv) =>
    yargs
      .option("force", {
        describe: "overwrite existing database",
        type: "boolean",
        default: false,
      })
      .option("config", {
        describe: "path to sqlite-storage.json config",
        type: "string",
      }),
  handler: async (args) => {
    UI.empty()
    prompts.intro("Initialize SQLite database")

    const storage = await SqliteStorage.create(args.config)
    const dbPath = storage.dbPath()
    const configPath = storage.configPath()

    prompts.log.info(`Using schema: ${configPath}`)
    prompts.log.info(`Database: ${dbPath}`)

    if (await Bun.file(dbPath).exists()) {
      if (!args.force) {
        const confirm = await prompts.confirm({
          message: `Database already exists at ${dbPath}. Overwrite?`,
          initialValue: false,
        })

        if (prompts.isCancel(confirm) || !confirm) {
          throw new UI.CancelledError()
        }
      }

      await Bun.file(dbPath).writer().end()
      await storage.init()
      prompts.log.success(`Database re-initialized at ${dbPath}`)
    } else {
      await storage.init()
      prompts.log.success(`Database created at ${dbPath}`)
    }

    prompts.outro("Done")
  },
})

export const SqliteImportCommand = cmd({
  command: "import",
  describe: "import JSON storage to SQLite",
  builder: (yargs: Argv) =>
    yargs
      .option("config", {
        describe: "path to sqlite-storage.json config",
        type: "string",
      })
      .option("entity", {
        describe: "entity type to import (all if not specified)",
        type: "string",
        choices: ENTITY_TYPES as unknown as string[],
      })
      .option("verbose", {
        describe: "show detailed progress",
        type: "boolean",
        default: false,
      }),
  handler: async (args) => {
    UI.empty()
    prompts.intro("Import JSON storage to SQLite")

    try {
      const storage = await SqliteStorage.create(args.config)
      const dbPath = storage.dbPath()
      const configPath = storage.configPath()

      prompts.log.info(`Using schema: ${configPath}`)
      prompts.log.info(`Database: ${dbPath}`)
      prompts.log.info(`Source: JSON storage`)

      if (!(await Bun.file(dbPath).exists())) {
        prompts.log.error(`Database not found. Run 'opencode sqlite init' first`)
        throw new UI.CancelledError()
      }

      const spinner = prompts.spinner()
      spinner.start("Importing data...")

      const result = await storage.importFromJSON({
        entity: args.entity as any,
        verbose: args.verbose,
        onProgress: (entity, count) => {
          if (args.verbose) {
            spinner.message(`Importing ${entity}: ${count} records`)
          }
        },
      })

      spinner.stop("Import complete")

      prompts.log.success(
        `Imported ${result.message} messages, ${result.part} parts, ${result.session} sessions, ${result.project} projects, ${result.todo} todos`,
      )

      prompts.outro("Done")
    } catch (error) {
      prompts.log.error(`Import failed: ${error instanceof Error ? error.message : String(error)}`)
      if (error instanceof Error && error.stack) {
        console.error(error.stack)
      }
      throw error
    }
  },
})

export const SqliteExportCommand = cmd({
  command: "export",
  describe: "export SQLite storage to JSON",
  builder: (yargs: Argv) =>
    yargs
      .option("config", {
        describe: "path to sqlite-storage.json config",
        type: "string",
      })
      .option("entity", {
        describe: "entity type to export (all if not specified)",
        type: "string",
        choices: ENTITY_TYPES as unknown as string[],
      })
      .option("verbose", {
        describe: "show detailed progress",
        type: "boolean",
        default: false,
      })
      .option("force", {
        describe: "overwrite existing JSON files",
        type: "boolean",
        default: false,
      }),
  handler: async (args) => {
    UI.empty()
    prompts.intro("Export SQLite storage to JSON")

    const storage = await SqliteStorage.create(args.config)
    const dbPath = storage.dbPath()
    const configPath = storage.configPath()

    prompts.log.info(`Using schema: ${configPath}`)
    prompts.log.info(`Database: ${dbPath}`)
    prompts.log.info(`Target: JSON storage`)

    if (!(await Bun.file(dbPath).exists())) {
      prompts.log.error(`Database not found at ${dbPath}`)
      throw new UI.CancelledError()
    }

    const spinner = prompts.spinner()
    spinner.start("Exporting data...")

    const result = await storage.exportToJSON({
      entity: args.entity as any,
      verbose: args.verbose,
      force: args.force,
      onProgress: (entity, count) => {
        if (args.verbose) {
          spinner.message(`Exporting ${entity}: ${count} records`)
        }
      },
    })

    spinner.stop("Export complete")

    prompts.log.success(
      `Exported ${result.message} messages, ${result.part} parts, ${result.session} sessions, ${result.project} projects, ${result.todo} todos`,
    )

    prompts.outro("Done")
  },
})
