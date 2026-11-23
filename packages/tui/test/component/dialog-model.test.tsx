import { expect, test } from "bun:test"
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

const freeCost = {
  input: 0,
  output: 0,
  cache: { read: 0, write: 0 },
}
