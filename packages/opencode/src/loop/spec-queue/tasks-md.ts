// Parser for openspec `tasks.md` files — the queue's source of truth for
// "done" (loop-spec-queue D1/D2: the cursor is derived from checkboxes on
// disk, and a completion token is only ever a claim to verify against them).
//
// Import-free on purpose (same discipline as ../completion, ../similarity):
// gate evaluators and tests consume this without dragging the loop service's
// layer graph along.

export interface TaskItem {
  /** `N.N`-style id when the line carries one (e.g. "3.2"), else "" */
  id: string
  /** the task line's text, without the checkbox or id */
  text: string
  checked: boolean
  /** first backtick-quoted command of the task's `Validation:` line, if any */
  validation?: string
}

const CHECKBOX = /^\s*-\s*\[([ xX])\]\s*(.*)$/
const TASK_ID = /^(\d+(?:\.\d+)*)\s+(.*)$/
const VALIDATION = /^\s*-?\s*Validation:\s*(.*)$/

/**
 * Extracts the first backtick-quoted span of a Validation line. Validation
 * lines are prose for humans ("Validation: `bun typecheck` — zero errors",
 * "Validation: manual — dialog shows the gate"); only an explicit backtick
 * command is machine-runnable. No backticks → no runnable validation.
 */
function validationCommand(line: string): string | undefined {
  const match = line.match(/`([^`]+)`/)
  const cmd = match?.[1]?.trim()
  return cmd ? cmd : undefined
}

/** Parses tasks.md content into its checkbox items, in document order. */
export function parseTasksMd(content: string): TaskItem[] {
  const items: TaskItem[] = []
  let current: TaskItem | undefined
  for (const line of content.split("\n")) {
    const checkbox = line.match(CHECKBOX)
    if (checkbox) {
      const rest = checkbox[2].trim()
      const withID = rest.match(TASK_ID)
      current = {
        id: withID ? withID[1] : "",
        text: (withID ? withID[2] : rest).trim(),
        checked: checkbox[1] !== " ",
      }
      items.push(current)
      continue
    }
    if (!current) continue
    const validation = line.match(VALIDATION)
    if (validation) {
      const cmd = validationCommand(validation[1])
      // First Validation line wins; a task documents one validation.
      if (cmd && current.validation === undefined) current.validation = cmd
    }
  }
  return items
}

export function uncheckedTasks(items: TaskItem[]): TaskItem[] {
  return items.filter((item) => !item.checked)
}

export function allChecked(items: TaskItem[]): boolean {
  return items.length > 0 && items.every((item) => item.checked)
}

export * as TasksMd from "./tasks-md"
