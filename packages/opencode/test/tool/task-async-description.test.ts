import { afterEach, expect, test } from "bun:test"
import { Effect } from "effect"
import { Agent } from "../../src/agent/agent"
import { Config } from "../../src/config"
import { Permission } from "../../src/permission"
import { Instance } from "../../src/project/instance"
import { TaskAsyncDescription } from "../../src/tool/task/task_async"
import { provideInstance, tmpdir } from "../fixture/fixture"

function load<A>(dir: string, fn: (svc: Agent.Interface) => Effect.Effect<A>) {
  return Effect.runPromise(provideInstance(dir)(Agent.Service.use(fn)).pipe(Effect.provide(Agent.defaultLayer)))
}

function describe(dir: string, permission: NonNullable<Config.Info["permission"]>["task_async"]) {
  return Effect.runPromise(
    provideInstance(dir)(
      TaskAsyncDescription({
        name: "synthetic",
        mode: "primary",
        permission: Permission.fromConfig({ task_async: permission }),
        options: {},
      } as Agent.Info).pipe(Effect.provide(Agent.defaultLayer)),
    ),
  )
}

afterEach(async () => {
  await Instance.disposeAll()
})

test("task_async description is permission-shaped and includes visible permitted subagent descriptions", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const explorer = await load(tmp.path, (svc) => svc.get("explorer"))
      const librarian = await load(tmp.path, (svc) => svc.get("librarian"))
      const text = await describe(tmp.path, {
        "*": "deny",
        start: "allow",
        wait: "allow",
        status: "allow",
        explorer: "allow",
        librarian: "allow",
      })

      expect(text).toContain("The dynamic sections below describe the `task_async` lifecycle that is currently available for this caller")
      expect(text).toContain("Recommended lifecycle for this caller")
      expect(text).toContain("Subagents available through `start` and when to use them:")
      expect(text).toContain(explorer?.description ?? "")
      expect(text).toContain(librarian?.description ?? "")
      expect(text).not.toContain("For `ayaz`")
      expect(text).not.toContain("For `atlas`")
      expect(text).not.toContain("For `niggli`")
      expect(text).not.toContain("`lead` should use `task_async`")
    },
  })
})

test("task_async description degrades to follow-up guidance when start is denied", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const text = await describe(tmp.path, {
        "*": "deny",
        wait: "allow",
        status: "allow",
      })

      expect(text).toContain("`task_async` is currently a follow-up surface for this caller")
      expect(text).toContain("`wait` [allowed]")
      expect(text).toContain("`status` [allowed]")
      expect(text).toContain("Denied for this caller:")
      expect(text).toContain("`start`")
      expect(text).toContain("`message`")
      expect(text).toContain("`resume`")
      expect(text).toContain("`abort`")
      expect(text).toContain("`start` is denied for this caller, so the startable subagent list is omitted.")
    },
  })
})
