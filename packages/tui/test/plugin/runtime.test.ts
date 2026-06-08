import { expect, test } from "bun:test"
import { createPluginRuntime } from "../../src/plugin/runtime"

test("routes use the latest registration and restore previous registrations", () => {
  const runtime = createPluginRuntime()
  const first = () => "first"
  const second = () => "second"
  runtime.routes.register([{ name: "demo", render: first }])
  const dispose = runtime.routes.register([{ name: "demo", render: second }])

  expect(runtime.routes.get("demo")).toBe(second)
  dispose()
  expect(runtime.routes.get("demo")).toBe(first)
})

test("facade publishes and clears presentation state", async () => {
  const runtime = createPluginRuntime()
  runtime.update({
    commands: {
      async activate() {
        return true
      },
      async deactivate() {
        return true
      },
      async add() {
        return true
      },
      async install() {
        return { ok: true, dir: "/tmp", tui: true }
      },
    },
    status: [
      {
        id: "demo",
        source: "internal",
        spec: "demo",
        target: "demo",
        enabled: true,
        active: true,
      },
    ],
  })

  expect(await runtime.commands().activate("demo")).toBe(true)
  expect(runtime.status()).toHaveLength(1)
  runtime.clear()
  expect(await runtime.commands().activate("demo")).toBe(false)
  expect(runtime.status()).toEqual([])
})
