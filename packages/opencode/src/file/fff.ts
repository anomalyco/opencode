import path from "path"
import { setTimeout as sleep } from "node:timers/promises"
import {
  FileFinder,
  type FileItem,
  type GrepCursor,
  type GrepMatch,
  type GrepMode,
  type MixedItem,
  type MixedSearchResult,
  type SearchResult,
} from "@ff-labs/fff-bun"
import z from "zod"
import { Global } from "@opencode-ai/core/global"
import { Glob } from "@opencode-ai/core/util/glob"
import { Filesystem } from "@/util/filesystem"
import * as Log from "@opencode-ai/core/util/log"
import { registerDisposer } from "@/effect/instance-registry"

export namespace Fff {
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

  const state = {
    map: new Map<string, FileFinder>(),
    // keep the state of the already indexed fff pickers
    // to avoid asking if it is finished scanned every time
    ready: new Set<string>(),
  }

  registerDisposer(async (directory) => {
    const dir = Filesystem.resolve(directory)
    const pick = state.map.get(dir)
    if (!pick) return
    state.map.delete(dir)
    state.ready.delete(dir)

    try {
      pick.destroy()
    } catch {}
  })

  const root = path.join(Global.Path.cache, "fff")

  function key(dir: string) {
    return Buffer.from(dir).toString("base64url")
  }

  function dbs(dir: string) {
    const id = key(dir)
    return {
      frecency: path.join(root, `${id}.frecency.mdb`),
      history: path.join(root, `${id}.history.mdb`),
    }
  }

  export function picker(cwd: string) {
    const dir = Filesystem.resolve(cwd)
    const cached = state.map.get(dir)
    if (cached) return cached

    const files = dbs(dir)
    const base = Log.file()
    const logfile = path.join(Global.Path.log, base ? "fff-" + path.basename(base) : "fff.log")
    const result = FileFinder.create({
      aiMode: true,
      basePath: dir,
      frecencyDbPath: files.frecency,
      historyDbPath: files.history,
      logFilePath: logfile,
      // fff uses the same log level
      logLevel: Log.currentLevel().toLowerCase() as "debug" | "info" | "warn" | "error",
      // if there is second project opened within the same sesion - disable
      // viertual memory mapping, the memory mapping address space is finite, so we
      // don't want to blow user's computer (the limit depends on repo size)
      cacheBudgetMaxFiles: state.map.size > 0 ? 0 : undefined,
    })

    if (!result.ok) throw new Error(result.error)
    const pick = result.value
    state.map.set(dir, pick)
    return pick
  }

  const FFF_WAIT_INTERVAL = 25
  async function waitForScan(picker: FileFinder, timeoutMs: number) {
    const start = Date.now()

    // becuase fff is a native library it doesn't touches event loop, so
    // poll for picker to be ready for returning the data if it is still scanning
    while (picker.isScanning()) {
      if (Date.now() - start >= timeoutMs) throw new Error("fff scan timeout")
      await sleep(FFF_WAIT_INTERVAL)
    }
  }

  async function open(cwd: string) {
    const dir = Filesystem.resolve(cwd)
    const pick = picker(cwd)

    if (!state.ready.has(dir)) {
      await waitForScan(pick, 5000)
      state.ready.add(dir)
    }

    return pick
  }

  export async function files(input: { cwd: string; query: string; page?: number; size?: number; current?: string }) {
    const fff = await open(input.cwd)
    const out = fff.fileSearch(input.query, {
      pageIndex: input.page ?? 0,
      pageSize: input.size ?? 100,
      currentFile: input.current,
    })
    if (!out.ok) throw new Error(out.error)
    return out.value
  }

  export async function mixed(input: { cwd: string; query: string; page?: number; size?: number; current?: string }) {
    const fff = await open(input.cwd)
    const out = fff.mixedSearch(input.query, {
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
    const pick = await open(input.cwd)
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
    const files = (
      await Glob.scan("**/*", {
        cwd: input.cwd,
        include: "file",
        dot: true,
      })
    )
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
    // fff has default support for globs that is done at the native level
    // it prefilters files before the search so it is impossible to miss the reuslt
    const constraints = input.glob?.join(" ") ?? ""
    const out = await grep({
      cwd: input.cwd,
      query: constraints ? `${constraints} ${input.pattern}` : input.pattern,
      mode: "regex",
      max: input.limit,
    })

    return out.items.slice(0, input.limit).map((row) => ({
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
  }

  export type Search = SearchResult
  export type Mixed = MixedSearchResult
  export type MixedEntry = MixedItem
  export type File = FileItem
  export type Hit = GrepMatch
}
