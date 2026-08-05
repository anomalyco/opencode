// Queue resolution and cursor derivation for loop-spec-queue.
//
// The durable state is the openspec tree itself (design D1): the queue is
// recomputed from disk whenever asked, so a server restart, a human editing
// tasks.md mid-run, or a change appearing while the run is live are all
// handled by construction. Nothing here caches.
import fs from "fs"
import path from "path"

import { parseTasksMd, type TaskItem } from "./tasks-md"

/** Directories under openspec/changes/ that are never queue candidates. */
const EXCLUDED = new Set(["archive", "_repo", "todo"])

export interface QueueChange {
  /** change slug (directory name) */
  slug: string
  /** absolute path to the change directory */
  directory: string
  tasks: TaskItem[]
}

export interface ResolvedQueue {
  /** eligible changes with at least one unchecked task, in queue order */
  eligible: QueueChange[]
  /** changes excluded because they hold a `.skein/blocker.md` */
  quarantined: string[]
  /** changes whose checkboxes are all checked (complete, nothing to do) */
  complete: string[]
}

function hasBlocker(changeDir: string): boolean {
  return fs.existsSync(path.join(changeDir, ".skein", "blocker.md"))
}

function readTasks(changeDir: string): TaskItem[] | undefined {
  const file = path.join(changeDir, "tasks.md")
  if (!fs.existsSync(file)) return undefined
  return parseTasksMd(fs.readFileSync(file, "utf8"))
}

/**
 * Resolves the queue from disk.
 *
 * With `only` given, restricts (and orders) the queue to those slugs — an
 * unknown slug is simply absent from the result. Without it, every change
 * directory under `openspec/changes/` is considered, alphabetically.
 * Directories without a `tasks.md` are not changes and are ignored.
 */
export function resolveQueue(root: string, only?: readonly string[]): ResolvedQueue {
  const changesDir = path.join(root, "openspec", "changes")
  const result: ResolvedQueue = { eligible: [], quarantined: [], complete: [] }
  if (!fs.existsSync(changesDir)) return result

  const listed = fs
    .readdirSync(changesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !EXCLUDED.has(entry.name))
    .map((entry) => entry.name)
    .sort()
  const order = only ? only.filter((slug) => listed.includes(slug)) : listed

  for (const slug of order) {
    const directory = path.join(changesDir, slug)
    const tasks = readTasks(directory)
    if (!tasks || tasks.length === 0) continue
    if (hasBlocker(directory)) {
      result.quarantined.push(slug)
      continue
    }
    if (tasks.every((task) => task.checked)) {
      result.complete.push(slug)
      continue
    }
    result.eligible.push({ slug, directory, tasks })
  }
  return result
}

/**
 * The cursor is the first eligible change — derived, never stored (D1).
 * Returns undefined when the queue is drained.
 */
export function cursor(queue: ResolvedQueue): QueueChange | undefined {
  return queue.eligible[0]
}

/**
 * Quarantines a change: writes `.skein/blocker.md` with the cause. The
 * blocker file is the same mechanism `resolveQueue` excludes on, so the
 * change leaves this run and every later run until a human clears it.
 */
export function quarantine(change: QueueChange, input: { cause: string; detail: string; timestamp?: number }): string {
  const dir = path.join(change.directory, ".skein")
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, "blocker.md")
  const stamp = new Date(input.timestamp ?? Date.now()).toISOString()
  fs.writeFileSync(
    file,
    [
      `# Blocked: ${change.slug}`,
      "",
      `- Cause: ${input.cause}`,
      `- Quarantined: ${stamp} (by loop-spec-queue)`,
      "",
      "## Detail",
      "",
      input.detail.trim() ? input.detail.trim() : "(no output captured)",
      "",
    ].join("\n"),
  )
  return file
}

export * as SpecQueue from "./queue"
