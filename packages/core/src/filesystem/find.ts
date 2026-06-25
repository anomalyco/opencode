import path from "path"
import { Entry } from "@opencode-ai/schema/filesystem"
import fuzzysort from "fuzzysort"
import { RelativePath } from "../schema"

type FindItem = {
  path: string
  type: "file" | "directory"
  score: number
}

function normalizedRelativePath(input: string) {
  return input.replaceAll("\\", "/").replace(/\/$/, "")
}

function directoryMatchesQuery(query: string, directory: string) {
  const normalized = query.trim().replaceAll("\\", "/").replace(/\/$/, "")
  if (!normalized) return false
  if (normalized.includes("/")) return fuzzysort.single(normalized, directory) !== null
  return fuzzysort.single(normalized, path.posix.basename(directory)) !== null
}

export function normalizeFindEntries(
  query: string,
  limit: number,
  items: FindItem[],
  includeAncestorDirectories = true,
) {
  const byPath = new Map<string, FindItem>()
  const add = (item: FindItem) => {
    const relative = normalizedRelativePath(item.path)
    if (!relative) return
    const existing = byPath.get(relative)
    if (!existing || item.score > existing.score || (item.type === "directory" && existing.type !== "directory")) {
      byPath.set(relative, { ...item, path: relative })
    }
  }

  for (const item of items) {
    const relative = normalizedRelativePath(item.path)
    add({ ...item, path: relative })
    if (!includeAncestorDirectories) continue

    const parts = relative.split("/").filter(Boolean)
    const directoryDepth = parts.length - 1
    for (let index = 1; index <= directoryDepth; index++) {
      const directory = parts.slice(0, index).join("/")
      if (!directoryMatchesQuery(query, directory)) continue
      add({ path: directory, type: "directory", score: item.score })
    }
  }

  return Array.from(byPath.values())
    .sort((a, b) => b.score - a.score || a.path.length - b.path.length || a.path.localeCompare(b.path))
    .slice(0, limit)
    .map((item) =>
      Entry.make({
        path: RelativePath.make(item.path + (item.type === "directory" ? path.sep : "")),
        type: item.type,
      }),
    )
}
