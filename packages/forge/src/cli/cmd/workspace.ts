import type { Argv } from "yargs"
import * as prompts from "@clack/prompts"
import { cmd } from "./cmd"
import { Workspace } from "../../workspace"
import { UI } from "../ui"
import os from "os"

export const WorkspaceCommand = cmd({
  command: "workspace",
  describe: "manage workspaces",
  builder: (yargs) =>
    yargs.command(WorkspaceListCommand).command(WorkspaceDeleteCommand).demandCommand(),
  async handler() {},
})

export const WorkspaceListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list all workspaces",
  builder: (yargs: Argv) => yargs,
  async handler() {
    UI.empty()

    const workspacesByRepo = await Workspace.listAll()

    if (workspacesByRepo.size === 0) {
      prompts.log.info("No workspaces found")
      return
    }

    let totalCount = 0

    // Display workspaces grouped by repo
    for (const [_repoID, workspaces] of workspacesByRepo) {
      if (workspaces.length === 0) continue

      // Use the repoRoot from the first workspace since all workspaces in this group share the same repo
      const repoPath = workspaces[0].repoRoot

      // Show repo header
      const displayPath = formatPath(repoPath)
      prompts.intro(`${UI.Style.TEXT_HIGHLIGHT}${displayPath}${UI.Style.TEXT_NORMAL}`)

      // Display workspaces for this repo
      for (const workspace of workspaces) {
        const lastAccessed = formatRelativeTime(workspace.time.accessed)
        const worktreePath = formatPath(workspace.worktreePath)

        prompts.log.info(
          `${UI.Style.TEXT_NORMAL_BOLD}${workspace.name}${UI.Style.TEXT_NORMAL} ` +
            `${UI.Style.TEXT_DIM}(${workspace.branch})${UI.Style.TEXT_NORMAL}\n` +
            `  ${UI.Style.TEXT_DIM}Path: ${worktreePath}${UI.Style.TEXT_NORMAL}\n` +
            `  ${UI.Style.TEXT_DIM}Last accessed: ${lastAccessed}${UI.Style.TEXT_NORMAL}`,
        )
        totalCount++
      }

      UI.empty()
    }

    prompts.outro(`${totalCount} workspace${totalCount === 1 ? "" : "s"}`)
  },
})

export const WorkspaceDeleteCommand = cmd({
  command: "delete <name>",
  aliases: ["rm", "remove"],
  describe: "delete a workspace",
  builder: (yargs: Argv) =>
    yargs
      .positional("name", {
        describe: "workspace name to delete",
        type: "string",
        demandOption: true,
      })
      .option("force", {
        alias: "f",
        describe: "skip confirmation prompt",
        type: "boolean",
        default: false,
      }),
  async handler(args) {
    UI.empty()

    const workspaceName = args.name as string

    // Find the workspace across all repos
    const workspacesByRepo = await Workspace.listAll()
    let foundWorkspace: Workspace.Info | null = null

    for (const workspaces of workspacesByRepo.values()) {
      const match = workspaces.find((w) => w.name === workspaceName)
      if (match) {
        foundWorkspace = match
        break
      }
    }

    if (!foundWorkspace) {
      prompts.log.error(`Workspace "${workspaceName}" not found`)
      process.exit(1)
    }

    // Show workspace details
    prompts.intro(`Delete workspace: ${UI.Style.TEXT_HIGHLIGHT}${foundWorkspace.name}${UI.Style.TEXT_NORMAL}`)
    prompts.log.info(
      `${UI.Style.TEXT_DIM}Branch: ${foundWorkspace.branch}${UI.Style.TEXT_NORMAL}\n` +
        `${UI.Style.TEXT_DIM}Path: ${formatPath(foundWorkspace.worktreePath)}${UI.Style.TEXT_NORMAL}`,
    )

    // Confirm deletion unless --force is used
    if (!args.force) {
      const confirmed = await prompts.confirm({
        message: "This will remove the worktree, branch, and all associated sessions. Continue?",
      })

      if (prompts.isCancel(confirmed) || !confirmed) {
        prompts.outro("Cancelled")
        return
      }
    }

    // Perform deletion
    const spinner = prompts.spinner()
    spinner.start("Removing workspace...")

    try {
      await Workspace.remove(foundWorkspace.id)
      spinner.stop("Workspace removed")
      prompts.outro("Done")
    } catch (e) {
      spinner.stop("Failed to remove workspace", 1)
      if (e instanceof Error) {
        prompts.log.error(e.message)
      }
      process.exit(1)
    }
  },
})

/**
 * Format a path for display, replacing home directory with ~
 */
function formatPath(filePath: string): string {
  const homedir = os.homedir()
  if (filePath.startsWith(homedir)) {
    return filePath.replace(homedir, "~")
  }
  return filePath
}

/**
 * Format a timestamp as relative time (e.g., "2 hours ago")
 */
function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp

  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) {
    return `${days} day${days === 1 ? "" : "s"} ago`
  }
  if (hours > 0) {
    return `${hours} hour${hours === 1 ? "" : "s"} ago`
  }
  if (minutes > 0) {
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`
  }
  return "just now"
}
