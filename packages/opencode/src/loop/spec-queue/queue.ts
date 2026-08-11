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
  /** ordering key resolved from `.openspec.yaml` — see `changeOrder` */
  order: ChangeOrder
}

/**
 * How a change earns its place in the queue. Alphabetical-by-slug was
 * deterministic but arbitrary: with a large backlog there was no way to say
 * "this one first", and `change-three` sorted before `change-two`.
 *
 * `priority` (lower first) is an explicit opt-in from the change's
 * `.openspec.yaml`; unlabelled changes share DefaultPriority so labelling one
 * change moves it without renumbering the rest. Ties fall back to `created`
 * (oldest planned first — a backlog is a queue, not a dictionary) and finally
 * the slug, so the order is always total and stable.
 */
export interface ChangeOrder {
  priority: number
  created: string
  slug: string
}

export const DefaultPriority = 100

export interface ResolvedQueue {
  /** eligible changes with at least one unchecked task, in queue order */
  eligible: QueueChange[]
  /** changes excluded because they hold a `.skein/blocker.md` */
  quarantined: string[]
  /** changes whose checkboxes are all checked (complete, nothing to do) */
  complete: string[]
  /**
   * False when there is no `openspec/changes` here at all. "Nothing eligible"
   * and "this is not an openspec repo" both produce an empty queue but mean
   * completely different things, and reporting the second as a drained backlog
   * is a lie — the caller needs to tell them apart.
   */
  hasOpenspec: boolean
}

function hasBlocker(changeDir: string): boolean {
  return fs.existsSync(path.join(changeDir, ".skein", "blocker.md"))
}

/**
 * Reads the two scalar keys the queue cares about out of `.openspec.yaml`.
 * Deliberately a line scanner rather than a YAML dependency: the file is a
 * flat `key: value` header, and this module stays import-free apart from
 * fs/path so gate evaluators and tests can use it without a layer graph.
 */
function readOrder(changeDir: string, slug: string): ChangeOrder {
  const file = path.join(changeDir, ".openspec.yaml")
  let priority = DefaultPriority
  let created = ""
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*?)\s*$/)
      if (!match) continue
      const [, key, raw] = match
      const value = raw.replace(/^["']|["']$/g, "")
      if (key === "priority") {
        const parsed = Number(value)
        if (!Number.isNaN(parsed)) priority = parsed
      }
      if (key === "created") created = value
    }
  }
  // A change with no `created` sorts after dated ones rather than jumping the
  // queue on an empty string.
  return { priority, created: created || "9999-12-31", slug }
}

export function compareOrder(a: ChangeOrder, b: ChangeOrder): number {
  if (a.priority !== b.priority) return a.priority - b.priority
  if (a.created !== b.created) return a.created < b.created ? -1 : 1
  return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0
}

function readTasks(changeDir: string): TaskItem[] | undefined {
  const file = path.join(changeDir, "tasks.md")
  if (!fs.existsSync(file)) return undefined
  return parseTasksMd(fs.readFileSync(file, "utf8"))
}

/**
 * Resolves the queue from disk.
 *
 * With `only` given, the caller's order is honoured verbatim — an explicit list
 * is an explicit priority statement — and an unknown slug is simply absent.
 * Without it, every change directory under `openspec/changes/` is considered
 * and ordered by `compareOrder` (priority, then creation date, then slug).
 * Directories without a `tasks.md` are not changes and are ignored.
 */
export function resolveQueue(root: string, only?: readonly string[]): ResolvedQueue {
  const changesDir = path.join(root, "openspec", "changes")
  const result: ResolvedQueue = { eligible: [], quarantined: [], complete: [], hasOpenspec: false }
  if (!fs.existsSync(changesDir)) return result
  result.hasOpenspec = true

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
    result.eligible.push({ slug, directory, tasks, order: readOrder(directory, slug) })
  }
  // An explicit `only` list is itself the priority statement, so only the
  // discovered queue gets sorted.
  if (!only) result.eligible.sort((a, b) => compareOrder(a.order, b.order))
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

/**
 * Removes a change's blocker, un-doing a quarantine. Used when the loop decides
 * the gate that quarantined it was itself suspect (a misconfigured command) —
 * a config mistake must not leave a finished change blockered for every future
 * run. Best-effort: a missing blocker is not an error.
 */
export function unquarantine(change: QueueChange): void {
  const dir = path.join(change.directory, ".skein")
  const file = path.join(dir, "blocker.md")
  if (fs.existsSync(file)) fs.rmSync(file, { force: true })
  // Leave .skein itself if anything else lives there.
  if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir)
}

/**
 * Directories one level below `root` that ARE openspec repos. A workspace like
 * ~/dev holds many repos, each with its own openspec — starting a run there is
 * an easy mistake, and "no backlog here" is far more useful when it can say
 * where the backlogs actually are.
 */
export function nearbyOpenspecRepos(root: string, limit = 12): string[] {
  const found: string[] = []
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue
    if (fs.existsSync(path.join(root, entry.name, "openspec", "changes"))) found.push(entry.name)
    if (found.length >= limit) break
  }
  return found.sort()
}

export * as SpecQueue from "./queue"
