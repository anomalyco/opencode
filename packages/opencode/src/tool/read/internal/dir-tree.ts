import path from "path"
import z from "zod"
import { Tool } from "@/tool/shared/tool"
import { Ripgrep } from "@/file/ripgrep"
import { defaultIgnoreGlobs } from "@/tool/read/shared"
import { dir, title } from "./common"

const DESCRIPTION = `Render a recursive directory tree with depth, include, ignore, symlink, directory-only, and count controls.

Use this when you need a compact structural view of a directory rather than file contents.`

type Node = {
  dirs: Map<string, Node>
  files: string[]
}

function node() {
  return {
    dirs: new Map<string, Node>(),
    files: [] as string[],
  } satisfies Node
}

function child(root: Node, name: string) {
  const hit = root.dirs.get(name)
  if (hit) return hit
  const next = node()
  root.dirs.set(name, next)
  return next
}

export const DirTreeTool = Tool.define("dir_tree", {
  description: DESCRIPTION,
  parameters: z.object({
    path: z.string().optional().describe("Directory to inspect. Defaults to the current working directory."),
    depth: z.coerce.number().int().min(1).max(12).default(4).describe("Maximum directory depth to include."),
    limit: z.coerce.number().int().min(1).max(1000).default(200).describe("Maximum files to scan before truncating."),
    include: z.array(z.string()).optional().describe("Optional positive glob filters for files to include."),
    ignore: z.array(z.string()).optional().describe("Additional glob patterns to ignore."),
    follow: z.boolean().optional().describe("Follow symlinks while scanning the directory tree."),
    dirs_only: z.boolean().optional().describe("Show directories only and omit file names."),
    counts: z.boolean().optional().describe("Show direct file and directory counts next to each directory."),
  }),
  async execute(input, ctx) {
    const root = await dir(input.path, ctx, "dir_tree")
    const glob = [...(input.include ?? []), ...defaultIgnoreGlobs(input.ignore)]
    const tree = node()
    let files = 0
    let cut = false

    for await (const file of Ripgrep.files({
      cwd: root,
      glob,
      maxDepth: input.depth,
      follow: input.follow,
      signal: ctx.abort,
    })) {
      if (files >= input.limit) {
        cut = true
        break
      }

      files++
      const parts = file.split(path.sep)
      let cur = tree
      for (const item of parts.slice(0, -1)) {
        cur = child(cur, item)
      }
      if (!input.dirs_only) cur.files.push(parts.at(-1)!)
    }

    const out = [`${root}/`]
    let dirs = 0

    function label(name: string, cur: Node) {
      if (!input.counts) return `${name}/`
      return `${name}/ (${cur.dirs.size} dirs, ${cur.files.length} files)`
    }

    function walk(cur: Node, depth: number) {
      const indent = "  ".repeat(depth)
      for (const [name, next] of Array.from(cur.dirs.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
        dirs++
        out.push(`${indent}${label(name, next)}`)
        walk(next, depth + 1)
      }

      if (input.dirs_only) return
      for (const file of cur.files.sort((a, b) => a.localeCompare(b))) {
        out.push(`${indent}${file}`)
      }
    }

    walk(tree, 1)

    if (cut) {
      out.push("")
      out.push(
        `(Results truncated after ${input.limit} files. Narrow the path, depth, or ignore globs for a denser tree.)`,
      )
    }

    return {
      title: title(root),
      metadata: {
        count: files,
        dirs,
        truncated: cut,
      },
      output: out.join("\n"),
    }
  },
})
