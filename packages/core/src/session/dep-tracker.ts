export * as DependencyTracker from "./dep-tracker"

import { Context, Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { Ripgrep } from "../ripgrep"
import { Location } from "../location"

export const NameUsage = Schema.Struct({
  name: Schema.String,
  file: Schema.String,
  line: Schema.Finite,
  snippet: Schema.String,
})
export type NameUsage = typeof NameUsage.Type

export const DepChange = Schema.Struct({
  name: Schema.String,
  kind: Schema.Literals(["function", "type", "interface", "class", "export"]),
  callers: Schema.Array(NameUsage),
  testFiles: Schema.Array(NameUsage),
})
export type DepChange = typeof DepChange.Type

export interface Interface {
  readonly findUsages: (input: {
    readonly directory: string
    readonly names: ReadonlyArray<{ name: string; kind: string }>
  }) => Effect.Effect<ReadonlyArray<DepChange>>

  readonly findTestFiles: (input: {
    readonly directory: string
    readonly changedFiles: ReadonlyArray<string>
  }) => Effect.Effect<ReadonlyArray<string>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/DependencyTracker") {}

const TEST_FILE_RE = /\.(test|spec)\.[^/]+$/
const TEST_DIR_RE = /\/[(_]tests?[)_]\/|__tests__\//

const isTestFile = (filePath: string) => TEST_FILE_RE.test(filePath) || TEST_DIR_RE.test(filePath)

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const ripgrep = yield* Ripgrep.Service

    return Service.of({
      findUsages: Effect.fn("DependencyTracker.findUsages")(function* (input) {
        const results: DepChange[] = []
        const testExts = "*.{test.*,spec.*,test.ts,spec.ts,test.tsx,spec.tsx}"

        for (const { name, kind } of input.names) {
          const matches = yield* ripgrep
            .grep({
              cwd: input.directory,
              pattern: `\\b${name}\\b`,
              include: "*.{ts,tsx,js,jsx}",
              limit: 30,
            })
            .pipe(Effect.catch(() => Effect.succeed([])))

          const callers: NameUsage[] = []
          const testFiles: NameUsage[] = []

          for (const m of matches) {
            const filePath = String(m.entry.path)
            const usage: NameUsage = {
              name,
              file: filePath,
              line: m.line,
              snippet: m.text.trim().slice(0, 120),
            }
            if (isTestFile(filePath)) {
              testFiles.push(usage)
            } else {
              callers.push(usage)
            }
          }

          results.push({
            name,
            kind: kind as any,
            callers: callers.slice(0, 20),
            testFiles: testFiles.slice(0, 10),
          })
        }

        return results
      }),

      findTestFiles: Effect.fn("DependencyTracker.findTestFiles")(function* (input) {
        const files: string[] = []
        for (const cf of input.changedFiles) {
          const baseName = cf.replace(/\.[^.]+$/, "")
          const testMatches = yield* ripgrep
            .glob({
              cwd: input.directory,
              pattern: `**/{${baseName}.test.*,${baseName}.spec.*,__tests__/**/${baseName}.*,test/**/${baseName}.*}`,
              limit: 10,
            })
            .pipe(Effect.catch(() => Effect.succeed([])))
          for (const m of testMatches) {
            files.push(String(m.path))
          }
        }
        return files
      }),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Ripgrep.node, Location.node],
})
