import { expect, test } from "bun:test"
import { InputRenderable } from "@opentui/core"
import { DialogModel } from "../../src/component/dialog-model"
import { model, renderLocal, session } from "../fixture/local"

test("model and variant selection commit without sending a prompt", async () => {
  const selections: unknown[] = []
  await using setup = await renderLocal({
    models: [model("first"), model("second", ["high"])],
    sessions: [session("ses_member", { providerID: "provider", id: "first" })],
    fetch: async (url, request) => {
      if (url.pathname !== "/api/session/ses_member/model") return
      selections.push(await request.json())
      return new Response(null, { status: 204 })
    },
  })
  await setup.data.session.sync("ses_member")
  setup.route.navigate({ type: "session", sessionID: "ses_member" })
  setup.dialog.replace(() => <DialogModel />)
  await setup.waitForFrame(
    (frame) => frame.includes("Select model") && setup.renderer.currentFocusedRenderable instanceof InputRenderable,
  )
  await setup.mockInput.typeText("second")
  await setup.renderOnce()
  setup.mockInput.pressEnter()
  await setup.waitFor(() => selections.length === 1)
  expect(selections[0]).toEqual({ model: { providerID: "provider", id: "second" } })
  await setup.waitForFrame(
    (frame) => frame.includes("Select variant") && setup.renderer.currentFocusedRenderable instanceof InputRenderable,
  )
  await setup.mockInput.typeText("high")
  await setup.renderOnce()
  setup.mockInput.pressEnter()
  await setup.waitFor(() => selections.length === 2)
  expect(selections).toEqual([
    { model: { providerID: "provider", id: "second" } },
    { model: { providerID: "provider", id: "second", variant: "high" } },
  ])
})
