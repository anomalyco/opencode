import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { ProjectV2 } from "@opencode-ai/core/project"
import { Goal } from "@/goal"
import { InstanceRef } from "@/effect/instance-ref"
import type { InstanceContext } from "@/project/instance-context"
import { tmpdir } from "../fixture/fixture"

function context(root: string): InstanceContext {
  return {
    directory: path.join(root, "packages", "opencode"),
    worktree: root,
    project: {
      id: ProjectV2.ID.make("project_123"),
      worktree: root,
      time: { created: 0, updated: 0 },
      sandboxes: [],
    },
  }
}

describe("goal service", () => {
  test("uses instance context for create and status", async () => {
    await using tmp = await tmpdir()
    const ctx = context(tmp.path)

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* Goal.Service
        const created = yield* service.create("Migrate repository to Bun")
        const status = yield* service.status()
        return { created, status }
      }).pipe(Effect.provide(Goal.defaultLayer), Effect.provideService(InstanceRef, ctx)),
    )

    expect(result.created.title).toBe("Migrate repository to Bun")
    expect(result.status.active?.goal.id).toBe(result.created.id)
    expect(await Bun.file(path.join(tmp.path, ".opencode", "goals", "active", "goal.json")).exists()).toBe(true)
  })

  test("init detects active goal without mutating it", async () => {
    await using tmp = await tmpdir()
    const ctx = context(tmp.path)

    const initialized = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* Goal.Service
        const created = yield* service.create("Migrate repository to Bun")
        const activePath = path.join(tmp.path, ".opencode", "goals", "active", "goal.json")
        const before = yield* Effect.promise(() => fs.readFile(activePath, "utf8"))
        const init = yield* service.init()
        const after = yield* Effect.promise(() => fs.readFile(activePath, "utf8"))
        return { created, init, before, after }
      }).pipe(Effect.provide(Goal.defaultLayer), Effect.provideService(InstanceRef, ctx)),
    )

    expect(initialized.init?.goal).toEqual(initialized.created)
    expect(initialized.after).toBe(initialized.before)
  })
})
