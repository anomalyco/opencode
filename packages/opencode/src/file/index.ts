import { z } from "zod"
import { Bus } from "../bus"
import { $ } from "bun"
import { createPatch } from "diff"
import path from "path"
import { App } from "../app/app"
import fs from "fs"
import ignore from "ignore"
import { Log } from "../util/log"

export namespace File {
  const log = Log.create({ service: "file" })

  export const Info = z
    .object({
      path: z.string(),
      added: z.number().int(),
      removed: z.number().int(),
      status: z.enum(["added", "deleted", "modified"]),
    })
    .openapi({
      ref: "File",
    })

  export type Info = z.infer<typeof Info>

  export const Node = z
    .object({
      name: z.string(),
      path: z.string(),
      type: z.enum(["file", "directory"]),
      ignored: z.boolean(),
    })
    .openapi({
      ref: "FileNode",
    })
  export type Node = z.infer<typeof Node>

  export const Event = {
    Edited: Bus.event(
      "file.edited",
      z.object({
        file: z.string(),
      }),
    ),
  }

  export async function status() {
    const app = App.info()
    if (!app.git) return []

    const diffOutput = await $`git diff --numstat HEAD`.cwd(app.path.cwd).quiet().nothrow().text()

    const changedFiles: Info[] = []

    if (diffOutput.trim()) {
      const lines = diffOutput.trim().split("\n")
      for (const line of lines) {
        const [added, removed, filepath] = line.split("\t")
        changedFiles.push({
          path: filepath,
          added: added === "-" ? 0 : parseInt(added, 10),
          removed: removed === "-" ? 0 : parseInt(removed, 10),
          status: "modified",
        })
      }
    }

    const untrackedOutput = await $`git ls-files --others --exclude-standard`.cwd(app.path.cwd).quiet().nothrow().text()

    if (untrackedOutput.trim()) {
      const untrackedFiles = untrackedOutput.trim().split("\n")
      for (const filepath of untrackedFiles) {
        try {
          const content = await Bun.file(path.join(app.path.root, filepath)).text()
          const lines = content.split("\n").length
          changedFiles.push({
            path: filepath,
            added: lines,
            removed: 0,
            status: "added",
          })
        } catch {
          continue
        }
      }
    }

    // Get deleted files
    const deletedOutput = await $`git diff --name-only --diff-filter=D HEAD`.cwd(app.path.cwd).quiet().nothrow().text()

    if (deletedOutput.trim()) {
      const deletedFiles = deletedOutput.trim().split("\n")
      for (const filepath of deletedFiles) {
        changedFiles.push({
          path: filepath,
          added: 0,
          removed: 0, // Could get original line count but would require another git command
          status: "deleted",
        })
      }
    }

    return changedFiles.map((x) => ({
      ...x,
      path: path.relative(app.path.cwd, path.join(app.path.root, x.path)),
    }))
  }

  export async function read(file: string) {
    using _ = log.time("read", { file })
    const app = App.info()
    const full = path.join(app.path.cwd, file)
    const content = await Bun.file(full)
      .text()
      .catch(() => "")
      .then((x) => x.trim())
    if (app.git) {
      const rel = path.relative(app.path.root, full)
      const diff = await $`git diff ${rel}`.cwd(app.path.root).quiet().nothrow().text()
      if (diff.trim()) {
        const original = await $`git show HEAD:${rel}`.cwd(app.path.root).quiet().nothrow().text()
        const patch = createPatch(file, original, content, "old", "new", {
          context: Infinity,
        })
        return { type: "patch", content: patch }
      }
    }
    return { type: "raw", content }
  }

  export async function list(dir?: string) {
    const exclude = [".git", ".DS_Store"]
    const app = App.info()
    let ignored = (_: string) => false
    if (app.git) {
      const gitignore = Bun.file(path.join(app.path.root, ".gitignore"))
      if (await gitignore.exists()) {
        const ig = ignore().add(await gitignore.text())
        ignored = ig.ignores.bind(ig)
      }
    }
    const resolved = dir ? path.join(app.path.cwd, dir) : app.path.cwd
    const nodes: Node[] = []
    for (const entry of await fs.promises.readdir(resolved, { withFileTypes: true })) {
      if (exclude.includes(entry.name)) continue
      const fullPath = path.join(resolved, entry.name)
      const relativePath = path.relative(app.path.cwd, fullPath)
      const relativeToRoot = path.relative(app.path.root, fullPath)
      const type = entry.isDirectory() ? "directory" : "file"
      nodes.push({
        name: entry.name,
        path: relativePath,
        type,
        ignored: ignored(type === "directory" ? relativeToRoot + "/" : relativeToRoot),
      })
    }
    return nodes.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "directory" ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })
  }
}
