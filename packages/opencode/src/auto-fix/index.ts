export * as AutoFix from "."

import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { Snapshot } from "@/snapshot"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Context, Effect, Layer } from "effect"
import { existsSync } from "fs"
import path from "path"

export type LintTool = "tsc" | "biome" | "eslint" | "oxlint"

export type LintResult = {
  tool: string
  raw: string
  fixable: boolean
  errorCount: number
}

export const BIOME_CONFIG_FILES = ["biome.json", "biome.jsonc"]

export interface Interface {
  readonly detectTools: () => Effect.Effect<LintTool[]>
  readonly run: (files: string[]) => Effect.Effect<LintResult[], Error>
  readonly fix: (files: string[]) => Effect.Effect<{
    fixed: string[]
    remaining: string
  }, Error>
  readonly runAndFix: (options: {
    sessionID: string
    promptOps: {
      prompt: (input: any) => Effect.Effect<any>
      resolvePromptParts: (template: string) => Effect.Effect<any[]>
    }
  }) => Effect.Effect<{
    iterationCount: number
    fixed: boolean
    summary: string
  }, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/AutoFix") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const snapshot = yield* Snapshot.Service

    const detectTools = Effect.fnUntraced(function* () {
      const cfg = yield* config.get()
      const af = cfg.autoFix
      if (!af?.enabled) return [] as LintTool[]

      const configured = af.tools
      const ctx = yield* InstanceState.context
      const available: LintTool[] = []

      if (!configured || configured.includes("tsc")) {
        available.push("tsc")
      }
      if (!configured || configured.includes("biome")) {
        if (BIOME_CONFIG_FILES.some((f) => existsSync(path.join(ctx.worktree, f)))) {
          available.push("biome")
        }
      }
      if (!configured || configured.includes("eslint")) {
        if (existsSync(path.join(ctx.worktree, ".eslintrc")) ||
            existsSync(path.join(ctx.worktree, ".eslintrc.json")) ||
            existsSync(path.join(ctx.worktree, ".eslintrc.js")) ||
            existsSync(path.join(ctx.worktree, "eslint.config.js"))) {
          available.push("eslint")
        }
      }
      if (!configured || configured.includes("oxlint")) {
        if (existsSync(path.join(ctx.worktree, "oxlintrc.json")) ||
            existsSync(path.join(ctx.worktree, ".oxlintrc.json"))) {
          available.push("oxlint")
        }
      }
      return available
    })

    const runTool = (tool: LintTool): Effect.Effect<LintResult, Error> =>
      Effect.gen(function* () {
        const ctx = yield* InstanceState.context
        const cwd = ctx.worktree
        const shell = (cmd: string[]) =>
          Effect.try({
            try: () => {
              const proc = Bun.spawn(cmd, { cwd, stdio: ["ignore", "pipe", "pipe"] })
              return proc
            },
            catch: (error) => new Error(`Failed to spawn process: ${error}`),
          }).pipe(
            Effect.flatMap((proc) =>
              Effect.promise<{ stdout: string; stderr: string; exitCode: number }>(async () => {
                const stdout = await new Response(proc.stdout).text()
                const stderr = await new Response(proc.stderr).text()
                const exitCode = await proc.exited
                return { stdout, stderr, exitCode }
              })
            ),
          )

        if (tool === "tsc") {
          const { stderr } = yield* shell(["bun", "typecheck"])
          const errorCount = stderr.split("\n").filter((l) => l.includes("error TS")).length
          return { tool: "tsc", raw: stderr, fixable: false, errorCount }
        }

        if (tool === "biome") {
          const { stdout, stderr } = yield* shell(["npx", "@biomejs/biome", "check", "--reporter=json", "."])
          const raw = stdout || stderr
          let errorCount = 0
          try {
            const json = JSON.parse(stdout)
            if (Array.isArray(json.diagnostics)) errorCount = json.diagnostics.length
          } catch {}
          return { tool: "biome", raw, fixable: errorCount > 0, errorCount }
        }

        if (tool === "eslint") {
          const { stdout, stderr } = yield* shell(["npx", "eslint", "--format=json", "."])
          const raw = stdout || stderr
          let errorCount = 0
          try {
            const json = JSON.parse(stdout)
            if (Array.isArray(json)) errorCount = json.reduce((sum, file) => sum + (file.errorCount ?? 0), 0)
            else if (json.errorCount !== undefined) errorCount = json.errorCount
          } catch {}
          return { tool: "eslint", raw, fixable: errorCount > 0, errorCount }
        }

        if (tool === "oxlint") {
          const { stdout, stderr } = yield* shell(["npx", "oxlint", "--format=json", "."])
          const raw = stdout || stderr
          let errorCount = 0
          try {
            const json = JSON.parse(stdout)
            if (json.errorCount !== undefined) errorCount = json.errorCount
            else if (json.numErrors !== undefined) errorCount = json.numErrors
          } catch {}
          return { tool: "oxlint", raw, fixable: errorCount > 0, errorCount }
        }

        return { tool, raw: "", fixable: false, errorCount: 0 }
      })

    const run = Effect.fn("AutoFix.run")(function* (files: string[]) {
      const tools = yield* detectTools()
      if (tools.length === 0) return [] as LintResult[]

      const results: LintResult[] = []
      for (const tool of tools) {
        const result = yield* runTool(tool)
        results.push(result)
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

    const runAndFix = Effect.fn("AutoFix.runAndFix")(function* (options: {
      sessionID: string
      promptOps: {
        prompt: (input: any) => Effect.Effect<any>
        resolvePromptParts: (template: string) => Effect.Effect<any[]>
      }
    }) {
      const cfg = yield* config.get()
      const af = cfg.autoFix
      if (!af?.enabled) return { iterationCount: 0, fixed: true, summary: "autoFix disabled" }

      const maxIterations = af.maxIterations ?? 3
      const tools = yield* detectTools()
      if (tools.length === 0) return { iterationCount: 0, fixed: true, summary: "no tools detected" }

      let iterationCount = 0
      let allFixed = true
      const logs: string[] = []

      for (let i = 0; i < maxIterations; i++) {
        iterationCount++
        const results: LintResult[] = []
        for (const tool of tools) {
          const result = yield* runTool(tool)
          if (result.errorCount > 0) results.push(result)
        }

        if (results.length === 0) {
          logs.push(`All checks passed after ${iterationCount} iteration(s)`)
          allFixed = true
          break
        }

        allFixed = false
        const errorSummary = results
          .map((r) => `${r.tool} (${r.errorCount} errors):\n${r.raw}`)
          .join("\n\n")

        // First try biome --fix for auto-fixable errors
        if (tools.includes("biome")) {
          const ctx = yield* InstanceState.context
          yield* Effect.promise(async () => {
            const proc = Bun.spawn(["npx", "@biomejs/biome", "check", "--write", "."], {
              cwd: ctx.worktree,
              stdio: ["ignore", "pipe", "pipe"],
            })
            await new Response(proc.stdout).text()
            await new Response(proc.stderr).text()
            await proc.exited
          }).pipe(Effect.ignore)
        }

        if (i < maxIterations - 1) {
          logs.push(`Iteration ${i + 1}: sending errors to agent for fixes`)
          const fixPrompt = [
            `The following lint/type errors were found. Please fix them:`,
            ``,
            errorSummary,
            ``,
            `Fix all the errors listed above. Do not change unrelated code.`,
          ].join("\n")
          const parts = yield* options.promptOps.resolvePromptParts(fixPrompt)
          yield* options.promptOps.prompt({
            sessionID: options.sessionID,
            agent: "build",
            parts,
          }).pipe(Effect.ignore)
        } else {
          logs.push(`Max iterations (${maxIterations}) reached. Remaining errors:\n${errorSummary}`)
        }
      }

      return {
        iterationCount,
        fixed: allFixed,
        summary: logs.join("\n"),
      }
    })

    return Service.of({ detectTools, run, fix, runAndFix })
  }),
)

export { layer }

export const node = LayerNode.make({ service: Service, layer, deps: [Config.node, Snapshot.node] })
