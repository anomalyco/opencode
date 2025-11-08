import type { Argv } from "yargs"
import { UI } from "../ui"
import { RichUI } from "../rich-ui"
import { cmd } from "./cmd"
import { Aliases } from "../aliases"
import { text, confirm } from "@clack/prompts"

export const AliasCommand = cmd({
  command: "alias",
  describe: "manage command aliases",
  builder: (yargs: Argv) => {
    return yargs
      .command({
        command: "list",
        describe: "list all aliases",
        handler: async () => {
          const aliases = await Aliases.list()

          if (aliases.length === 0) {
            UI.println("No aliases configured")
            return
          }

          UI.println()
          UI.println(UI.Style.TEXT_HIGHLIGHT_BOLD + "Available Aliases" + UI.Style.TEXT_NORMAL)
          UI.println()

          // Separate built-in and custom
          const builtIn = aliases.filter((a) => !a.custom)
          const custom = aliases.filter((a) => a.custom)

          if (builtIn.length > 0) {
            UI.println(UI.Style.TEXT_DIM + "Built-in:" + UI.Style.TEXT_NORMAL)
            const headers = ["Alias", "Command", "Description"]
            const rows = builtIn.map((a) => [
              UI.Style.TEXT_HIGHLIGHT + a.name + UI.Style.TEXT_NORMAL,
              UI.Style.TEXT_DIM + a.command + UI.Style.TEXT_NORMAL,
              a.description,
            ])
            UI.println(RichUI.table(headers, rows))
            UI.println()
          }

          if (custom.length > 0) {
            UI.println(UI.Style.TEXT_DIM + "Custom:" + UI.Style.TEXT_NORMAL)
            const headers = ["Alias", "Command", "Description"]
            const rows = custom.map((a) => [
              UI.Style.TEXT_SUCCESS + a.name + UI.Style.TEXT_NORMAL,
              UI.Style.TEXT_DIM + a.command + UI.Style.TEXT_NORMAL,
              a.description,
            ])
            UI.println(RichUI.table(headers, rows))
            UI.println()
          }

          UI.println(UI.Style.TEXT_DIM + "Usage: opencode <alias> [args]" + UI.Style.TEXT_NORMAL)
          UI.println()
        },
      })
      .command({
        command: "add <name> <command>",
        describe: "add a new alias",
        builder: (yargs: Argv) =>
          yargs
            .positional("name", {
              describe: "alias name",
              type: "string",
            })
            .positional("command", {
              describe: "command to alias",
              type: "string",
            })
            .option("description", {
              alias: "d",
              describe: "alias description",
              type: "string",
            }),
        handler: async (args) => {
          const name = args.name as string
          const command = args.command as string
          const description = args.description as string | undefined

          // Check if alias already exists
          if (await Aliases.isAlias(name)) {
            const overwrite = await confirm({
              message: `Alias '${name}' already exists. Overwrite?`,
              initialValue: false,
            })

            if (!overwrite) {
              UI.println("Cancelled")
              return
            }
          }

          await Aliases.add(name, command, description)
          UI.println(
            `${UI.Style.TEXT_SUCCESS}${RichUI.Icons.success}${UI.Style.TEXT_NORMAL} Alias '${UI.Style.TEXT_HIGHLIGHT}${name}${UI.Style.TEXT_NORMAL}' created`,
          )
          UI.println(`  ${UI.Style.TEXT_DIM}${command}${UI.Style.TEXT_NORMAL}`)
        },
      })
      .command({
        command: "remove <name>",
        describe: "remove an alias",
        builder: (yargs: Argv) =>
          yargs.positional("name", {
            describe: "alias name",
            type: "string",
          }),
        handler: async (args) => {
          const name = args.name as string

          if (!(await Aliases.isAlias(name))) {
            UI.error(`Alias '${name}' not found`)
            return
          }

          // Check if it's a built-in alias
          if (name in Aliases.BUILT_IN) {
            UI.error(`Cannot remove built-in alias '${name}'`)
            return
          }

          const confirm_remove = await confirm({
            message: `Remove alias '${name}'?`,
            initialValue: true,
          })

          if (!confirm_remove) {
            UI.println("Cancelled")
            return
          }

          await Aliases.remove(name)
          UI.println(
            `${UI.Style.TEXT_SUCCESS}${RichUI.Icons.success}${UI.Style.TEXT_NORMAL} Alias '${name}' removed`,
          )
        },
      })
      .demandCommand(1, "Please specify a subcommand: list, add, or remove")
  },
  handler: async () => {
    // Default to list if no subcommand
    const aliases = await Aliases.list()
    UI.println()
    UI.println(
      UI.Style.TEXT_HIGHLIGHT_BOLD +
        `${aliases.length} aliases configured` +
        UI.Style.TEXT_NORMAL,
    )
    UI.println()
    UI.println("Run " + UI.Style.TEXT_HIGHLIGHT + "opencode alias list" + UI.Style.TEXT_NORMAL + " to see all aliases")
    UI.println()
  },
})
