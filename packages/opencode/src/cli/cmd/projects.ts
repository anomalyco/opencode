import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { Storage } from "../../storage/storage"
import { Project } from "../../project/project"
import { Session } from "../../session"
import { access } from "fs/promises"

interface ProjectStats {
  project: Project.Info
  sessionCount: number
  lastActive: number | null
  worktreeExists: boolean
}

export const ProjectsCommand = cmd({
  command: "projects",
  describe: "list all projects with conversation counts",
  builder: (yargs: Argv) => {
    return yargs
      .option("sort", {
        describe: "sort by: path, count, activity (default: activity)",
        type: "string",
        choices: ["path", "count", "activity"],
        default: "activity",
      })
      .option("limit", {
        describe: "limit number of projects to show",
        type: "number",
      })
      .option("active-only", {
        describe: "show only projects with sessions",
        type: "boolean",
        default: true,
      })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const stats = await aggregateProjectStats(args)
      displayProjectStats(stats, args)
    })
  },
})

async function aggregateProjectStats(args: {
  sort?: string
  limit?: number
  activeOnly?: boolean
}): Promise<ProjectStats[]> {
  const projects = await Project.list()
  const stats: ProjectStats[] = []

  // Show progress for large datasets
  if (projects.length > 50) {
    console.log(`Processing ${projects.length} projects...`)
  }

  // Process in batches for performance
  const BATCH_SIZE = 10
  for (let i = 0; i < projects.length; i += BATCH_SIZE) {
    const batch = projects.slice(i, i + BATCH_SIZE)

    const batchStats = await Promise.all(
      batch.map(async (project) => {
        if (!project) return null

        // Get session keys for this project
        const sessionKeys = await Storage.list(["session", project.id])

        // Find most recent session activity
        let lastActive: number | null = null
        if (sessionKeys.length > 0) {
          // Read sessions to find the latest time.updated
          const sessions = await Promise.all(
            sessionKeys.map((key) => Storage.read<Session.Info>(key).catch(() => null)),
          )

          for (const session of sessions) {
            if (session && session.time.updated) {
              lastActive = !lastActive ? session.time.updated : Math.max(lastActive, session.time.updated)
            }
          }
        }

        // Check if worktree still exists
        const worktreeExists = await access(project.worktree)
          .then(() => true)
          .catch(() => false)

        return {
          project,
          sessionCount: sessionKeys.length,
          lastActive,
          worktreeExists,
        }
      }),
    )

    stats.push(...(batchStats.filter((x) => x !== null) as ProjectStats[]))
  }

  // Filter based on active-only flag
  let filtered = args.activeOnly ? stats.filter((s) => s.sessionCount > 0) : stats

  // Sort
  filtered.sort((a, b) => {
    switch (args.sort) {
      case "path":
        return a.project.worktree.localeCompare(b.project.worktree)
      case "count":
        return b.sessionCount - a.sessionCount
      case "activity":
      default:
        if (!a.lastActive) return 1
        if (!b.lastActive) return -1
        return b.lastActive - a.lastActive
    }
  })

  // Apply limit
  if (args.limit) {
    filtered = filtered.slice(0, args.limit)
  }

  return filtered
}

function displayProjectStats(stats: ProjectStats[], args: { limit?: number }) {
  const width = 79

  function renderRow(path: string, sessions: string, lastActive: string): string {
    // Path: 40 chars, Sessions: 12 chars, Last Active: 20 chars
    const pathFormatted = formatPath(path, 40).padEnd(40)
    const sessionsFormatted = sessions.padStart(8)
    const lastActiveFormatted = lastActive.padEnd(20)
    return `│ ${pathFormatted}  ${sessionsFormatted}    ${lastActiveFormatted} │`
  }

  // Header
  console.log("┌" + "─".repeat(width - 2) + "┐")
  console.log("│" + "PROJECTS".padStart(41).padEnd(width - 2) + "│")
  console.log("├" + "─".repeat(width - 2) + "┤")
  console.log(renderRow("Path", "Sessions", "Last Active"))
  console.log("├" + "─".repeat(width - 2) + "┤")

  // Body
  if (stats.length === 0) {
    const emptyMsg = "No projects found"
    const padding = Math.floor((width - 2 - emptyMsg.length) / 2)
    console.log("│" + " ".repeat(padding) + emptyMsg + " ".repeat(width - 2 - padding - emptyMsg.length) + "│")
  } else {
    let totalSessions = 0
    for (const stat of stats) {
      totalSessions += stat.sessionCount

      let path = stat.project.worktree
      if (path === "/") path = "/ (global)"
      if (!stat.worktreeExists) path += " [deleted]"

      const sessionsStr = stat.sessionCount.toString()
      const lastActiveStr = stat.lastActive
        ? new Date(stat.lastActive).toLocaleString("en-US", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "never"

      console.log(renderRow(path, sessionsStr, lastActiveStr))
    }

    // Footer
    console.log("└" + "─".repeat(width - 2) + "┘")
    console.log()
    console.log(`Total: ${stats.length} projects, ${totalSessions} sessions`)
    console.log()
    return
  }

  console.log("└" + "─".repeat(width - 2) + "┘")
  console.log()
}

function formatPath(path: string, maxLength: number): string {
  if (path.length <= maxLength) return path

  // Truncate in middle: /Users/.../path/to/project
  const ellipsis = "..."
  const keepStart = Math.floor((maxLength - ellipsis.length) / 2)
  const keepEnd = maxLength - ellipsis.length - keepStart

  return path.slice(0, keepStart) + ellipsis + path.slice(-keepEnd)
}
