import { expect, spyOn, test } from "bun:test"
import { CliRenderEvents, InputRenderable, ScrollBoxRenderable, type Renderable } from "@opentui/core"
import { once } from "node:events"
import { DialogModel } from "../../src/component/dialog-model"
import { model, renderLocal } from "../fixture/local"
import { directory, json } from "../fixture/tui-client"

test("lists models of a provider declared only in config", async () => {
  await using setup = await renderLocal({
    config: { experimental: { "new-designs": true } },
    models: [
      {
        ...model("free"),
        providerID: "opencode",
        name: "Free Model",
        cost: [freeCost],
      },
      { ...model("local"), providerID: "ollama", name: "Local Model" },
    ],
    fetch: (url) => {
      if (url.pathname === "/api/integration")
        return json({
          location: { directory },
          data: [
            {
              id: "ollama",
              name: "Ollama",
              methods: [{ type: "key" }],
              connections: [],
            },
          ],
        })
      if (url.pathname === "/api/provider")
        return json({
          location: { directory },
          data: [
            {
              id: "opencode",
              name: "OpenCode",
              activation: "auto",
              package: "opencode",
            },
            {
              id: "ollama",
              name: "Ollama",
              activation: "enabled",
              package: "openai-compatible",
            },
          ],
        })
    },
  })
  setup.dialog.replace(() => <DialogModel />)
  await setup.renderOnce()
  const frame = setup.captureCharFrame()
  expect(frame).not.toContain("Free models")
  expect(frame).toContain("Local Model")
})

test("opens the free models list without a connection or a configured provider", async () => {
  await using setup = await renderLocal({
    config: { experimental: { "new-designs": true } },
    models: [
      {
        ...model("free"),
        providerID: "opencode",
        name: "Free Model",
        cost: [freeCost],
      },
    ],
    fetch: (url) => {
      if (url.pathname === "/api/provider")
        return json({
          location: { directory },
          data: [
            {
              id: "opencode",
              name: "OpenCode",
              activation: "auto",
              package: "opencode",
            },
          ],
        })
    },
  })
  setup.dialog.replace(() => <DialogModel />)
  await setup.renderOnce()
  expect(setup.captureCharFrame()).toContain("Free models")
})

test("search filters models without rechecking speeds or remounting a result that still matches", async () => {
  await using setup = await renderLocal({
    config: { experimental: { "new-designs": true } },
    models: [model("Alpha"), model("Beta")],
    fetch: (url) => {
      if (url.pathname === "/api/provider")
        return json({
          location: { directory },
          data: [{ id: "provider", name: "Provider", activation: "enabled", package: "openai-compatible" }],
        })
    },
  })
  const isSpeed = spyOn(setup.local.model, "isSpeed")

  setup.dialog.replace(() => <DialogModel />)
  await setup.renderOnce()
  expect(setup.captureCharFrame()).toContain("Alpha")
  expect(isSpeed).toHaveBeenCalled()

  if (!(setup.renderer.currentFocusedRenderable instanceof InputRenderable))
    await once(setup.renderer, CliRenderEvents.FOCUSED_RENDERABLE)

  const findScroll = (node: Renderable): ScrollBoxRenderable | undefined =>
    node instanceof ScrollBoxRenderable ? node : node.getChildren().map(findScroll).find(Boolean)
  const scroll = findScroll(setup.renderer.root)
  if (!scroll) throw new Error("Missing model picker scrollbox")
  const beta = scroll.content.getChildren().at(-1)
  expect(beta).toBeDefined()

  isSpeed.mockClear()
  await setup.mockInput.typeText("B")
  await setup.renderOnce()
  expect(scroll.content.getChildren()[0] === beta).toBe(true)

  await setup.mockInput.typeText("eta")
  await setup.renderOnce()

  const filtered = setup.captureCharFrame()
  expect(filtered).toContain("Beta")
  expect(filtered).not.toContain("Alpha")
  expect(scroll.content.getChildren()[0] === beta).toBe(true)
  expect(isSpeed).not.toHaveBeenCalled()
})

const freeCost = {
  input: 0,
  output: 0,
  cache: { read: 0, write: 0 },
}
