// Ripgrep utility functions
import { z } from "zod"
import { lazy } from "../util/lazy"
import { $ } from "bun"
import { Fzf } from "./fzf"
import { RipgrepInstaller } from "./ripgrep-installer"
import { TreeBuilder } from "./tree-builder"

export namespace Ripgrep {
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
    data: z
      .object({
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
      .openapi({ ref: "Match" }),
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
  export type Begin = z.infer<typeof Begin>
  export type End = z.infer<typeof End>
  export type Summary = z.infer<typeof Summary>

  const state = lazy(async () => {
    const filepath = await RipgrepInstaller.getExecutablePath()
    return { filepath }
  })

  export async function filepath() {
    const { filepath } = await state()
    return filepath
  }

  export async function files(input: { cwd: string; query?: string; glob?: string[]; limit?: number }) {
    const commands = [`${$.escape(await filepath())} --files --follow --hidden --glob='!.git/*'`]

    if (input.glob) {
      for (const g of input.glob) {
        commands[0] += ` --glob='${g}'`
      }
    }

    if (input.query) commands.push(`${await Fzf.filepath()} --filter=${input.query}`)
    if (input.limit) commands.push(`head -n ${input.limit}`)
    const joined = commands.join(" | ")
    const result = await $`${{ raw: joined }}`.cwd(input.cwd).nothrow().text()
    return result.split("\n").filter(Boolean)
  }

  export async function tree(input: { cwd: string; limit?: number }) {
    const files = await Ripgrep.files({ cwd: input.cwd })
    return TreeBuilder.build(files, { limit: input.limit })
  }

  export async function search(input: { cwd: string; pattern: string; glob?: string[]; limit?: number }) {
    const args = buildSearchArgs(await filepath(), input)
    const command = args.join(" ")
    
    const result = await $`${{ raw: command }}`.cwd(input.cwd).quiet().nothrow()
    if (result.exitCode !== 0) {
      return []
    }

    return parseSearchResults(result.text())
  }

  function buildSearchArgs(execPath: string, input: { pattern: string; glob?: string[]; limit?: number }): string[] {
    const args = [`${execPath}`, "--json", "--hidden", "--glob='!.git/*'"]

    if (input.glob) {
      input.glob.forEach(g => args.push(`--glob=${g}`))
    }

    if (input.limit) {
      args.push(`--max-count=${input.limit}`)
    }

    args.push(input.pattern)
    return args
  }

  function parseSearchResults(output: string): Match['data'][] {
    const lines = output.trim().split("\n").filter(Boolean)
    
    return lines
      .map((line) => JSON.parse(line))
      .map((parsed) => Result.parse(parsed))
      .filter((r): r is Match => r.type === "match")
      .map((r) => r.data)
  }
}
