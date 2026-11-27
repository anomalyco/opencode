import { expect, test } from "bun:test"
import { TextareaRenderable } from "@opentui/core"
import { createAppFixture } from "./fixture/app"
import { createScriptedServer } from "./fixture/widget-server"
import { Widget } from "@opencode/schema/widget"

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
          input: { widgetTemplate: "confirm", title: "Ship it", data: { title: "Ship it?", message: "Deploys main." } },
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
  const states = await server.api
    .rpc(Widget.Definition)
    .states({ sessionID: session.id }, { location: { directory: process.cwd() } })
  expect(states).toMatchObject([
    { widgetTemplate: { name: "confirm" }, status: "submitted", response: { confirmed: true } },
  ])
  const messages = await server.api.message.list({ sessionID: session.id })
  const tool = messages.data.flatMap((message) => (message.type === "assistant" ? message.content : []))
  expect(tool.find((part) => part.type === "tool" && part.name === "widget")).toMatchObject({
    id: states[0]?.callID,
  })
  expect(messages.data.find((message) => message.type === "synthetic")).toMatchObject({
    text: 'User responded to widget "Ship it": {"confirmed":true}',
    metadata: { widget: { callID: states[0]?.callID, kind: "response" } },
  })
  expect(done).toContain('◈ Responded to "Ship it"')
}, 20000)

test("a widget dismissed over the RPC is dismissed and tells the agent", async () => {
  await using server = await createScriptedServer({
    directory: process.cwd(),
    reply: (request) => {
      const last = request.messages.at(-1)
      if (last?.role === "tool") return { text: "Waiting." }
      if (JSON.stringify(last?.content).includes("dismissed widget")) return { text: "Okay, not deploying." }
      return {
        tool: {
          name: "widget",
          input: { widgetTemplate: "confirm", title: "Ship it", data: { title: "Ship it?", message: "x" } },
        },
      }
    },
  })
  const session = await server.api.session.create({ title: "Dismiss", location: { directory: process.cwd() } })
  await server.api.session.prompt({ sessionID: session.id, text: "Ask me" })
  const rpc = server.api.rpc(Widget.Definition)
  const location = { location: { directory: process.cwd() } }
  const deadline = Date.now() + 10_000
  let states: readonly Widget.State[] = []
  while (states.length === 0 && Date.now() < deadline) {
    states = await rpc.states({ sessionID: session.id }, location).catch(() => [])
    if (states.length === 0) await Bun.sleep(25)
  }
  const widget = states[0]!
  const dismissed = await rpc.respond(
    { sessionID: session.id, messageID: widget.messageID, callID: widget.callID, response: { dismiss: true } },
    location,
  )
  expect(dismissed).toMatchObject({ status: "dismissed" })
})

const pinger = {
  name: "pinger",
  description: "A button that pings the agent without closing",
  data: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
  example: { title: "Ping me" },
  source: `function view(state, data) {
  return ui.column({ gap: 1 }, [
    ui.text(data.title),
    ui.row({ gap: 1 }, [
      ui.button("Ping", { onPress: () => send({ pinged: true }) }),
      ui.button("Done", { onPress: () => submit({ done: true }) }),
    ]),
  ])
}`,
}

test("a widget's send reaches the agent as a synthetic message and the widget stays open", async () => {
  await using server = await createScriptedServer({
    directory: process.cwd(),
    reply: (request) => {
      const last = request.messages.at(-1)
      const content = JSON.stringify(last?.content)
      if (content.includes('sent: {\\"pinged\\":true}')) return { text: "Got the ping." }
      if (last?.role === "tool" && content.includes("Saved widget template"))
        return {
          tool: { name: "widget", input: { widgetTemplate: "pinger", title: "Pinger", data: { title: "Ping me" } } },
        }
      if (last?.role === "tool") return { text: "Waiting for pings." }
      return { tool: { name: "widget_template", input: { action: "save", ...pinger } } }
    },
  })
  const session = await server.api.session.create({ title: "Pings", location: { directory: process.cwd() } })
  await using app = await createAppFixture({ url: server.url, width: 100, height: 40, args: { sessionID: session.id } })
  await app.ready

  await server.api.session.prompt({ sessionID: session.id, text: "Make me a pinger" })
  const shown = await frame(app, (current) => current.includes("Ping me") && current.includes("Waiting for pings."))
  const button = position(shown, "Ping   Done")
  await app.mockMouse.click(button.x + 1, button.y)

  const pinged = await frame(app, (current) => current.includes("Got the ping."))
  expect(pinged).toContain('◈ Pinger: {"pinged":true}')
  expect(pinged).not.toContain("Submitted")
  const states = await server.api
    .rpc(Widget.Definition)
    .states({ sessionID: session.id }, { location: { directory: process.cwd() } })
  expect(states).toMatchObject([{ widgetTemplate: { name: "pinger" }, status: "open" }])
  const messages = await server.api.message.list({ sessionID: session.id })
  expect(messages.data.find((message) => message.type === "synthetic")).toMatchObject({
    text: 'Widget "Pinger" sent: {"pinged":true}',
    metadata: { widget: { kind: "message" } },
  })
}, 20000)

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
