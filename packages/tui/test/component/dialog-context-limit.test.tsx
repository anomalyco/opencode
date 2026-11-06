import { expect, test } from "bun:test"
import { TextareaRenderable } from "@opentui/core"
import { DialogContextLimit } from "../../src/component/dialog-context-limit"
import { renderLocal } from "../fixture/local"

test("context dialog saves K units as total tokens and resets to model defaults", async () => {
  const values: unknown[] = []
  await using setup = await renderLocal({
    fetch: async (url, request) => {
      if (url.pathname !== "/api/session/ses_test/context-limit") return
      if (request.method === "GET") return Response.json({ data: null })
      values.push(await request.json())
      return new Response(null, { status: 204 })
    },
  })
  setup.dialog.replace(() => <DialogContextLimit sessionID="ses_test" />)
  await Bun.sleep(20)
  await setup.waitForFrame(
    (frame) =>
      frame.includes("総コンテキスト") && setup.renderer.currentFocusedRenderable instanceof TextareaRenderable,
  )
  await setup.mockInput.typeText("1000")
  setup.mockInput.pressEnter()
  await setup.waitFor(() => values.length === 1)
  expect(values[0]).toEqual({ tokens: 1_000_000 })
  await setup.waitFor(() => setup.dialog.stack.length === 0)
  setup.dialog.replace(() => <DialogContextLimit sessionID="ses_test" />)
  await Bun.sleep(20)
  await setup.waitForFrame(
    (frame) =>
      frame.includes("総コンテキスト") && setup.renderer.currentFocusedRenderable instanceof TextareaRenderable,
  )
  setup.mockInput.pressEnter()
  await setup.waitFor(() => values.length === 2)
  expect(values[1]).toEqual({ tokens: null })
})
