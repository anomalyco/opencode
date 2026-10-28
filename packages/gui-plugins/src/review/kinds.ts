import type { FileDiffInfo } from "@opencode/client/promise"
import type { ChangeKind } from "@opencode/plugin/gui/review"
import { Match, Predicate } from "effect"

export type RenderDiff = FileDiffInfo

export function normalizePath(value: string) {
  return value
    .replaceAll("\\", "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/{2,}/g, "/")
}

export function filterRenderableDiff(value: FileDiffInfo): value is RenderDiff {
  // The server types `file` as a string; a malformed payload still must not reach the renderer.
  return Predicate.isString(value.file)
}

export function reviewDiffNeedsLoad(diff: RenderDiff) {
  if (diff.additions === 0 && diff.deletions === 0) return false

  return !diff.patch || !/^@@ /m.test(diff.patch)
}

export function reviewRootDirectory(root: string) {
  return root === "/" || /^[A-Za-z]:[/\\]?$/.test(root) ? root : root.replace(/[/\\]+$/, "")
}

export function reviewDiffDirectory(root: string, file: string) {
  const path = normalizePath(file)
  const index = path.lastIndexOf("/")

  if (index < 0) return reviewRootDirectory(root)

  return reviewFolderDirectory(root, path.slice(0, index))
}

/** The directory of a workspace-relative folder inside the review root. */
export function reviewFolderDirectory(root: string, folder: string) {
  const separator = root.includes("\\") ? "\\" : "/"
  const base = reviewRootDirectory(root)

  return `${base.endsWith(separator) ? base : base + separator}${normalizePath(folder).replaceAll("/", separator)}`
}

/** An untracked folder that Git lists as one row, as `git status` shows it. */
export function isReviewFolder(file: string) {
  return file.endsWith("/")
}

/** The rows with each loaded folder's entries after its row, depth first. A folder's `more` entry stays out. */
export function expandReviewFolders(
  rows: readonly RenderDiff[],
  loaded: ReadonlyMap<string, readonly RenderDiff[]>,
): RenderDiff[] {
  return rows.flatMap((row) => [
    row,
    ...expandReviewFolders(
      (loaded.get(row.file) ?? []).filter((entry) => !entry.more),
      loaded,
    ),
  ])
}

export function reviewDiffKinds(diffs: readonly RenderDiff[]) {
  const merge = (a: ChangeKind | undefined, b: ChangeKind) => {
    if (!a) return b

    if (a === b) return a

    return "mix" as const
  }

  const out = new Map<string, ChangeKind>()

  for (const diff of diffs) {
    const file = normalizePath(diff.file)

    const kind = Match.value(diff.status).pipe(
      Match.when("added", (): ChangeKind => "add"),
      Match.when("deleted", (): ChangeKind => "del"),
      Match.orElse((): ChangeKind => "mix"),
    )

    out.set(file, kind)

    const parts = file.split("/")
    parts.slice(0, -1).forEach((_, idx) => {
      const dir = parts.slice(0, idx + 1).join("/")

      if (!dir) return
      out.set(dir, merge(out.get(dir), kind))
    })
  }

  return out
}

export function filterReviewFiles(files: string[], query: string) {
  const value = query.trim().toLowerCase()

  if (!value) return files

  return files.filter((file) => file.toLowerCase().includes(value))
}

/** Depth-first file order with directories before sibling files, as the change tree lists them. */
export function sortReviewPaths(paths: readonly string[]) {
  type Node = { name: string; path: string; file: boolean; original: string }

  const nodes = new Map<string, Node>()
  paths.forEach((value) => {
    const file = normalizePath(value)

    if (!file) return
    const parts = file.split("/")
    parts.forEach((name, index) => {
      const path = parts.slice(0, index + 1).join("/")

      if (nodes.has(path)) return
      const leaf = index === parts.length - 1
      nodes.set(path, { name, path, file: leaf, original: leaf ? value : path })
    })
  })
  const children = new Map<string, Node[]>()
  nodes.forEach((node) => {
    const index = node.path.lastIndexOf("/")
    const parent = index === -1 ? "" : node.path.slice(0, index)
    const list = children.get(parent)

    if (list) list.push(node)
    else children.set(parent, [node])
  })
  children.forEach((list) =>
    list.sort((a, b) => {
      if (a.file !== b.file) return a.file ? 1 : -1

      return a.name.localeCompare(b.name)
    }),
  )
  const out: string[] = []
  const stack = (children.get("") ?? []).toReversed()

  while (stack.length > 0) {
    const node = stack.pop()!

    if (node.file) {
      out.push(node.original)
      continue
    }

    stack.push(...(children.get(node.path) ?? []).toReversed())
  }

  return out
}

// Drives the highlight/selection of the flat search-result list from the filter
// input's keyboard events.
export function applyFileListKeyDown(
  event: KeyboardEvent,
  files: readonly string[],
  highlighted: string | undefined,
  options: { onHighlight: (path: string) => void; onSelect: (path: string) => void },
) {
  if (files.length === 0) return

  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    const currentIndex = highlighted ? files.indexOf(highlighted) : -1
    const delta = event.key === "ArrowDown" ? 1 : -1
    const start = currentIndex === -1 ? (delta > 0 ? 0 : files.length - 1) : currentIndex + delta
    const index = Math.max(0, Math.min(files.length - 1, start))
    options.onHighlight(files[index]!)
    event.preventDefault()

    return
  }

  if (event.key !== "Enter") return
  const target = highlighted ?? files[0]

  if (!target) return
  options.onSelect(target)
  event.preventDefault()
}
