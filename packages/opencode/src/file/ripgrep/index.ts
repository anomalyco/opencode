import fs from "fs/promises"

import { $ } from "bun"
import z from "zod"

import { lazy } from "@/util/lazy.ts"
import { Log } from "@/util/log"

import { rgBin } from "./binary"
import { streamLines } from "./io"
import { DEFAULT_TREE_LIMIT, buildTree, sortTreeInPlace, truncateBFS, renderTree } from "./tree"

export namespace Ripgrep {
  const log = Log.create({ service: "ripgrep" })

  const MAX_BUFFER_BYTES = 20 * 1024 * 1024

  interface FilesInput {
    cwd: string
    glob?: string[]
    hidden?: boolean
    follow?: boolean
    maxDepth?: number
  }

  // Schemas for parsing ripgrep JSON output
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

  export const Result = z.union([Begin, Match, End, Summary])

  export type Result = z.infer<typeof Result>
  export type Match = z.infer<typeof Match>
  export type Begin = z.infer<typeof Begin>
  export type End = z.infer<typeof End>
  export type Summary = z.infer<typeof Summary>

  export const rg = lazy(rgBin)

  export async function* files(input: FilesInput) {
    // Bun.spawn should throw this, but it incorrectly reports that the executable does not exist.
    // See https://github.com/oven-sh/bun/issues/24012
    if (!(await fs.stat(input.cwd).catch(() => undefined))?.isDirectory()) {
      throw Object.assign(new Error(`No such file or directory: '${input.cwd}'`), {
        code: "ENOENT",
        errno: -2,
        path: input.cwd,
      })
    }

    const args = ["--files", "--glob=!.git/*"]
    if (input.follow !== false) args.push("--follow")
    if (input.hidden !== false) args.push("--hidden")
    if (input.maxDepth !== undefined) args.push(`--max-depth=${input.maxDepth}`)
    for (const g of input.glob ?? []) args.push(`--glob=${g}`)

    const proc = Bun.spawn([await rg(), ...args], {
      cwd: input.cwd,
      stdout: "pipe",
      stderr: "ignore",
      maxBuffer: MAX_BUFFER_BYTES,
    })

    yield* streamLines(proc.stdout)

    await proc.exited
  }

  export async function tree(input: { cwd: string; limit?: number }) {
    log.info("tree", input)
    const files = await Array.fromAsync(Ripgrep.files({ cwd: input.cwd }))
    const root = buildTree(files)
    sortTreeInPlace(root)
    const truncated = truncateBFS(root, input.limit ?? DEFAULT_TREE_LIMIT)
    return renderTree(truncated)
  }

  export async function search(input: { cwd: string; pattern: string; glob?: string[]; limit?: number }) {
    const args = [`${await rg()}`, "--json", "--hidden", "--glob='!.git/*'"]

    for (const g of input.glob ?? []) {
      args.push(`--glob=${g}`)
    }

    if (input.limit) {
      args.push(`--max-count=${input.limit}`)
    }

    args.push("--")
    args.push(input.pattern)

    const command = args.join(" ")
    const searchResult = await $`${{ raw: command }}`.cwd(input.cwd).quiet().nothrow()
    if (searchResult.exitCode !== 0) {
      return []
    }

    // Handle both Unix (\n) and Windows (\r\n) line endings
    const lines = searchResult.text().trim().split(/\r?\n/).filter(Boolean)

    return lines
      .map((line) => JSON.parse(line))
      .map((parsed) => Result.parse(parsed))
      .filter((r) => r.type === "match")
      .map((r) => r.data)
  }
}
