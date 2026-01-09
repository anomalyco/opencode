import fs from "fs/promises"
import { $ } from "bun"
import { Log } from "@/util/log"

import { rgBin } from "./binary"
import { lazy } from "../../util/lazy"
import {
  Result as _Result,
  Match as _Match,
  Begin as _Begin,
  End as _End,
  Summary as _Summary,
} from "./schema"
import type {
  Result as _ResultType,
  Match as _MatchType,
  Begin as _BeginType,
  End as _EndType,
  Summary as _SummaryType,
} from "./schema"
import { DEFAULT_TREE_LIMIT, buildTree, sortTreeInPlace, truncateBFS, renderTree } from "./tree"
import { streamLines } from "./io"

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

  export const rg = lazy(rgBin)

  // Re-export from schema.ts
  export const Result = _Result
  export const Match = _Match
  export type Result = _ResultType
  export type Match = _MatchType
  export type Begin = _BeginType
  export type End = _EndType
  export type Summary = _SummaryType

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
