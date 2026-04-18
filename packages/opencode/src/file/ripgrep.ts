import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"
import z from "zod"
import { Cause, Context, Effect, Layer, Queue, Stream } from "effect"
import { ripgrep } from "ripgrep"

import { Filesystem } from "@/util"
import { Log } from "@/util"
import { sanitizedProcessEnv } from "@/util/opencode-process"

const log = Log.create({ service: "ripgrep" })

const Stats = z.object({
  elapsed: z.object({
    secs: z.number(),
    nanos: z.number(),
    human: z.string(),
  }),
  searches: z.number(),
  searches_with_match: z.number(),
  bytes_searched: z.number(),
  bytes_printed: z.number(),
  matched_lines: z.number(),
  matches: z.number(),
})

const Begin = z.object({
  type: z.literal("begin"),
  data: z.object({
    path: z.object({
      text: z.string(),
    }),
  }),
})

export const Match = z.object({
  type: z.literal("match"),
  data: z.object({
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
  }),
})

const End = z.object({
  type: z.literal("end"),
  data: z.object({
    path: z.object({
      text: z.string(),
    }),
    binary_offset: z.number().nullable(),
    stats: Stats,
  }),
})

const Summary = z.object({
  type: z.literal("summary"),
  data: z.object({
    elapsed_total: z.object({
      human: z.string(),
      nanos: z.number(),
      secs: z.number(),
    }),
    stats: Stats,
  }),
})

const Result = z.union([Begin, Match, End, Summary])

export type Result = z.infer<typeof Result>
export type Match = z.infer<typeof Match>
export type Item = Match["data"]
export type Begin = z.infer<typeof Begin>
export type End = z.infer<typeof End>
export type Summary = z.infer<typeof Summary>
export type Row = Match["data"]

export interface SearchResult {
  items: Item[]
  partial: boolean
}

export interface FilesInput {
  cwd: string
  glob?: string[]
  hidden?: boolean
  follow?: boolean
  maxDepth?: number
  signal?: AbortSignal
}

export interface SearchInput {
  cwd: string
  pattern: string
  glob?: string[]
  limit?: number
  follow?: boolean
  file?: string[]
  signal?: AbortSignal
}

export interface TreeInput {
  cwd: string
  limit?: number
  signal?: AbortSignal
}

export interface Interface {
  readonly files: (input: FilesInput) => Stream.Stream<string, Error>
  readonly tree: (input: TreeInput) => Effect.Effect<string, Error>
  readonly search: (input: SearchInput) => Effect.Effect<SearchResult, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Ripgrep") {}

type Run = { kind: "files" | "search"; cwd: string; args: string[] }

type WorkerResult = {
  type: "result"
  code: number
  stdout: string
  stderr: string
}

type WorkerLine = {
  type: "line"
  line: string
}

type WorkerDone = {
  type: "done"
  code: number
  stderr: string
}

type WorkerError = {
  type: "error"
  error: {
    message: string
    name?: string
    stack?: string
  }
}

function env() {
  const env = sanitizedProcessEnv()
  delete env.RIPGREP_CONFIG_PATH
  return env
}

function text(input: unknown) {
  if (typeof input === "string") return input
  if (input instanceof ArrayBuffer) return Buffer.from(input).toString()
  if (ArrayBuffer.isView(input)) return Buffer.from(input.buffer, input.byteOffset, input.byteLength).toString()
  return String(input)
}

function toError(input: unknown) {
  if (input instanceof Error) return input
  if (typeof input === "string") return new Error(input)
  return new Error(String(input))
}

function abort(signal?: AbortSignal) {
  const err = signal?.reason
  if (err instanceof Error) return err
  const out = new Error("Aborted")
  out.name = "AbortError"
  return out
}

function error(stderr: string, code: number) {
  const err = new Error(stderr.trim() || `ripgrep failed with code ${code}`)
  err.name = "RipgrepError"
  return err
}

function clean(file: string) {
  return path.normalize(file.replace(/^\.[\\/]/, ""))
}

function row(data: Row): Row {
  return {
    ...data,
    path: {
      ...data.path,
      text: clean(data.path.text),
    },
  }
}

function opts(cwd: string) {
  return {
    env: env(),
    preopens: { ".": cwd },
  }
}

function check(cwd: string) {
  return Effect.tryPromise({
    try: () => fs.stat(cwd).catch(() => undefined),
    catch: toError,
  }).pipe(
    Effect.flatMap((stat) =>
      stat?.isDirectory()
        ? Effect.void
        : Effect.fail(
            Object.assign(new Error(`No such file or directory: '${cwd}'`), {
              code: "ENOENT",
              errno: -2,
              path: cwd,
            }),
          ),
    ),
  )
}

function filesArgs(input: FilesInput) {
  const args = ["--files", "--glob=!.git/*"]
  if (input.follow) args.push("--follow")
  if (input.hidden !== false) args.push("--hidden")
  if (input.maxDepth !== undefined) args.push(`--max-depth=${input.maxDepth}`)
  if (input.glob) {
    for (const glob of input.glob) {
      args.push(`--glob=${glob}`)
    }
  }
  args.push(".")
  return args
}

function searchArgs(input: SearchInput) {
  const args = ["--json", "--hidden", "--glob=!.git/*", "--no-messages"]
  if (input.follow) args.push("--follow")
  if (input.glob) {
    for (const glob of input.glob) {
      args.push(`--glob=${glob}`)
    }
  }
  if (input.limit) args.push(`--max-count=${input.limit}`)
  args.push("--", input.pattern, ...(input.file ?? ["."]))
  return args
}

function parse(stdout: string) {
  return stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => Result.parse(JSON.parse(line)))
    .flatMap((item) => (item.type === "match" ? [row(item.data)] : []))
}

declare const OPENCODE_RIPGREP_WORKER_PATH: string

function target(): Effect.Effect<string | URL, Error> {
  if (typeof OPENCODE_RIPGREP_WORKER_PATH !== "undefined") {
    return Effect.succeed(OPENCODE_RIPGREP_WORKER_PATH)
  }
  const js = new URL("./ripgrep.worker.js", import.meta.url)
  return Effect.tryPromise({
    try: () => Filesystem.exists(fileURLToPath(js)),
    catch: toError,
  }).pipe(Effect.map((exists) => (exists ? js : new URL("./ripgrep.worker.ts", import.meta.url))))
}

function worker() {
  return target().pipe(Effect.flatMap((file) => Effect.sync(() => new Worker(file, { env: env() }))))
}

function drain(buf: string, chunk: unknown, push: (line: string) => void) {
  const lines = (buf + text(chunk)).split(/\r?\n/)
  buf = lines.pop() || ""
  for (const line of lines) {
    if (line) push(line)
  }
  return buf
}

function fail(queue: Queue.Queue<string, Error | Cause.Done>, err: Error) {
  Queue.failCauseUnsafe(queue, Cause.fail(err))
}

function searchDirect(input: SearchInput) {
  return Effect.tryPromise({
    try: () =>
      ripgrep(searchArgs(input), {
        buffer: true,
        ...opts(input.cwd),
      }),
    catch: toError,
  }).pipe(
    Effect.flatMap((ret) => {
      const out = ret.stdout ?? ""
      if (ret.code !== 0 && ret.code !== 1 && ret.code !== 2) {
        return Effect.fail(error(ret.stderr ?? "", ret.code ?? 1))
      }
      return Effect.sync(() => ({
        items: ret.code === 1 ? [] : parse(out),
        partial: ret.code === 2,
      }))
    }),
  )
}

function searchWorker(input: SearchInput) {
  if (input.signal?.aborted) return Effect.fail(abort(input.signal))

  return Effect.acquireUseRelease(
    worker(),
    (w) =>
      Effect.callback<SearchResult, Error>((resume, signal) => {
        let open = true
        const done = (effect: Effect.Effect<SearchResult, Error>) => {
          if (!open) return
          open = false
          resume(effect)
        }
        const onabort = () => done(Effect.fail(abort(input.signal)))

        w.onerror = (evt) => {
          done(Effect.fail(toError(evt.error ?? evt.message)))
        }
        w.onmessage = (evt: MessageEvent<WorkerResult | WorkerError>) => {
          const msg = evt.data
          if (msg.type === "error") {
            done(Effect.fail(Object.assign(new Error(msg.error.message), msg.error)))
            return
          }
          if (msg.code === 1) {
            done(Effect.succeed({ items: [], partial: false }))
            return
          }
          if (msg.code !== 0 && msg.code !== 1 && msg.code !== 2) {
            done(Effect.fail(error(msg.stderr, msg.code)))
            return
          }
          done(
            Effect.sync(() => ({
              items: parse(msg.stdout),
              partial: msg.code === 2,
            })),
          )
        }

        input.signal?.addEventListener("abort", onabort, { once: true })
        signal.addEventListener("abort", onabort, { once: true })
        w.postMessage({
          kind: "search",
          cwd: input.cwd,
          args: searchArgs(input),
        } satisfies Run)

        return Effect.sync(() => {
          input.signal?.removeEventListener("abort", onabort)
          signal.removeEventListener("abort", onabort)
          w.onerror = null
          w.onmessage = null
        })
      }),
    (w) => Effect.sync(() => w.terminate()),
  )
}

function filesDirect(input: FilesInput) {
  return Stream.callback<string, Error>(
    Effect.fnUntraced(function* (queue: Queue.Queue<string, Error | Cause.Done>) {
      let buf = ""
      let err = ""

      const out = {
        write(chunk: unknown) {
          buf = drain(buf, chunk, (line) => {
            Queue.offerUnsafe(queue, clean(line))
          })
        },
      }

      const stderr = {
        write(chunk: unknown) {
          err += text(chunk)
        },
      }

      yield* Effect.forkScoped(
        Effect.gen(function* () {
          yield* check(input.cwd)
          const ret = yield* Effect.tryPromise({
            try: () =>
              ripgrep(filesArgs(input), {
                stdout: out,
                stderr,
                ...opts(input.cwd),
              }),
            catch: toError,
          })
          if (buf) Queue.offerUnsafe(queue, clean(buf))
          if (ret.code === 0 || ret.code === 1) {
            Queue.endUnsafe(queue)
            return
          }
          fail(queue, error(err, ret.code ?? 1))
        }).pipe(
          Effect.catch((err) =>
            Effect.sync(() => {
              fail(queue, err)
            }),
          ),
        ),
      )
    }),
  )
}

function filesWorker(input: FilesInput) {
  return Stream.callback<string, Error>(
    Effect.fnUntraced(function* (queue: Queue.Queue<string, Error | Cause.Done>) {
      if (input.signal?.aborted) {
        fail(queue, abort(input.signal))
        return
      }

      const w = yield* Effect.acquireRelease(worker(), (w) => Effect.sync(() => w.terminate()))
      let open = true
      const close = () => {
        if (!open) return false
        open = false
        return true
      }
      const onabort = () => {
        if (!close()) return
        fail(queue, abort(input.signal))
      }

      w.onerror = (evt) => {
        if (!close()) return
        fail(queue, toError(evt.error ?? evt.message))
      }
      w.onmessage = (evt: MessageEvent<WorkerLine | WorkerDone | WorkerError>) => {
        const msg = evt.data
        if (msg.type === "line") {
          if (open) Queue.offerUnsafe(queue, msg.line)
          return
        }
        if (!close()) return
        if (msg.type === "error") {
          fail(queue, Object.assign(new Error(msg.error.message), msg.error))
          return
        }
        if (msg.code === 0 || msg.code === 1) {
          Queue.endUnsafe(queue)
          return
        }
        fail(queue, error(msg.stderr, msg.code))
      }

      yield* Effect.acquireRelease(
        Effect.sync(() => {
          input.signal?.addEventListener("abort", onabort, { once: true })
          w.postMessage({
            kind: "files",
            cwd: input.cwd,
            args: filesArgs(input),
          } satisfies Run)
        }),
        () =>
          Effect.sync(() => {
            input.signal?.removeEventListener("abort", onabort)
            w.onerror = null
            w.onmessage = null
          }),
      )
    }),
  )
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const source = (input: FilesInput) => {
      const useWorker = !!input.signal && typeof Worker !== "undefined"
      if (!useWorker && input.signal) {
        log.warn("worker unavailable, ripgrep abort disabled")
      }
      return useWorker ? filesWorker(input) : filesDirect(input)
    }

    const files: Interface["files"] = (input) => source(input)

    const tree: Interface["tree"] = Effect.fn("Ripgrep.tree")(function* (input: TreeInput) {
      log.info("tree", input)
      const list = Array.from(yield* source({ cwd: input.cwd, signal: input.signal }).pipe(Stream.runCollect))

      interface Node {
        name: string
        children: Map<string, Node>
      }

      function child(node: Node, name: string) {
        const item = node.children.get(name)
        if (item) return item
        const next = { name, children: new Map() }
        node.children.set(name, next)
        return next
      }

      function count(node: Node): number {
        return Array.from(node.children.values()).reduce((sum, child) => sum + 1 + count(child), 0)
      }

      const root: Node = { name: "", children: new Map() }
      for (const file of list) {
        if (file.includes(".opencode")) continue
        const parts = file.split(path.sep)
        if (parts.length < 2) continue
        let node = root
        for (const part of parts.slice(0, -1)) {
          node = child(node, part)
        }
      }

      const total = count(root)
      const limit = input.limit ?? total
      const lines: string[] = []
      const queue: Array<{ node: Node; path: string }> = Array.from(root.children.values())
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((node) => ({ node, path: node.name }))

      let used = 0
      for (let i = 0; i < queue.length && used < limit; i++) {
        const item = queue[i]
        lines.push(item.path)
        used++
        queue.push(
          ...Array.from(item.node.children.values())
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((node) => ({ node, path: `${item.path}/${node.name}` })),
        )
      }

      if (total > used) lines.push(`[${total - used} truncated]`)
      return lines.join("\n")
    })

    const search: Interface["search"] = Effect.fn("Ripgrep.search")(function* (input: SearchInput) {
      const useWorker = !!input.signal && typeof Worker !== "undefined"
      if (!useWorker && input.signal) {
        log.warn("worker unavailable, ripgrep abort disabled")
      }
      return yield* useWorker ? searchWorker(input) : searchDirect(input)
    })

    return Service.of({ files, tree, search })
  }),
)

export const defaultLayer = layer

export * as Ripgrep from "./ripgrep"
