export * as TestGen from "."

import { Config } from "@/config/config"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Context, Effect, Layer } from "effect"
import path from "path"
import fs from "fs/promises"

export interface TestResult {
  filePath: string
  framework: string
  passed: boolean
  output: string
}

export interface Interface {
  readonly detectFramework: (root: string) => Effect.Effect<string>
  readonly generateTestPath: (sourcePath: string, root: string) => string
  readonly runTests: (filePath: string, root: string) => Effect.Effect<TestResult>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/TestGen") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service

    const detectFramework = Effect.fn("TestGen.detectFramework")(function* (root: string) {
      const cfg = yield* config.get()
      if (cfg.testing?.framework) return cfg.testing.framework

      try {
        const content = yield* Effect.promise(() => fs.readFile(path.join(root, "package.json"), "utf-8"))
        const pkg = JSON.parse(content)
        const deps = { ...pkg.devDependencies, ...pkg.dependencies } as Record<string, string>
        if (deps?.vitest) return "vitest"
        if (deps?.["@playwright/test"] || deps?.playwright) return "playwright"
        if (deps?.jest) return "jest"
        if (deps?.mocha) return "mocha"
      } catch {}

      return "bun"
    })

    const generateTestPath = (sourcePath: string, root: string) => {
      const rel = path.relative(root, sourcePath)
      const dir = path.dirname(rel)
      const base = path.basename(sourcePath, path.extname(sourcePath))
      return path.join(root, dir, "__tests__", `${base}.test.ts`)
    }

    const runTests = Effect.fn("TestGen.runTests")(function* (filePath: string, root: string) {
      const framework = yield* detectFramework(root)
      const cfg = yield* config.get()
      const cmd = cfg.testing?.testCommand ?? (framework === "jest" ? "npx jest" : "bun test")
      const proc = Bun.spawn(cmd.split(" ").concat([filePath]), {
        cwd: root,
        stdio: ["ignore", "pipe", "pipe"],
      })
      const [stdout, stderr, exitCode] = yield* Effect.promise(async () => {
        const out = await new Response(proc.stdout).text()
        const err = await new Response(proc.stderr).text()
        const code = await proc.exited
        return [out, err, code] as const
      })
      const output = stdout + stderr
      const passed = !output.includes("FAIL") && !output.includes("fail") && exitCode === 0
      return { filePath, framework, passed, output }
    })

    return Service.of({ detectFramework, generateTestPath, runTests })
  }),
)

export { layer }

export const node = LayerNode.make({ service: Service, layer, deps: [Config.node] })
