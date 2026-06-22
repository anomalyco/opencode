import { describe, expect, test } from "bun:test"
import path from "path"
import { Effect } from "effect"
import { Issue } from "../../src/issue/issue"
import { AutoProgress } from "../../src/issue/auto-progress"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Instance } from "../../src/project/instance"

const root = path.join(import.meta.dirname, "../..")
let dirCounter = 0
const freshDir = () => `/tmp/opencode-issue-ap-test/${++dirCounter}-${Date.now()}`

async function withInstance<A>(fn: () => Promise<A>): Promise<A> {
  return Instance.provide({ directory: root, fn: () => AppRuntime.runPromise(Effect.promise(() => fn())) })
}

const run = <A, E, R>(e: Effect.Effect<A, E, R>): Promise<A> => AppRuntime.runPromise(e as Effect.Effect<A, E, never>)

const createL1 = (directory: string, title: string, status: Issue.Status = "todo") =>
  run(
    Issue.Service.use((svc) =>
      svc.create({
        directory,
        issue: { title, content: title, status, priority: "medium", level: 0 },
      }),
    ),
  )

const createL2 = (directory: string, parent: Issue.Info, title: string, status: Issue.Status = "todo") =>
  run(
    Issue.Service.use((svc) =>
      svc.create({
        directory,
        issue: {
          title,
          content: title,
          status,
          priority: "medium",
          level: 1,
          parent_id: parent.id,
        },
      }),
    ),
  )

const get = (directory: string) => run(Issue.Service.use((svc) => svc.get({ directory })))

const patchStatus = async (directory: string, id: string, status: Issue.Status) => {
  await run(Issue.Service.use((svc) => svc.patchStatus({ directory, id, status })))
  // In production, Issue.patchStatus invokes the AutoProgress tick via a
  // shared onStatusChange hook that AutoProgress registers during layer
  // init. The bus.subscribe path that the hook wraps cannot survive across
  // the per-directory InstanceState boundary in this test setup, so the
  // test calls tick() directly. The behavior under test is the cascade
  // logic in advance(), which is exactly what tick() invokes.
  await apTick(directory)
}

const apStart = (directory: string) => run(AutoProgress.Service.use((svc) => svc.start(directory)))

const apStop = (directory: string) => run(AutoProgress.Service.use((svc) => svc.stop(directory)))

const apTick = (directory: string) => run(AutoProgress.Service.use((svc) => svc.tick(directory)))

const apStatus = (directory: string) => run(AutoProgress.Service.use((svc) => svc.status(directory)))

const apIsActive = (directory: string) => run(AutoProgress.Service.use((svc) => svc.isActive(directory)))

describe("Issue.AutoProgress", () => {
  test("start is idempotent; stop deactivates", async () => {
    await withInstance(async () => {
      const dir = freshDir()
      await apStart(dir)
      await apStart(dir)
      expect(await apIsActive(dir)).toBe(true)
      await apStop(dir)
      expect(await apIsActive(dir)).toBe(false)
    })
  })

  test("promotes first pending L1 to in_progress on start", async () => {
    await withInstance(async () => {
      const dir = freshDir()
      await createL1(dir, "first", "todo")
      await createL1(dir, "second", "todo")
      await apStart(dir)
      const list = await get(dir)
      const inProgress = list.filter((i) => i.status === "in_progress")
      expect(inProgress.length).toBe(1)
      expect(inProgress[0].title).toBe("first")
    })
  })

  test("L1 with all-done children auto-completes; next pending L1 starts", async () => {
    await withInstance(async () => {
      const dir = freshDir()
      const a = await createL1(dir, "a", "todo")
      await createL2(dir, a, "a-1", "todo")
      await createL2(dir, a, "a-2", "todo")
      await createL1(dir, "b", "todo")

      await apStart(dir)

      // After start: a → in_progress, both kids → in_progress; b stays todo
      const after = await get(dir)
      const aRow = after.find((i) => i.id === a.id)!
      expect(aRow.status).toBe("in_progress")
      const kids = after.filter((i) => i.parent_id === a.id)
      expect(kids.length).toBe(2)
      expect(kids.every((k) => k.status === "in_progress")).toBe(true)

      // Mark both kids done; engine should complete a and start b
      for (const k of kids) {
        await patchStatus(dir, k.id, "done")
      }

      const after2 = await get(dir)
      const aRow2 = after2.find((i) => i.id === a.id)!
      expect(aRow2.status).toBe("done")
      const bRow = after2.find((i) => i.title === "b")!
      expect(bRow.status).toBe("in_progress")
    })
  })

  test("status reports running/active; stop transitions to idle", async () => {
    await withInstance(async () => {
      const dir = freshDir()
      expect(await apStatus(dir)).toBe("idle")
      await apStart(dir)
      expect(await apStatus(dir)).toBe("running")
      await apStop(dir)
      expect(await apStatus(dir)).toBe("idle")
    })
  })
})
