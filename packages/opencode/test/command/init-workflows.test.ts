import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import fs from "fs/promises"
import path from "path"
import { Command } from "@/command"
import { disposeAllInstances, provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(Command.defaultLayer, CrossSpawnSpawner.defaultLayer))

async function writeWorkflow(dir: string, name: string, source: string) {
  const workflows = path.join(dir, ".opencode", "workflows")
  await fs.mkdir(workflows, { recursive: true })
  await Bun.write(path.join(workflows, `${name}.ts`), source)
}

const DEPLOY = `export const meta = { name: "deploy", description: "Ship the app to prod.", phases: ["run"] }
export async function run(args, ctx) { ctx.setPhase("run"); return { ok: true } }
`
const AUDIT = `export const meta = { name: "audit", whenToUse: "Run a security audit pass.", phases: ["run"] }
export async function run(args, ctx) { ctx.setPhase("run"); return { ok: true } }
`

describe("/init lists available workflows in its AGENTS.md prompt", () => {
  afterEach(() => disposeAllInstances())

  it.live("the init template includes an Available workflows section with names + descriptions", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => writeWorkflow(dir, "deploy", DEPLOY))
        yield* Effect.promise(() => writeWorkflow(dir, "audit", AUDIT))
        const command = yield* Command.Service
        const init = yield* command.get("init")
        const template =
          typeof init!.template === "string"
            ? init!.template
            : yield* Effect.promise(() => Promise.resolve(init!.template))
        expect(template).toContain("Available workflows")
        expect(template).toContain("deploy")
        expect(template).toContain("Ship the app to prod.")
        expect(template).toContain("audit")
        // Falls back to whenToUse when description is absent.
        expect(template).toContain("Run a security audit pass.")
        // The base init prompt is preserved.
        expect(template).toContain("Create or update `AGENTS.md`")
      }),
    ),
  )

  it.live("the init template has NO workflows section when no repo workflows exist (builtins excluded)", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const command = yield* Command.Service
        const init = yield* command.get("init")
        const template =
          typeof init!.template === "string"
            ? init!.template
            : yield* Effect.promise(() => Promise.resolve(init!.template))
        // No repo-defined workflows ⇒ no section. The builtin deep-research workflow
        // ships inside opencode (source_kind "builtin"), so it is NOT documented as a
        // repository workflow in the init prompt.
        expect(template).not.toContain("Available workflows")
        expect(template).not.toContain("deep-research")
        expect(template).toContain("Create or update `AGENTS.md`")
      }),
    ),
  )

  it.live("a broken (invalid) workflow file is not listed in the init template", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => writeWorkflow(dir, "broken", "this is not a valid workflow module"))
        const command = yield* Command.Service
        const init = yield* command.get("init")
        const template =
          typeof init!.template === "string"
            ? init!.template
            : yield* Effect.promise(() => Promise.resolve(init!.template))
        // No valid workflows ⇒ no section at all.
        expect(template).not.toContain("Available workflows")
        expect(template).not.toContain("broken")
      }),
    ),
  )
})
