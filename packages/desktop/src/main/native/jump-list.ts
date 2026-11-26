import type { JumpListCategory } from "electron"
import { nativeT } from "./translations"

// The taskbar button's right-click tasks. Each runs the app again with its flag, which the running app gets on
// `second-instance`, so a task does what the File menu item of the same name does.
const TASKS = [
  { id: "new-session", flag: "--opencode-task=new-session", labelKey: "desktop.menu.newSession" },
  { id: "new-window", flag: "--opencode-task=new-window", labelKey: "desktop.menu.newWindow" },
] as const

/** Windows shows ten recent entries by default, and the tasks take two. */
const RECENT_LIMIT = 5

export type RecentProject = { readonly name: string; readonly directory: string }

let recentProjects: readonly RecentProject[] = []

const recentListeners = new Set<() => void>()

/** The projects the renderer last used on this computer's server, most recent first. */
export function setRecentProjects(projects: readonly RecentProject[]) {
  const next = projects.slice(0, RECENT_LIMIT)

  if (
    next.length === recentProjects.length &&
    next.every((project, i) => project.name === recentProjects[i]?.name && project.directory === recentProjects[i]?.directory)
  )
    return

  recentProjects = next
  recentListeners.forEach((listener) => listener())
}

export function onRecentProjects(listener: () => void) {
  recentListeners.add(listener)

  return () => void recentListeners.delete(listener)
}

// Each recent project starts the app with an `opencode://open-project` link, which the running app gets on
// `second-instance` and opens as it opens any such link: the project, in a new session. Windows drops the whole
// custom category when it holds an entry the user removed from it, so `removed` (their arguments) are left out.
export function jumpList(program: string, recent = recentProjects, removed: ReadonlySet<string> = new Set()): JumpListCategory[] {
  const tasks: JumpListCategory = {
    type: "tasks",
    items: TASKS.map((task) => ({
      type: "task",
      title: nativeT(task.labelKey),
      description: nativeT(task.labelKey),
      program,
      args: task.flag,
      iconPath: program,
      iconIndex: 0,
    })),
  }

  const items = recent.flatMap((project) => {
    const args = `opencode://open-project?directory=${encodeURIComponent(project.directory)}`

    if (removed.has(args)) return []

    return [{ type: "task" as const, title: project.name, description: project.directory, program, args, iconPath: program, iconIndex: 0 }]
  })

  if (items.length === 0) return [tasks]

  return [{ type: "custom", name: nativeT("desktop.jumpList.recentProjects"), items }, tasks]
}

/** The task a second instance was started for, if any. */
export function jumpTask(argv: readonly string[]) {
  return TASKS.find((task) => argv.includes(task.flag))?.id
}
