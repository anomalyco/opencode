import { expect, test } from "bun:test"
import { TextareaRenderable } from "@opentui/core"
import { DialogGoal } from "../../src/component/dialog-goal"
import { renderLocal } from "../fixture/local"

test("goal TUI creates, edits, pauses, resumes and deletes", async () => {
  const values: unknown[] = []
  let goal: { objective: string; status: string } | null = null
  await using setup = await renderLocal({
    fetch: async (url, request) => {
      if (url.pathname !== "/api/session/ses_test/goal") return
      if (request.method === "GET") return Response.json({ data: { goal, continuationCount: 0, approvalWaits: 0 } })
      if (request.method === "DELETE") {
        goal = null
        values.push("deleted")
      }
      if (request.method === "PUT") {
        const input = await request.json()
        values.push(input)
        goal = { objective: input.objective, status: input.status ?? goal?.status ?? "active" }
      }
      return new Response(null, { status: 204 })
    },
  })
  async function open() {
    setup.dialog.replace(() => <DialogGoal sessionID="ses_test" />)
    await Bun.sleep(20)
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable instanceof TextareaRenderable)
    const editor = setup.renderer.currentFocusedRenderable
    if (!(editor instanceof TextareaRenderable)) throw new Error("Expected goal editor")
    return editor
  }
  const editor = await open()
  editor.setText("Finish the task")
  setup.mockInput.pressEnter({ ctrl: true })
  await setup.waitFor(() => setup.dialog.stack.length === 0)
  expect(values[0]).toEqual({ objective: "Finish the task" })
  const editing = await open()
  expect(editing.plainText).toBe("Finish the task")
  editing.setText("Finish and verify")
  setup.mockInput.pressEnter({ ctrl: true })
  await setup.waitFor(() => setup.dialog.stack.length === 0)
  expect(values[1]).toEqual({ objective: "Finish and verify" })
  await open()
  setup.mockInput.pressTab()
  setup.mockInput.pressTab()
  setup.mockInput.pressEnter()
  await setup.waitFor(() => setup.dialog.stack.length === 0)
  expect(values[2]).toEqual({ objective: "Finish and verify", status: "paused" })
  await open()
  setup.mockInput.pressTab()
  setup.mockInput.pressTab()
  setup.mockInput.pressEnter()
  await setup.waitFor(() => setup.dialog.stack.length === 0)
  expect(values[3]).toEqual({ objective: "Finish and verify", status: "active" })
  await open()
  setup.mockInput.pressTab()
  setup.mockInput.pressTab()
  setup.mockInput.pressTab()
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("もう一度押すと削除"))
  setup.mockInput.pressEnter()
  await setup.waitFor(() => setup.dialog.stack.length === 0)
  expect(values[4]).toBe("deleted")
})
