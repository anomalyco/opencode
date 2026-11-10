import type { ChangeKind } from "@opencode/plugin/gui/review"
import type { FileNode } from "@opencode/plugin/gui"

export type TreeGitStatus = "added" | "deleted" | "modified" | "ignored"

export const FILE_TREE_ROW_HEIGHT = 28

export type AllowedTreeInput = ReturnType<typeof buildAllowedTreeInput>

export type LiveTreeInput = ReturnType<typeof buildLiveTreeInput>

export function normalizeFileTreeV2Path(value: string) {
  if (!value.includes("\\") && !value.startsWith("/") && !value.endsWith("/") && !value.includes("//")) return value

  return value
    .replaceAll("\\", "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/{2,}/g, "/")
}

export const kindChange = (kind: ChangeKind): "added" | "deleted" | "modified" => {
  if (kind === "add") return "added"

  if (kind === "del") return "deleted"

  return "modified"
}

export function buildAllowedTreeInput(paths: readonly string[]) {
  const list: string[] = []
  const originalByPath = new Map<string, string>()
  const directories = new Set<string>()
  const untrackedDirs = new Set<string>()
  const files = new Set<string>()
  const seenDirs = new Set<string>()

  for (const raw of paths) {
    const isDir = raw.endsWith("/") || raw.endsWith("\\")
    const normalized = normalizeFileTreeV2Path(raw)

    if (!normalized) continue
    let slash = normalized.indexOf("/")

    while (slash !== -1) {
      directories.add(normalized.slice(0, slash))
      slash = normalized.indexOf("/", slash + 1)
    }

    if (isDir) {
      directories.add(normalized)
      untrackedDirs.add(normalized)
      const canonical = `${normalized}/`

      if (!seenDirs.has(canonical)) {
        seenDirs.add(canonical)
        list.push(canonical)
      }

      continue
    }

    if (files.has(normalized)) continue
    files.add(normalized)

    if (raw !== normalized) originalByPath.set(normalized, raw)
    list.push(normalized)
  }

  return { paths: list, originalByPath, directories, untrackedDirs, files, total: directories.size + files.size }
}

/**
 * The directories of an allowed tree that are collapsed: tracked folders stay open until the user collapses them, and
 * folders listed as one untracked entry stay closed until the user opens them.
 */
export function collectAllowedCollapsedDirs(
  model: AllowedTreeInput,
  expanded: (dir: string) => boolean | undefined,
): ReadonlySet<string> {
  const collapsed = new Set<string>()

  for (const dir of model.directories) {
    const open = model.untrackedDirs.has(dir) ? expanded(dir) === true : expanded(dir) !== false

    if (!open) collapsed.add(dir)
  }

  return collapsed
}

export function buildLiveTreeInput(
  children: (path: string) => readonly FileNode[],
  expanded: (path: string) => boolean,
) {
  const paths: string[] = []
  const pathSet = new Set<string>()
  const expandedDirs: string[] = []
  const expandedSet = new Set<string>()
  const nodesByPath = new Map<string, FileNode>()
  const ignoredPaths = new Set<string>()
  const orderByPath = new Map<string, number>()
  const seen = new Set<string>()
  const queue = [""]

  while (queue.length > 0) {
    for (const node of children(queue.shift()!)) {
      const norm = normalizeFileTreeV2Path(node.path)

      if (!norm || seen.has(norm)) continue
      seen.add(norm)
      nodesByPath.set(norm, node)
      orderByPath.set(norm, orderByPath.size)

      if (node.type === "directory") {
        const canonical = `${norm}/`
        paths.push(canonical)
        pathSet.add(canonical)

        if (node.ignored) ignoredPaths.add(canonical)

        if (expanded(norm)) {
          expandedDirs.push(canonical)
          expandedSet.add(canonical)
          queue.push(node.path)
        }

        continue
      }

      paths.push(norm)
      pathSet.add(norm)

      if (node.ignored) ignoredPaths.add(norm)
    }
  }

  return { paths, pathSet, expandedDirs, expandedSet, nodesByPath, ignoredPaths, orderByPath }
}

/** Change kinds keyed by normalized tree path, as the tree's git status shows them. */
export function buildKindsStatus(kinds: ReadonlyMap<string, ChangeKind> | undefined) {
  const next = new Map<string, TreeGitStatus>()

  for (const [raw, kind] of kinds ?? []) {
    const path = normalizeFileTreeV2Path(raw)

    if (path) next.set(path, kindChange(kind))
  }

  return next
}

/** The tree's whole git status: ignored entries, overridden by change kinds. */
export function buildGitStatusMap(
  kindsStatus: ReadonlyMap<string, TreeGitStatus>,
  ignoredPaths: ReadonlySet<string>,
): Map<string, TreeGitStatus> {
  const next = new Map<string, TreeGitStatus>()

  for (const path of ignoredPaths) next.set(path, "ignored")

  for (const [path, status] of kindsStatus) next.set(path, status)

  return next
}

/**
 * The git status patch between two status layers. When the change kinds are the same map, only the ignored entries
 * that differ are visited, so a folder toggle in a large tree diffs a few entries instead of rebuilding every status.
 */
export function diffStatusLayers(
  previous: { readonly kinds: ReadonlyMap<string, TreeGitStatus>; readonly ignored: ReadonlySet<string> },
  next: { readonly kinds: ReadonlyMap<string, TreeGitStatus>; readonly ignored: ReadonlySet<string> },
) {
  if (previous.kinds !== next.kinds) {
    return diffGitStatusPatch(
      buildGitStatusMap(previous.kinds, previous.ignored),
      buildGitStatusMap(next.kinds, next.ignored),
    )
  }

  const remove: string[] = []
  const set: Array<{ path: string; status: TreeGitStatus }> = []

  for (const path of previous.ignored) {
    if (!next.ignored.has(path) && !next.kinds.has(path)) remove.push(path)
  }

  for (const path of next.ignored) {
    if (!previous.ignored.has(path) && !next.kinds.has(path)) set.push({ path, status: "ignored" })
  }

  return { remove, set }
}

export function sameStringMap<T extends string>(
  a: ReadonlyMap<string, T> | undefined,
  b: ReadonlyMap<string, T> | undefined,
) {
  if (a === b) return true

  if ((a?.size ?? 0) !== (b?.size ?? 0)) return false

  for (const [key, value] of a ?? []) {
    if (b?.get(key) !== value) return false
  }

  return true
}

export function sameStringSet(a: ReadonlySet<string>, b: ReadonlySet<string>) {
  if (a === b) return true

  if (a.size !== b.size) return false

  for (const item of a) {
    if (!b.has(item)) return false
  }

  return true
}

export function diffGitStatusPatch(
  previous: ReadonlyMap<string, TreeGitStatus>,
  next: ReadonlyMap<string, TreeGitStatus>,
) {
  const remove: string[] = []
  const set: Array<{ path: string; status: TreeGitStatus }> = []

  for (const [path] of previous) {
    if (!next.has(path)) remove.push(path)
  }

  for (const [path, status] of next) {
    if (previous.get(path) !== status) set.push({ path, status })
  }

  return { remove, set }
}
