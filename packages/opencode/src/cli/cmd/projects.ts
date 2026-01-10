import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { Storage } from "../../storage/storage"
import { Project } from "../../project/project"
import { Session } from "../../session"
import { Locale } from "../../util/locale"
import { UI } from "../ui"
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
    UI.println(`Processing ${projects.length} projects...`)
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
        // Read sessions in small batches to avoid overwhelming the filesystem
        const SESSION_BATCH_SIZE = 20
        const sessions: (Session.Info | null)[] = []

        // Find most recent session activity
        let lastActive: number | null = null
        if (sessionKeys.length > 0) {
          // Read sessions to find the latest time.updated
          for (let j = 0; j < sessionKeys.length; j += SESSION_BATCH_SIZE) {
            const sessionBatchKeys = sessionKeys.slice(j, j + SESSION_BATCH_SIZE)
            const sessionBatch = await Promise.all(
              sessionBatchKeys.map((key) => Storage.read<Session.Info>(key).catch(() => null)),
            )
            sessions.push(...sessionBatch)
          }

          for (const session of sessions) {
            if (session && session.time.updated) {
              lastActive = Math.max(lastActive ?? 0, session.time.updated)
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

export function displayProjectStats(
  stats: ProjectStats[],
  args: { limit?: number },
  write: (...message: string[]) => void = UI.println,
  options?: { width?: number },
) {
  const width = clampWidth(options?.width ?? process.stdout.columns ?? 100)

  const sessionsWidth = Math.max("Sessions".length, ...stats.map((s) => s.sessionCount.toString().length), 1)
  const lastActiveValues = stats.map((s) => (s.lastActive ? Locale.todayTimeOrDateTime(s.lastActive) : "never"))
  const lastActiveWidth = Math.max("Last Active".length, ...lastActiveValues.map((v) => v.length), 1)
  const paddingWidth = 8 // borders + inter-column spaces
  const pathWidth = Math.max(10, width - sessionsWidth - lastActiveWidth - paddingWidth)

  function renderRow(path: string, sessions: string, lastActive: string) {
    const pathLines = wrapText(path, pathWidth)
    const rows: string[] = []

    for (let i = 0; i < pathLines.length; i++) {
      const pathPart = pathLines[i].padEnd(pathWidth)
      const sessionsPart = i === 0 ? sessions.padStart(sessionsWidth) : "".padStart(sessionsWidth)
      const lastActivePart = i === 0 ? lastActive.padEnd(lastActiveWidth) : "".padEnd(lastActiveWidth)
      rows.push(`│ ${pathPart}  ${sessionsPart}  ${lastActivePart} │`)
    }

    return rows
  }

  // Header
  write("┌" + "─".repeat(width - 2) + "┐")
  write("│" + "PROJECTS".padStart(Math.floor((width - 2 + "PROJECTS".length) / 2)).padEnd(width - 2) + "│")
  write("├" + "─".repeat(width - 2) + "┤")
  renderRow("Path", "Sessions", "Last Active").forEach((line) => write(line))
  write("├" + "─".repeat(width - 2) + "┤")

  // Body
  if (stats.length === 0) {
    const emptyMsg = "No projects found"
    const padding = Math.max(0, Math.floor((width - 2 - emptyMsg.length) / 2))
    write("│" + " ".repeat(padding) + emptyMsg + " ".repeat(width - 2 - padding - emptyMsg.length) + "│")
  } else {
    let totalSessions = 0
    for (let index = 0; index < stats.length; index++) {
      const stat = stats[index]
      totalSessions += stat.sessionCount

      let path = stat.project.worktree
      if (path === "/") path = "/ (global)"
      if (!stat.worktreeExists) path += " [deleted]"

      const sessionsStr = stat.sessionCount.toString()
      const lastActiveStr = lastActiveValues[index] ?? "never"

      renderRow(path, sessionsStr, lastActiveStr).forEach((line) => write(line))
    }

    // Footer
    write("└" + "─".repeat(width - 2) + "┘")
    write("")
    write(`Total: ${stats.length} projects, ${totalSessions} sessions`)
    write("")
    return
  }

  write("└" + "─".repeat(width - 2) + "┘")
  write("")
}

function clampWidth(input: number) {
  const min = 80
  const max = 120
  if (!Number.isFinite(input)) return 100
  return Math.min(max, Math.max(min, Math.floor(input)))
}

function wrapText(text: string, width: number): string[] {
  if (width <= 0) return [text]
  const lines: string[] = []
  let remaining = text

  while (remaining.length > 0) {
    if (remaining.length <= width) {
      lines.push(remaining)
      break
    }

    const candidate = remaining.slice(0, width)

    // Prefer to break on path separators, then on spaces, within the width.
    let breakIndex = candidate.lastIndexOf("/")
    if (breakIndex <= 0) {
      breakIndex = candidate.lastIndexOf(" ")
    }

    if (breakIndex > 0) {
      // Include the separator/space in the current line to avoid dropping characters.
      const line = remaining.slice(0, breakIndex + 1)
      lines.push(line)
      remaining = remaining.slice(breakIndex + 1)
    } else {
      // Fallback: hard wrap at the specified width.
      lines.push(candidate)
      remaining = remaining.slice(width)
    }
  }
  return lines.length ? lines : [text]
}
