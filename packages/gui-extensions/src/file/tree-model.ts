import type { ChangeKind } from "../review/contract"
import type { FileNode } from "../sdk"

export type TreeGitStatus = "added" | "deleted" | "modified" | "ignored"

export const FILE_TREE_ROW_HEIGHT = 28

export type AllowedTreeInput = ReturnType<typeof buildAllowedTreeInput>

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

  return { paths: list, originalByPath, directories, untrackedDirs, total: directories.size + files.size }
}

export function buildLiveTreeInput(
  children: (path: string) => readonly FileNode[],
  expanded: (path: string) => boolean,
) {
  const paths: string[] = []
  const expandedDirs: string[] = []
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

        if (node.ignored) ignoredPaths.add(canonical)

        if (expanded(norm)) {
          expandedDirs.push(canonical)
          queue.push(node.path)
        }

        continue
      }

      paths.push(norm)

      if (node.ignored) ignoredPaths.add(norm)
    }
  }

  return { paths, expandedDirs, nodesByPath, ignoredPaths, orderByPath }
}

export function buildGitStatusMap(
  kinds: ReadonlyMap<string, ChangeKind> | undefined,
  ignoredPaths?: ReadonlySet<string>,
): Map<string, TreeGitStatus> {
  const next = new Map<string, TreeGitStatus>()

  for (const path of ignoredPaths ?? []) next.set(path, "ignored")

  for (const [raw, kind] of kinds ?? []) {
    const path = normalizeFileTreeV2Path(raw)

    if (path) next.set(path, kindChange(kind))
  }

  return next
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
