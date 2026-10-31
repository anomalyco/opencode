import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { OpenCode } from "@opencode/client"
import { Effect, Schedule } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { startServer } from "./fixture/server"

it.live("installs and toggles a reviewed package through the current client and runtime", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-marketplace-api-")))
    const project = path.join(tmp.path, "project")
    const catalog = path.join(tmp.path, "marketplace.json")
    const config = '{\n  // user-owned\n  "commands": { "keep": { "template": "Keep me" } }\n}\n'
    yield* Effect.promise(async () => {
      await fs.mkdir(project)
      await Bun.write(path.join(project, "opencode.jsonc"), config)
      await Bun.write(
        catalog,
        JSON.stringify({
          schema: "opencode.marketplace/v1",
          id: "local",
          name: "Local",
          items: [
            {
              id: "review",
              name: "Review",
              description: "Review changes",
              kind: "agent",
              version: "1.0.0",
              install: { agents: { review: { description: "Review", prompt: "reviewed" } } },
            },
          ],
        }),
      )
    })
    const server = yield* startServer(tmp.path)
    const client = OpenCode.make({ baseUrl: server.base, headers: server.headers })
    const api = client.experimental.marketplace
    const location = { directory: project }
    const added = (yield* Effect.promise(() =>
      api.sourceAdd({ location, expected_revision: 0, url: catalog, trust: "private" }),
    )).data
    if (!added.ok) throw new Error(added.message)
    const key = added.view.listings[0]?.key
    if (!key) throw new Error("Expected a listing")
    const planned = (yield* Effect.promise(() => api.plan({ location, key }))).data
    if (!planned.ok) throw new Error(planned.message)
    const applied = (yield* Effect.promise(() =>
      api.install({ location, plan_id: planned.plan_id, expected_revision: planned.revision, accept_untrusted: true }),
    )).data
    if (!applied.ok) throw new Error(applied.message)
    const agents = () => Effect.promise(() => client.agent.list({ location })).pipe(Effect.map((value) => value.data))
    const present = (enabled: boolean) =>
      agents().pipe(
        Effect.repeat({
          until: (items) => items.some((item) => item.id === "review") === enabled,
          schedule: Schedule.spaced("5 millis"),
        }),
        Effect.timeout("5 seconds"),
      )
    expect((yield* present(true)).find((item) => item.id === "review")?.system).toBe("reviewed")
    const replay = (yield* Effect.promise(() =>
      api.install({
        location,
        plan_id: planned.plan_id,
        expected_revision: applied.view.state.revision ?? 0,
        accept_untrusted: true,
      }),
    )).data
    expect(replay).toMatchObject({ ok: false, reason: "plan_consumed" })
    const toggled = (yield* Effect.promise(() =>
      api.toggle({
        location,
        key,
        expected_revision: applied.view.state.revision ?? 0,
        component: "package",
        enabled: false,
      }),
    )).data
    if (!toggled.ok) throw new Error(toggled.message)
    expect((yield* present(false)).some((item) => item.id === "review")).toBe(false)
    const removed = (yield* Effect.promise(() =>
      api.uninstall({ location, key, expected_revision: toggled.view.state.revision ?? 0 }),
    )).data
    expect(removed.ok).toBe(true)
    expect(yield* Effect.promise(() => Bun.file(path.join(project, "opencode.jsonc")).text())).toBe(config)
    expect(
      (yield* Effect.promise(() => client.command.list({ location }))).data.some((item) => item.name === "keep"),
    ).toBe(true)
  }),
)
