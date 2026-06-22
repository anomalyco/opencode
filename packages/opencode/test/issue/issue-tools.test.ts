import { describe, expect, test } from "bun:test"
import path from "path"
import { Effect } from "effect"
import { Issue } from "../../src/issue/issue"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Instance } from "../../src/project/instance"

const root = path.join(import.meta.dirname, "../..")
let dirCounter = 0
const freshDir = () => `/tmp/opencode-issue-tool-test/${++dirCounter}-${Date.now()}`

async function withInstance<A>(fn: () => Promise<A>): Promise<A> {
  return Instance.provide({ directory: root, fn: () => AppRuntime.runPromise(Effect.promise(() => fn())) })
}

const run = <A, E, R>(e: Effect.Effect<A, E, R>): Promise<A> =>
  AppRuntime.runPromise(e as Effect.Effect<A, E, never>)

describe("Issue tools surface", () => {
  test(
    "all six issue tools are registered in the ToolRegistry",
    async () => {
      await withInstance(async () => {
        const { ToolRegistry } = await import("../../src/tool/registry")
        const ids = await run(ToolRegistry.Service.use((svc) => svc.ids()))
        for (const id of ["issue_list", "issue_add", "issue_update", "issue_delete", "issue_status", "issue_reorder"]) {
          expect(ids).toContain(id)
        }
      })
    },
    30_000,
  )

  test("issue tools share state through the kernel Issue service", async () => {
    await withInstance(async () => {
      const dir = freshDir()
      const created = await run(
        Issue.Service.use((svc) =>
          svc.create({
            directory: dir,
            issue: { title: "tool smoke", content: "tool smoke", status: "todo", priority: "medium", level: 0 },
          }),
        ),
      )
      const after = await run(Issue.Service.use((svc) => svc.get({ directory: dir })))
      expect(after.find((i) => i.id === created.id)?.title).toBe("tool smoke")
    })
  })
})
