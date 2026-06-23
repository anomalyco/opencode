import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import fs from "fs/promises"
import path from "path"
import { Command } from "@/command"
import { disposeAllInstances, provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

// Command.defaultLayer now provides Workflow (Delta 5a) so list() can discover
// workflows as Command.Info entries with source "workflow". CrossSpawnSpawner is
// merged because Workflow.defaultLayer needs a ChildProcessSpawner.
const it = testEffect(Layer.mergeAll(Command.defaultLayer, CrossSpawnSpawner.defaultLayer))

async function writeWorkflow(dir: string, name: string, source: string) {
  const workflows = path.join(dir, ".opencode", "workflows")
  await fs.mkdir(workflows, { recursive: true })
  await Bun.write(path.join(workflows, `${name}.ts`), source)
}

const DEMO_SOURCE = `export const meta = {
  name: "Demo",
  description: "A demo workflow.",
  phases: ["run"]
}
export async function run(args, ctx) { ctx.setPhase("run"); return { ok: true } }
`

describe("Command discovers workflows as source 'workflow'", () => {
  afterEach(() => disposeAllInstances())

  it.live("discovers a workflow as a Command.Info with source 'workflow'", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => writeWorkflow(dir, "demo", DEMO_SOURCE))
        const command = yield* Command.Service
        const list = yield* command.list()
        const wf = list.find((c) => c.name === "demo")
        expect(wf).toBeDefined()
        expect(wf!.source).toBe("workflow")
        expect(wf!.description).toContain("A demo workflow.")
      }),
    ),
  )

  it.live("a workflow whose name collides with a real command is NOT registered as a workflow command", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => writeWorkflow(dir, "init", DEMO_SOURCE)) // 'init' is a built-in command
        const command = yield* Command.Service
        const list = yield* command.list()
        expect(list.find((c) => c.name === "init")!.source).toBe("command") // built-in wins
      }),
    ),
  )
})
