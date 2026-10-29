export * as SkillScan from "./skill-scan.js"

import { FSUtil } from "@opencode/util/fs-util"
import path from "path"
import { Effect } from "effect"

const MAX_DEPTH = 6

export const ignore = [...FSUtil.ignoreGlobs, "**/.*", "**/.*/**"]

export const scan = Effect.fn("SkillScan.scan")(function* (root: string) {
  const fs = yield* FSUtil.Service
  const files: string[] = []
  const queue = [{ directory: root, depth: 0 }]
  for (const item of queue) {
    const entries = yield* fs.readDirectoryEntries(item.directory).pipe(Effect.orElseSucceed(() => []))
    const children = yield* Effect.forEach(
      entries.filter((entry) => !entry.name.startsWith(".") && !FSUtil.ignoredDirectories.includes(entry.name)),
      (entry) => {
        const target = path.join(item.directory, entry.name)
        if (entry.type !== "symlink") return Effect.succeed({ name: entry.name, path: target, type: entry.type })
        return fs.stat(target).pipe(
          Effect.map((info) => (info.type === "Directory" ? "directory" : info.type === "File" ? "file" : "other")),
          Effect.orElseSucceed(() => "other" as const),
          Effect.map((type) => ({ name: entry.name, path: target, type })),
        )
      },
    )
    const skill = children.find((child) => child.type === "file" && child.name === "SKILL.md")
    if (skill) {
      files.push(skill.path)
      continue
    }
    if (item.depth === 0)
      files.push(
        ...children.filter((child) => child.type === "file" && child.name.endsWith(".md")).map((child) => child.path),
      )
    if (item.depth < MAX_DEPTH)
      queue.push(
        ...children
          .filter((child) => child.type === "directory")
          .map((child) => ({ directory: child.path, depth: item.depth + 1 })),
      )
  }
  return files.toSorted()
})
