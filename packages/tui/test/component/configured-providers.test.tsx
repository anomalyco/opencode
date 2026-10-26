import { expect, test } from "bun:test"
import { CliRenderEvents, InputRenderable } from "@opentui/core"
import { once } from "node:events"
import { DialogIntegration } from "../../src/component/dialog-integration"
import { DialogModel } from "../../src/component/dialog-model"
import { model, renderLocal } from "../fixture/local"
import { directory, json } from "../fixture/tui-client"

test("identifies models with the same name from config-only integrations", async () => {
  await using setup = await renderLocal({
    models: ["one", "two"].map((providerID) => ({ ...model("chat"), providerID, name: "Same Model" })),
    fetch: (url) => {
      if (url.pathname === "/api/integration")
        return json({
          location: { directory },
          data: [
            { id: "one", name: "Gateway One", configured: true, methods: [], connections: [] },
            { id: "two", name: "Gateway Two", configured: true, methods: [], connections: [] },
          ],
        })
      if (url.pathname === "/api/provider")
        return json({
          location: { directory },
          data: [
            { id: "one", name: "Gateway One" },
            { id: "two", name: "Gateway Two" },
          ],
        })
    },
  })
  setup.dialog.replace(() => <DialogModel />)
  await setup.renderOnce()
  expect(setup.captureCharFrame()).toContain("Gateway One")
  expect(setup.captureCharFrame()).toContain("Gateway Two")

  // DialogSelect defers filter focus until after its first render.
  if (!(setup.renderer.currentFocusedRenderable instanceof InputRenderable))
    await once(setup.renderer, CliRenderEvents.FOCUSED_RENDERABLE)
  await setup.mockInput.typeText("Same Model")
  await setup.renderOnce()
  const rows = setup
    .captureCharFrame()
    .split("\n")
    .filter((line) => line.includes("Same Model") && line.includes("Gateway"))
  expect(rows).toHaveLength(2)
  expect(rows.some((line) => line.includes("Gateway One"))).toBe(true)
  expect(rows.some((line) => line.includes("Gateway Two"))).toBe(true)
})

test("marks config-only integrations as configured", async () => {
  await using setup = await renderLocal({
    fetch: (url) => {
      if (url.pathname === "/api/integration")
        return json({
          location: { directory },
          data: [
            { id: "config", name: "Config only", configured: true, methods: [{ type: "key" }], connections: [] },
            { id: "unconfigured", name: "Not configured", methods: [{ type: "key" }], connections: [] },
          ],
        })
    },
  })
  setup.dialog.replace(() => <DialogIntegration />)
  await setup.renderOnce()
  const rows = setup.captureCharFrame().split("\n")
  expect(rows.find((line) => line.includes("Config only"))).toContain("Configured")
  expect(rows.find((line) => line.includes("Config only"))).toContain("✓")
  expect(rows.find((line) => line.includes("Not configured"))).not.toContain("Configured")
  expect(rows.find((line) => line.includes("Not configured"))).not.toContain("✓")
})
