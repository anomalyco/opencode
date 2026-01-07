import type { Argv } from "yargs"
import { cmd } from "../cmd"
import { UI } from "../../ui"
import * as prompts from "@clack/prompts"
import fs from "fs/promises"
import path from "path"
import { Global } from "../../../global"
import { Project } from "../../../project/project"
import { Storage } from "../../../storage/storage"

async function getSnapshotProjects() {
  const snapshotDir = path.join(Global.Path.data, "snapshot")
  const exists = await fs
    .access(snapshotDir)
    .then(() => true)
    .catch(() => false)
  if (!exists) return []

  const entries = await fs.readdir(snapshotDir, { withFileTypes: true })
  const projectIDs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)

  return projectIDs
}

async function getDirectorySize(dir: string) {
  let total = 0

  const walk = async (current: string) => {
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => [])

    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      if (entry.isFile()) {
        const stat = await fs.stat(full).catch(() => null)
        if (stat) total += stat.size
      }
    }
  }

  await walk(dir)
  return total
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

async function getProjectInfo(projectID: string) {
  const project = await Storage.read<Project.Info>(["project", projectID]).catch(() => null)
  return project
}

const ListCommand = cmd({
  command: "list",
  describe: "list all projects with snapshot sizes",
  builder: (yargs: Argv) => yargs,
  async handler(args) {
    const projectIDs = await getSnapshotProjects()
    if (projectIDs.length === 0) {
      UI.println("No snapshots found")
      return
    }

    UI.empty()
    UI.println(UI.Style.TEXT_DIM + `Snapshots: ${path.join(Global.Path.data, "snapshot")}`)
    UI.empty()

    const snapshotDir = path.join(Global.Path.data, "snapshot")
    const projectInfos = await Promise.all(
      projectIDs.map(async (id) => {
        const dir = path.join(snapshotDir, id)
        const size = await getDirectorySize(dir)
        const info = await getProjectInfo(id)
        const projectPath = info?.worktree
        const projectName = info?.name || path.basename(projectPath || "")
        const lastUpdated = info?.time.updated ? new Date(info.time.updated).toLocaleDateString() : "Unknown"

        return {
          id,
          name: projectName || "(unknown)",
          path: projectPath || "",
          size,
          lastUpdated,
        }
      }),
    )

    projectInfos.sort((a, b) => b.size - a.size)

    const maxIDLength = Math.max(40, ...projectInfos.map((p) => p.id.length))
    const maxNameLength = Math.max(18, ...projectInfos.map((p) => p.name.length))
    const maxSizeLength = Math.max(10, ...projectInfos.map((p) => formatSize(p.size).length))
    const maxDateLength = Math.max(12, ...projectInfos.map((p) => p.lastUpdated.length))

    const header = `${"Project ID".padEnd(maxIDLength)} ${"Name".padEnd(maxNameLength)} ${"Size".padEnd(maxSizeLength)} ${"Last Updated".padEnd(maxDateLength)}`
    UI.println(header)
    UI.println("─".repeat(header.length))

    let totalSize = 0
    for (const project of projectInfos) {
      const id = project.id.length > 40 ? project.id.substring(0, 37) + "..." : project.id
      const name =
        project.name.length > maxNameLength ? project.name.substring(0, maxNameLength - 2) + ".." : project.name
      const sizeStr = formatSize(project.size)
      UI.println(
        `${id.padEnd(maxIDLength)} ${name.padEnd(maxNameLength)} ${sizeStr.padEnd(maxSizeLength)} ${project.lastUpdated.padEnd(maxDateLength)}`,
      )
      totalSize += project.size
    }

    UI.empty()
    UI.println(
      `Total: ${formatSize(totalSize)} across ${projectIDs.length} ${projectIDs.length === 1 ? "project" : "projects"}`,
    )
  },
})

const ClearCommand = cmd({
  command: "clear [project-id]",
  describe: "clear snapshots (all projects by default)",
  builder: (yargs: Argv) =>
    yargs
      .positional("project-id", {
        describe: "project ID to clear (omit for all)",
        type: "string",
      })
      .option("all", {
        alias: "a",
        type: "boolean",
        default: true,
        describe: "clear all snapshots",
        hidden: true,
      })
      .option("force", {
        alias: "f",
        type: "boolean",
        default: false,
        describe: "skip confirmation",
      })
      .option("dry-run", {
        type: "boolean",
        default: false,
        describe: "show what would be deleted without deleting",
      }),
  async handler(args) {
    const snapshotDir = path.join(Global.Path.data, "snapshot")
    const allProjects = await getSnapshotProjects()

    if (allProjects.length === 0) {
      UI.println("No snapshots found")
      return
    }

    let projectsToClear: string[] = []

    if (args["project-id"]) {
      projectsToClear = [args["project-id"]]
      const exists = allProjects.includes(args["project-id"])
      if (!exists) {
        UI.error(`Project ID not found: ${args["project-id"]}`)
        return
      }
    } else {
      projectsToClear = allProjects
    }

    const projectInfos = await Promise.all(
      projectsToClear.map(async (id) => {
        const dir = path.join(snapshotDir, id)
        const size = await getDirectorySize(dir)
        const info = await getProjectInfo(id)
        const projectName = info?.name || path.basename(info?.worktree || "") || "(unknown)"
        return { id, name: projectName, size }
      }),
    )

    if (args["dry-run"]) {
      UI.empty()
      UI.println("Would delete:")
      let totalSize = 0
      for (const project of projectInfos) {
        UI.println(`  • ${project.id.substring(0, 8)}... (${project.name}) - ${formatSize(project.size)}`)
        totalSize += project.size
      }
      UI.empty()
      UI.println(`Total: ${formatSize(totalSize)}`)
      return
    }

    let totalSize = 0
    for (const project of projectInfos) {
      totalSize += project.size
    }

    const count = projectsToClear.length
    const countStr = `${count} snapshot ${count === 1 ? "directory" : "directories"}`
    const projectsStr = projectsToClear.length === 1 ? `for ${projectInfos[0].id.substring(0, 8)}...` : ""

    UI.empty()
    UI.println(`This will delete ${countStr} ${projectsStr} (${formatSize(totalSize)}):`)

    for (const project of projectInfos) {
      const shortID = project.id.length > 12 ? project.id.substring(0, 12) + "..." : project.id
      UI.println(`  • ${shortID} (${project.name}) - ${formatSize(project.size)}`)
    }

    if (!args.force) {
      const confirm = await prompts.confirm({
        message: "Confirm",
        initialValue: false,
      })
      if (!confirm || prompts.isCancel(confirm)) {
        UI.println("Cancelled")
        return
      }
    }

    const spinner = prompts.spinner()
    const errors: string[] = []

    for (const project of projectInfos) {
      const dir = path.join(snapshotDir, project.id)
      spinner.start(`Clearing ${project.id.substring(0, 8)}...`)
      const err = await fs.rm(dir, { recursive: true, force: true }).catch((e) => e)
      if (err) {
        spinner.stop(`Failed to clear ${project.id.substring(0, 8)}`, 1)
        errors.push(`${project.id}: ${err.message}`)
        continue
      }
      spinner.stop(`Cleared ${project.id.substring(0, 8)}`)
    }

    if (errors.length > 0) {
      UI.empty()
      UI.println("Some operations failed:")
      for (const err of errors) {
        UI.println(`  ${err}`)
      }
    }

    UI.empty()
    UI.println(
      `${UI.Style.TEXT_SUCCESS_BOLD}✓${UI.Style.TEXT_NORMAL} Cleared ${count} ${count === 1 ? "snapshot directory" : "snapshot directories"} (${formatSize(totalSize)} freed)`,
    )
  },
})

export const SnapshotCommand = cmd({
  command: "snapshot",
  describe: "manage project snapshots",
  builder: (yargs: Argv) => yargs.command(ListCommand).command(ClearCommand).demandCommand(),
  async handler() {},
})
