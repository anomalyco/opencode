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

test("lists every provider of the integration just connected", async () => {
  await using setup = await renderLocal({
    config: { experimental: { "new-designs": true } },
    models: [
      { ...model("zen"), providerID: "opencode", name: "Zen Model" },
      { ...model("go"), providerID: "opencode-go", name: "Go Model" },
      { ...model("local"), providerID: "ollama", name: "Local Model" },
    ],
    fetch: (url) => {
      if (url.pathname === "/api/integration")
        return json({
          location: { directory },
          data: [
            {
              id: "opencode",
              name: "OpenCode",
              methods: [{ type: "oauth", label: "OpenCode account" }],
              connections: [{ type: "credential", id: "cred_1", label: "Personal", active: true }],
            },
          ],
        })
      if (url.pathname === "/api/provider")
        return json({
          location: { directory },
          data: [
            {
              id: "opencode",
              name: "Personal / OpenCode",
              integrationID: "opencode",
              activation: "enabled",
              package: "opencode",
            },
            {
              id: "opencode-go",
              name: "OpenCode Go",
              integrationID: "opencode",
              activation: "enabled",
              package: "opencode",
            },
            { id: "ollama", name: "Ollama", activation: "enabled", package: "openai-compatible" },
          ],
        })
    },
  })
  setup.dialog.replace(() => <DialogModel integrationID="opencode" />)
  await setup.renderOnce()
  const frame = setup.captureCharFrame()
  expect(frame).toContain("Zen Model")
  expect(frame).toContain("Go Model")
  expect(frame).not.toContain("Local Model")
})

test("connected check uses the session location, not the launch directory", async () => {
  const sub = `${directory}/packages/b`

  await using setup = await renderLocal({
    config: { experimental: { "new-designs": true } },
    fetch: (url) => {
      const loc = url.searchParams.get("location[directory]") ?? directory
      const at = (data: unknown) => json({ location: { directory: loc }, data })

      if (url.pathname === "/api/location")
        return json({ directory: loc, project: { id: "proj_test", directory, canonical: directory } })

      if (url.pathname === "/api/integration")
        return at(
          loc === sub
            ? [
                {
                  id: "x",
                  name: "X",
                  methods: [{ type: "key" }],
                  connections: [{ type: "credential", method: "key", id: "c1", label: "Work" }],
                },
              ]
            : [],
        )

      if (url.pathname === "/api/provider")
        return at(loc === sub ? [{ id: "x", name: "X", activation: "enabled", package: "openai-compatible" }] : [])

      if (url.pathname === "/api/model")
        return at(
          loc === sub
            ? [
                { ...model("sub-paid"), providerID: "x", name: "Sub Paid" },
                { ...model("sub-free"), providerID: "opencode", name: "Free Model", cost: [freeCost] },
              ]
            : [model("launch")],
        )
    },
  })

  setup.location.set({ directory: sub })
  await setup.data.location.sync({ directory: sub })

  setup.dialog.replace(() => <DialogModel />)
  await setup.renderOnce()

  const frame = setup.captureCharFrame()
  expect(frame).not.toContain("Free models")
  expect(frame).toContain("Sub Paid")
})

const freeCost = {
  input: 0,
  output: 0,
  cache: { read: 0, write: 0 },
}
