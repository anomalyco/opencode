import { expect, test } from "bun:test"
import type { ModelInfo } from "@opencode/client"
import { CliRenderEvents, InputRenderable } from "@opentui/core"
import { once } from "node:events"
import { DialogSpeed } from "../../src/component/dialog-speed"
import { agent, model, renderLocal, session } from "../fixture/local"

const cost = (input: number) => [{ input, output: input * 5, cache: { read: 0, write: 0 } }]

// A model and its slower and faster speeds, each a model of its own as the server lists them.
function speedy(id: string): ModelInfo[] {
  const speed = (name: string, faster: boolean, input: number) => ({
    ...model(`${id}-${name}`),
    name: `${id} ${name}`,
    cost: cost(input),
    experimental: { speed: { base: id, id: name, faster } },
  })
  return [{ ...model(id), cost: cost(2) }, speed("flex", false, 1), speed("fast", true, 5)]
}

const ref = (modelID: string) => ({ providerID: "provider", modelID })

async function pick(setup: Awaited<ReturnType<typeof renderLocal>>, title: string) {
  setup.dialog.replace(() => <DialogSpeed />)
  const frame = await setup.waitForFrame((frame) => frame.includes("Select speed") && frame.includes("Standard"))
  // The dialog paints before its deferred filter focus is ready for typing.
  if (!(setup.renderer.currentFocusedRenderable instanceof InputRenderable))
    await once(setup.renderer, CliRenderEvents.FOCUSED_RENDERABLE)
  await setup.mockInput.typeText(title)
  await setup.renderOnce()
  setup.mockInput.pressEnter()
  await setup.waitFor(() => setup.dialog.stack.length === 0)
  return frame
}

test("speed picker lists the speeds slowest first with their prices and switches to the one selected", async () => {
  await using setup = await renderLocal({ models: speedy("first") })
  expect(setup.local.model.current()).toEqual(ref("first"))
  expect(setup.local.model.speed.current()).toBeUndefined()

  const frame = await pick(setup, "Fast")
  expect(frame.indexOf("Flex")).toBeLessThan(frame.indexOf("Standard"))
  expect(frame.indexOf("Standard")).toBeLessThan(frame.indexOf("Fast"))
  expect(frame).toContain("0.5× price")
  expect(frame).toContain("2.5× price")
  // The speed is a model of its own; the name shown stays the model's.
  expect(setup.local.model.current()).toEqual(ref("first-fast"))
  expect(setup.local.model.speed.current()).toBe("fast")
  expect(setup.local.model.parsed().model).toBe("first")
  expect(setup.local.model.standard()).toEqual(ref("first"))

  await pick(setup, "Standard")
  expect(setup.local.model.current()).toEqual(ref("first"))
  expect(setup.local.model.speed.current()).toBeUndefined()
})

test("a model runs at the speed last used with it, and a speed it no longer has is its standard speed", async () => {
  await using setup = await renderLocal({
    models: [...speedy("first"), ...speedy("second"), model("third")],
    preferences: { speed: { "provider/first": "ultrafast", "provider/second": "flex", "provider/third": "fast" } },
  })
  expect(setup.local.model.current()).toEqual(ref("first"))
  setup.local.model.set(ref("second"))
  expect(setup.local.model.current()).toEqual(ref("second-flex"))
  expect(setup.local.model.speed.current()).toBe("flex")
  setup.local.model.set(ref("third"))
  expect(setup.local.model.speed.list()).toEqual([])
  expect(setup.local.model.speed.current()).toBeUndefined()
})

test("a variant saved for a speed before speeds shared their model's variant still applies to it", async () => {
  await using setup = await renderLocal({
    models: speedy("first").map((item) => ({ ...item, variants: [{ id: "low" }, { id: "high" }] })),
    preferences: { variant: { "provider/first-fast": "high" } },
  })
  setup.local.model.speed.set("fast")
  expect(setup.local.model.selection()).toEqual({ ...ref("first-fast"), variant: "high" })
})

test("favorites, recents and sessions naming a speed stand for the model", async () => {
  await using setup = await renderLocal({
    models: speedy("first"),
    agents: [agent("build")],
    sessions: [session("ses_fast", { providerID: "provider", id: "first-fast" })],
    preferences: {
      recent: [ref("first-flex"), ref("first")],
      favorite: [ref("first-fast"), ref("first")],
    },
  })
  expect(setup.local.model.recent()).toEqual([ref("first")])
  expect(setup.local.model.favorite()).toEqual([ref("first")])
  expect(setup.local.model.isSpeed(ref("first-fast"))).toBe(true)
  expect(setup.local.model.isSpeed(ref("first"))).toBe(false)

  // Removing the favorite removes the entry saved at another speed too.
  setup.local.model.toggleFavorite(ref("first"))
  expect(setup.local.model.favorite()).toEqual([])

  await setup.data.session.sync("ses_fast")
  setup.route.navigate({ type: "session", sessionID: "ses_fast" })
  expect(setup.local.model.current()).toEqual(ref("first-fast"))
  expect(setup.local.model.speed.current()).toBe("fast")
  expect(setup.local.model.standard()).toEqual(ref("first"))
})

test("a speed whose model is not available is a model of its own", async () => {
  await using setup = await renderLocal({ models: speedy("first").slice(1) })
  expect(setup.local.model.current()).toEqual(ref("first-flex"))
  expect(setup.local.model.speed.current()).toBeUndefined()
  expect(setup.local.model.speed.list()).toEqual([])
  expect(setup.local.model.isSpeed(ref("first-flex"))).toBe(false)
  expect(setup.local.model.parsed().model).toBe("first flex")
})
