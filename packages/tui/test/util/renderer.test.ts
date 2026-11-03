import { expect, test } from "bun:test"
import { RendererControlState } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { destroyRenderer, setTerminalTitle } from "../../src/util/renderer"

test("clears the terminal title before destroying the renderer", () => {
  const calls: string[] = []
  destroyRenderer({
    isDestroyed: false,
    controlState: RendererControlState.IDLE,
    setTerminalTitle(title) {
      calls.push(`title:${title}`)
    },
    destroy() {
      calls.push("destroy")
    },
  })
  expect(calls).toEqual(["title:", "destroy"])
})

test("skips the title from suspend until resume completes and destroys a suspended renderer", async () => {
  await using setup = await createTestRenderer({ width: 10, height: 2 })
  await setup.renderer.setupTerminal()
  const suspending = setup.renderer.suspend()
  setTerminalTitle(setup.renderer, "suspending")
  await suspending
  const resuming = setup.renderer.resume()
  setTerminalTitle(setup.renderer, "resuming")
  await resuming
  await setup.renderer.suspend()
  destroyRenderer(setup.renderer)
  expect(setup.renderer.isDestroyed).toBe(true)
  expect(() => destroyRenderer(setup.renderer)).not.toThrow()
  await setup.renderer.closed
  expect(() => destroyRenderer(setup.renderer)).not.toThrow()
})
