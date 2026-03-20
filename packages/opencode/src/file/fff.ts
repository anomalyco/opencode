import fs from "fs/promises"
import path from "path"
import {
  FileFinder,
  type FileItem,
  type GrepCursor,
  type GrepMatch,
  type GrepMode,
  type SearchResult,
} from "@ff-labs/fff-node"
import z from "zod"
import { Global } from "../global"
import { Instance } from "../project/instance"
import { Filesystem } from "../util/filesystem"
import { Glob } from "../util/glob"
import { Log } from "../util/log"

export namespace Fff {
  const log = Log.create({ service: "file.fff" })

  export const Match = z.object({
    path: z.object({
      text: z.string(),
    }),
    lines: z.object({
      text: z.string(),
    }),
    line_number: z.number(),
    absolute_offset: z.number(),
    submatches: z.array(
      z.object({
        match: z.object({
          text: z.string(),
        }),
        start: z.number(),
        end: z.number(),
      }),
    ),
  })

  const state = Instance.state(
    async () => ({
      map: new Map<string, FileFinder>(),
      pending: new Map<string, Promise<FileFinder>>(),
    }),
    async (state) => {
      for (const pick of state.map.values()) pick.destroy()
    },
  )

  const root = path.join(Global.Path.cache, "fff")

  function key(dir: string) {
    return Buffer.from(dir).toString("base64url")
  }

  async function db(dir: string) {
    await fs.mkdir(root, { recursive: true })
    const id = key(dir)
    return {
      frecency: path.join(root, `${id}.frecency.mdb`),
      history: path.join(root, `${id}.history.mdb`),
    }
  }

  function refresh(pick: FileFinder) {
    const git = pick.refreshGitStatus()
    if (!git.ok) {
      log.warn("git refresh failed", { error: git.error })
      return
    }
  }

  export async function picker(cwd: string) {
    const dir = Filesystem.resolve(cwd)
    const memo = await state()
    const cached = memo.map.get(dir)
    if (cached) return cached

    const wait = memo.pending.get(dir)
    if (wait) return wait

    const next = (async () => {
      const files = await db(dir)
      const made = FileFinder.create({
        basePath: dir,
        frecencyDbPath: files.frecency,
        historyDbPath: files.history,
        aiMode: true,
      })
      if (!made.ok) throw new Error(made.error)

      const pick = made.value
      const done = await pick.waitForScan(5000)
      if (!done.ok) {
        pick.destroy()
        throw new Error(done.error)
      }

      memo.map.set(dir, pick)
      refresh(pick)
      return pick
    })()

    memo.pending.set(dir, next)
    try {
      return await next
    } finally {
      if (memo.pending.get(dir) === next) memo.pending.delete(dir)
    }
  }

  export async function files(input: { cwd: string; query: string; page?: number; size?: number; current?: string }) {
    const pick = await picker(input.cwd)
    const out = pick.fileSearch(input.query, {
      pageIndex: input.page ?? 0,
      pageSize: input.size ?? 100,
      currentFile: input.current,
    })
    if (!out.ok) throw new Error(out.error)
    return out.value
  }

  export async function grep(input: {
    cwd: string
    query: string
    mode?: GrepMode
    max?: number
    before?: number
    after?: number
    budget?: number
    cursor?: GrepCursor | null
  }) {
    const pick = await picker(input.cwd)
    const out = pick.grep(input.query, {
      mode: input.mode,
      maxMatchesPerFile: input.max,
      beforeContext: input.before,
      afterContext: input.after,
      timeBudgetMs: input.budget,
      cursor: input.cursor,
    })
    if (!out.ok) throw new Error(out.error)
    return out.value
  }

  function norm(text: string) {
    return text.replaceAll("\\", "/")
  }

  function hidden(rel: string) {
    return norm(rel)
      .split("/")
      .some((part) => part.startsWith("."))
  }

  function accept(rel: string, file: string, glob?: string[], show?: boolean) {
    if (show === false && hidden(rel)) return false
    if (!glob?.length) return true
    const allow = glob.filter((x) => !x.startsWith("!"))
    const deny = glob.filter((x) => x.startsWith("!")).map((x) => x.slice(1))
    if (allow.length > 0 && !allow.some((x) => Glob.match(x, rel) || Glob.match(x, file))) return false
    if (deny.some((x) => Glob.match(x, rel) || Glob.match(x, file))) return false
    return true
  }

  export function allowed(input: { rel: string; file?: string; glob?: string[]; hidden?: boolean }) {
    return accept(input.rel, input.file ?? input.rel.split("/").at(-1) ?? input.rel, input.glob, input.hidden !== false)
  }

  export async function tree(input: { cwd: string; limit?: number; signal?: AbortSignal }) {
    input.signal?.throwIfAborted()
    const files = (await Glob.scan("**/*", {
      cwd: input.cwd,
      include: "file",
      dot: true,
    }))
      .map((row) => norm(row))
      .filter((row) => allowed({ rel: row, hidden: true }))
      .toSorted((a, b) => a.localeCompare(b))
    input.signal?.throwIfAborted()
    interface Node {
      name: string
      children: Map<string, Node>
    }

    function dir(node: Node, name: string) {
      const old = node.children.get(name)
      if (old) return old
      const next = { name, children: new Map<string, Node>() }
      node.children.set(name, next)
      return next
    }

    const root = { name: "", children: new Map<string, Node>() }
    for (const file of files) {
      if (file.includes(".opencode")) continue
      const parts = file.split("/")
      if (parts.length < 2) continue
      let node = root
      for (const part of parts.slice(0, -1)) {
        node = dir(node, part)
      }
    }

    function count(node: Node): number {
      return Array.from(node.children.values()).reduce((sum, child) => sum + 1 + count(child), 0)
    }

    const total = count(root)
    const limit = input.limit ?? total
    const lines: string[] = []
    const queue = Array.from(root.children.values())
      .toSorted((a, b) => a.name.localeCompare(b.name))
      .map((node) => ({ node, path: node.name }))

    let used = 0
    for (let i = 0; i < queue.length && used < limit; i++) {
      input.signal?.throwIfAborted()
      const row = queue[i]
      lines.push(row.path)
      used++
      queue.push(
        ...Array.from(row.node.children.values())
          .toSorted((a, b) => a.name.localeCompare(b.name))
          .map((node) => ({ node, path: `${row.path}/${node.name}` })),
      )
    }
    if (total > used) lines.push(`[${total - used} truncated]`)
    input.signal?.throwIfAborted()
    return lines.join("\n")
  }

  export async function search(input: {
    cwd: string
    pattern: string
    glob?: string[]
    limit?: number
    follow?: boolean
  }) {
    const out = await grep({
      cwd: input.cwd,
      query: input.pattern,
      mode: "regex",
      max: input.limit,
    })
    const rows = out.items
      .filter((row) => accept(norm(row.relativePath), row.fileName, input.glob, true))
      .slice(0, input.limit)
      .map((row) => ({
        path: { text: row.relativePath },
        lines: { text: row.lineContent },
        line_number: row.lineNumber,
        absolute_offset: row.byteOffset,
        submatches: row.matchRanges
          .map(([start, end]) => {
            const text = row.lineContent.slice(start, end)
            if (!text) return undefined
            return {
              match: { text },
              start,
              end,
            }
          })
          .filter((row) => row !== undefined),
      }))
    return Match.array().parse(rows)
  }

  export type Search = SearchResult
  export type File = FileItem
  export type Hit = GrepMatch
}
