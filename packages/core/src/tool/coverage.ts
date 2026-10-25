import path from "path"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { InstanceState } from "@/effect/instance-state"
import { FSUtil } from "@bolt-ai/core/fs-util"
import { Glob } from "@bolt-ai/core/util/glob"
import DESCRIPTION from "./coverage.txt"

const MATCH_LIMIT = 10

export type Entry = {
  file: string
  tests: string[]
}

/** Build the glob pattern matching conventional test files for a source file. */
export function pattern(file: string) {
  const base = path.basename(file, path.extname(file))
  if (!base) return undefined
  return `**/{${base}.test,${base}.spec,${base}_test,test_${base}}.*`
}

/** Drop dependency and VCS internals from glob matches. */
export function relevant(matches: string[]) {
  return matches.filter((match) => {
    const segments = match.split(/[\\/]/)
    return !segments.includes("node_modules") && !segments.includes(".git")
  })
}

/** Render the per-file coverage report shown to the agent. */
export function render(entries: Entry[]) {
  const covered = entries.filter((entry) => entry.tests.length > 0)
  const lines = entries.flatMap((entry) => {
    if (entry.tests.length === 0) return [`untested ${entry.file}`]
    return [
      `covered ${entry.file} (${entry.tests.length} test file${entry.tests.length === 1 ? "" : "s"})`,
      ...entry.tests.map((test) => `  ${test}`),
    ]
  })
  return [
    `${covered.length}/${entries.length} files have tests.`,
    "",
    ...lines,
    "",
    "Prefer changes in covered files. For untested files, plan to add tests first or flag the missing coverage in your handoff.",
  ].join("\n")
}

export const Parameters = Schema.Struct({
  files: Schema.Array(Schema.String).annotate({
    description: "Source files you plan to change, as paths relative to the project root.",
  }),
})

export const CoverageTool = Tool.define(
  "coverage",
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>) =>
        Effect.gen(function* () {
          if (params.files.length === 0) {
            throw new Error("Pass at least one source file to check.")
          }
          const instance = yield* InstanceState.context
          const root = instance.directory

          const entries: Entry[] = []
          for (const file of params.files) {
            const target = path.resolve(root, file)
            if (!(yield* fs.existsSafe(target))) {
              throw new Error(`No such file: ${file}`)
            }
            const glob = pattern(file)
            if (!glob) {
              entries.push({ file, tests: [] })
              continue
            }
            const matches = yield* Effect.promise(() => Glob.scan(glob, { cwd: root, dot: false }))
            entries.push({
              file,
              tests: relevant(matches).toSorted().slice(0, MATCH_LIMIT),
            })
          }

          const covered = entries.filter((entry) => entry.tests.length > 0).length
          return {
            title: `coverage: ${covered}/${entries.length} covered`,
            output: render(entries),
            metadata: {
              covered,
              untested: entries.length - covered,
            },
          }
        }),
    }
  }),
)
