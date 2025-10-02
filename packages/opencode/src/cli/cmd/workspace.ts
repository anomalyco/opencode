import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { Workspace } from "../../workspace"
import { UI } from "../ui"

export const WorkspaceCommand = cmd({
  command: "workspace <action>",
  describe: "Manage workspace directories for multi-directory access",
  builder: (yargs: Argv) => {
    return yargs
      .command(
        "add <directory>",
        "Add a directory to the workspace",
        (yargs) => {
          return yargs.positional("directory", {
            describe: "Directory path to add (absolute or relative to worktree)",
            type: "string",
            demandOption: true,
          })
        },
        async (args) => {
          await bootstrap(process.cwd(), async () => {
            const workspace = await Workspace.addDirectory(args.directory as string)
            UI.println(UI.Style.TEXT_SUCCESS_BOLD + `✓ Added ${args.directory} to workspace`)
            UI.println(UI.Style.TEXT_DIM + `  Workspace now includes ${workspace.directories.length} directories`)
          })
        },
      )
      .command(
        "remove <directory>",
        "Remove a directory from the workspace",
        (yargs) => {
          return yargs.positional("directory", {
            describe: "Directory path to remove",
            type: "string",
            demandOption: true,
          })
        },
        async (args) => {
          await bootstrap(process.cwd(), async () => {
            const workspace = await Workspace.removeDirectory(args.directory as string)
            UI.println(UI.Style.TEXT_SUCCESS_BOLD + `✓ Removed ${args.directory} from workspace`)
            if (workspace) {
              UI.println(UI.Style.TEXT_DIM + `  Workspace now includes ${workspace.directories.length} directories`)
            } else {
              UI.println(UI.Style.TEXT_DIM + `  Workspace is now empty`)
            }
          })
        },
      )
      .command(
        "list",
        "List all workspace directories",
        () => {},
        async () => {
          await bootstrap(process.cwd(), async () => {
            const directories = await Workspace.list()
            const allowed = await Workspace.getAllowedDirectories()

            if (allowed.length === 0) {
              UI.println(UI.Style.TEXT_WARNING + "No workspace directories configured")
              return
            }

            UI.println(UI.Style.TEXT_INFO_BOLD + "Workspace directories:")
            UI.println()

            // Show default directories
            UI.println(UI.Style.TEXT_DIM + "Default (always allowed):")
            for (const dir of allowed) {
              if (!directories.includes(dir)) {
                UI.println(UI.Style.TEXT_NORMAL + `  ${dir}`)
              }
            }

            // Show configured directories
            if (directories.length > 0) {
              UI.println()
              UI.println(UI.Style.TEXT_DIM + "Configured:")
              for (const dir of directories) {
                UI.println(UI.Style.TEXT_NORMAL + `  ${dir}`)
              }
            }
          })
        },
      )
      .command(
        "clear",
        "Clear all workspace directories (keeps defaults)",
        () => {},
        async () => {
          await bootstrap(process.cwd(), async () => {
            await Workspace.clear()
            UI.println(UI.Style.TEXT_SUCCESS_BOLD + "✓ Cleared workspace configuration")
            UI.println(UI.Style.TEXT_DIM + "  Only default directories (cwd and worktree) are now allowed")
          })
        },
      )
      .demandCommand(1, "You must specify an action: add, remove, list, or clear")
  },
  handler: () => {},
})
