import type { JumpListCategory } from "electron"
import { nativeT } from "./translations"

// The taskbar button's right-click tasks. Each runs the app again with its flag, which the running app gets on
// `second-instance`, so a task does what the File menu item of the same name does.
const TASKS = [
  { id: "new-session", flag: "--opencode-task=new-session", labelKey: "desktop.menu.newSession" },
  { id: "new-window", flag: "--opencode-task=new-window", labelKey: "desktop.menu.newWindow" },
] as const

export function jumpList(program: string): JumpListCategory[] {
  return [
    {
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
    },
  ]
}

/** The task a second instance was started for, if any. */
export function jumpTask(argv: readonly string[]) {
  return TASKS.find((task) => argv.includes(task.flag))?.id
}
