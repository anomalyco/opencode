import { expect, test } from "bun:test"
import { TextareaRenderable } from "@opentui/core"
import { createAppFixture } from "./fixture/app"
import { createScriptedServer } from "./fixture/widget-server"

test("a widget posted by the widget tool is answered in the timeline", async () => {
  await using server = await createScriptedServer({
    directory: process.cwd(),
    reply: (request) => {
      const last = request.messages.at(-1)
      if (last?.role === "tool") return { text: "Waiting for your answer." }
      if (JSON.stringify(last?.content).includes("responded to widget")) return { text: "Shipping now." }
      return {
        tool: {
          name: "widget",
          input: { template: "confirm", title: "Ship it", data: { title: "Ship it?", message: "Deploys main." } },
        },
      }
    },
  })
  const session = await server.api.session.create({ title: "Widgets", location: { directory: process.cwd() } })
  await using app = await createAppFixture({ url: server.url, width: 100, height: 40, args: { sessionID: session.id } })
  await app.ready

  await server.api.session.prompt({ sessionID: session.id, text: "Ask me before deploying" })
  const shown = await frame(app, (current) => current.includes("Ship it?") && current.includes("esc prompt"))

  // Clicking the prompt hands the keyboard back; clicking a button takes it again and presses it.
  const prompt = position(shown, "Build · Scripted model")
  await app.mockMouse.click(prompt.x, prompt.y)
  const released = await frame(app, (current) => current.includes("Click to answer"))
  expect(app.renderer.currentFocusedEditor).toBeInstanceOf(TextareaRenderable)
  const button = position(released, "Confirm")
  await app.mockMouse.click(button.x + 1, button.y)

  const done = await frame(app, (current) => current.includes("Submitted") && current.includes("Shipping now."))
  expect(done).toContain("confirmed: true")
  const messages = await server.api.message.list({ sessionID: session.id })
  expect(messages.data.find((message) => message.type === "widget")).toMatchObject({
    status: "submitted",
    response: { confirmed: true },
  })
  expect(messages.data.find((message) => message.type === "synthetic")).toMatchObject({
    text: 'User responded to widget "Ship it": {"confirmed":true}',
  })
})

async function frame(app: Awaited<ReturnType<typeof createAppFixture>>, matches: (frame: string) => boolean) {
  const started = Date.now()
  while (Date.now() - started < 10_000) {
    const current = app.captureCharFrame()
    if (matches(current)) return current
    await Bun.sleep(20)
  }
  throw new Error(`Timed out waiting for frame:\n${app.captureCharFrame()}`)
}

function position(frame: string, text: string) {
  const lines = frame.split("\n")
  const y = lines.findIndex((line) => line.includes(text))
  if (y === -1) throw new Error(`${text} is not on screen:\n${frame}`)
  return { x: lines[y].indexOf(text), y }
}
