export * as AutoFix from "."

import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { Context, Effect, Layer } from "effect"

export type LintTool = "tsc" | "biome" | "eslint" | "oxlint"

export type LintResult = {
  tool: string
  raw: string
  fixable: boolean
  errorCount: number
}

export interface Interface {
  readonly run: (files: string[]) => Effect.Effect<LintResult[], Error>
  readonly fix: (files: string[]) => Effect.Effect<{
    fixed: string[]
    remaining: string
  }, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/AutoFix") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service

    const detectTools = Effect.fnUntraced(function* () {
      const cfg = yield* config.get()
      const af = cfg.autoFix
      if (!af?.enabled) return [] as LintTool[]

      const configured = af.tools
      const available: LintTool[] = []
      if (!configured || configured.includes("tsc")) available.push("tsc")
      return available
    })

    const run = Effect.fn("AutoFix.run")(function* (files: string[]) {
      const tools = yield* detectTools()
      if (tools.length === 0 || files.length === 0) return [] as LintResult[]

      const results: LintResult[] = []
      for (const tool of tools) {
        if (tool === "tsc") {
          const proc = Bun.spawn(["bun", "typecheck"], {
            cwd: process.cwd(),
            stdio: ["ignore", "pipe", "pipe"],
          })
          const text = yield* Effect.promise(() => new Response(proc.stderr).text()).pipe(Effect.option)
          if (text._tag === "Some" && text.value.length > 0) {
            results.push({
              tool: "tsc",
              raw: text.value,
              fixable: false,
              errorCount: text.value.split("\n").filter((l) => l.includes("error TS")).length,
            })
          }
        }
      }
      return results
    })

    const fix = Effect.fn("AutoFix.fix")(function* (files: string[]) {
      const results = yield* run(files)
      const remaining = results
        .filter((r) => r.errorCount > 0 && !r.fixable)
        .map((r) => `${r.tool}: ${r.errorCount} errors\n${r.raw}`)
        .join("\n\n")
      return { fixed: files, remaining }
    })

    return Service.of({ run, fix })
  }),
)

export { layer }
