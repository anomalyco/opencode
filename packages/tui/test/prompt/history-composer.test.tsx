import { TextareaRenderable } from "@opentui/core"
import { beforeEach, expect, test } from "bun:test"
import "../../src/app"
import { takeDraft } from "../../src/component/prompt/draft-stash"
import { createAppFixture } from "../fixture/app"
import { directory, json } from "../fixture/tui-client"

beforeEach(() => takeDraft(undefined))

async function renderSession() {
  const sessionID = `ses_history_${crypto.randomUUID()}`
  const location = { directory, project: { id: "project", directory, canonical: directory } }
  const prompts: string[] = []
  const shells: string[] = []
  const setup = await createAppFixture({
    args: { sessionID },
    config: {
      animations: false,
      tabs: { mode: "off" },
      keybinds: {
        "session.child.first": "none",
        "prompt.stash": "f6",
        "prompt.stash.pop": "f7",
        "prompt.stash.list": "f8",
      },
    },
    fetch: async (url, request) => {
      if (url.pathname === `/api/session/${sessionID}`)
        return json({
          data: {
            id: sessionID,
            projectID: "project",
            title: "History fixture",
            agent: "build",
            model: { providerID: "demo", id: "model" },
            location: { directory },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: 0, updated: 0 },
          },
        })
      if (url.pathname === `/api/session/${sessionID}/message`) return json({ data: [], cursor: {} })
      if (url.pathname === `/api/session/${sessionID}/inbox` || url.pathname === `/api/session/${sessionID}/permission`)
        return json({ data: [] })
      if (url.pathname === "/api/agent")
        return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "demo", name: "Demo" }] })
      if (url.pathname === "/api/model")
        return json({ location, data: [{ id: "model", providerID: "demo", name: "Demo Model", variants: [] }] })
      if (url.pathname === `/api/session/${sessionID}/shell`) {
        const body = await request.json()
        shells.push(body.command)
        return new Response(null, { status: 204 })
      }
      if (url.pathname === `/api/session/${sessionID}/prompt`) {
        const body = await request.json()
        prompts.push(body.text)
        return json({
          data: {
            id: body.id,
            sessionID,
            type: "user",
            time: { created: prompts.length },
            payload: { text: body.text },
          },
        })
      }
      return undefined
    },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Demo Model"))
  await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof TextareaRenderable)
  return {
    setup,
    prompts,
    shells,
    text: () => setup.renderer.currentFocusedEditor?.plainText,
    async [Symbol.asyncDispose]() {
      await setup[Symbol.asyncDispose]()
    },
  }
}

test("clearing a recalled entry drops the live draft so down stays empty", async () => {
  await using fixture = await renderSession()
  const { setup, shells, text } = fixture

  await setup.mockInput.typeText("!pwd")
  setup.mockInput.pressEnter()
  await setup.waitFor(() => shells.length === 1)
  expect(shells).toEqual(["pwd"])

  await setup.mockInput.typeText("!echo pen")
  expect(text()).toBe("echo pen")

  setup.mockInput.pressArrow("up")
  setup.mockInput.pressArrow("up")
  expect(text()).toBe("pwd")

  setup.mockInput.pressKey("c", { ctrl: true })
  expect(text()).toBe("")

  setup.mockInput.pressArrow("down")
  expect(text()).toBe("")
})

test("stashing a recalled entry drops the live draft so down stays empty", async () => {
  await using fixture = await renderSession()
  const { setup, shells, text } = fixture

  await setup.mockInput.typeText("!pwd")
  setup.mockInput.pressEnter()
  await setup.waitFor(() => shells.length === 1)

  await setup.mockInput.typeText("!echo pen")
  setup.mockInput.pressArrow("up")
  setup.mockInput.pressArrow("up")
  expect(text()).toBe("pwd")
  await setup.renderOnce()

  setup.mockInput.pressKey("F6")
  await setup.renderOnce()
  expect(text()).toBe("")

  setup.mockInput.pressArrow("down")
  await setup.renderOnce()
  expect(text()).toBe("")
})

test("popping or selecting a stashed entry resets history browsing", async () => {
  await using fixture = await renderSession()
  const { setup, shells, text } = fixture

  await setup.mockInput.typeText("!pwd")
  setup.mockInput.pressEnter()
  await setup.waitFor(() => shells.length === 1)

  await setup.mockInput.typeText("stashed item")
  await setup.renderOnce()
  setup.mockInput.pressKey("F6")
  await setup.renderOnce()
  expect(text()).toBe("")

  await setup.mockInput.typeText("draft two")
  await setup.renderOnce()
  setup.mockInput.pressArrow("up")
  setup.mockInput.pressArrow("up")
  expect(text()).toBe("pwd")

  setup.mockInput.pressKey("F7")
  await setup.renderOnce()
  expect(text()).toBe("stashed item")
  setup.mockInput.pressArrow("down")
  expect(text()).toBe("stashed item")

  setup.mockInput.pressKey("F6")
  await setup.renderOnce()
  expect(text()).toBe("")
  await setup.mockInput.typeText("draft three")
  await setup.renderOnce()
  setup.mockInput.pressArrow("up")
  setup.mockInput.pressArrow("up")
  expect(text()).toBe("pwd")

  setup.mockInput.pressKey("F8")
  await setup.waitForFrame((frame) => frame.includes("Stash"))
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => !frame.includes("Stash"))
  await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof TextareaRenderable)
  expect(text()).toBe("stashed item")
  setup.mockInput.pressArrow("down")
  expect(text()).toBe("stashed item")
})

test("typing fresh text after clearing a recalled entry still navigates history with up", async () => {
  await using fixture = await renderSession()
  const { setup, prompts, text } = fixture

  await setup.mockInput.typeText("first")
  setup.mockInput.pressEnter()
  await setup.waitFor(() => prompts.length === 1)

  await setup.mockInput.typeText("second")
  setup.mockInput.pressEnter()
  await setup.waitFor(() => prompts.length === 2)

  setup.mockInput.pressArrow("up")
  expect(text()).toBe("second")

  setup.mockInput.pressKey("c", { ctrl: true })
  expect(text()).toBe("")

  await setup.mockInput.typeText("fresh")
  expect(text()).toBe("fresh")

  setup.mockInput.pressArrow("up")
  setup.mockInput.pressArrow("up")
  expect(text()).toBe("second")
  setup.mockInput.pressArrow("up")
  expect(text()).toBe("first")

  setup.mockInput.pressKey("e", { ctrl: true })
  setup.mockInput.pressArrow("down")
  expect(text()).toBe("second")
  setup.mockInput.pressArrow("down")
  expect(text()).toBe("fresh")
})

test("editing and discarding a recalled entry with a paste does not mutate the saved entry", async () => {
  await using fixture = await renderSession()
  const { setup, prompts, text } = fixture

  await setup.mockInput.pasteBracketedText("alpha\nbeta\ngamma")
  await setup.waitFor(() => text() === "[Pasted ~3 lines] ")
  setup.mockInput.pressEnter()
  await setup.waitFor(() => prompts.length === 1)
  expect(prompts[0]).toBe("alpha\nbeta\ngamma ")

  setup.mockInput.pressArrow("up")
  expect(text()).toBe("[Pasted ~3 lines] ")

  await setup.mockInput.typeText("prefix ")
  expect(text()).toBe("prefix [Pasted ~3 lines] ")

  setup.mockInput.pressKey("e", { ctrl: true })
  setup.mockInput.pressBackspace()
  setup.mockInput.pressBackspace()
  await setup.renderOnce()
  expect(text()).toBe("prefix ")

  setup.mockInput.pressKey("c", { ctrl: true })
  expect(text()).toBe("")

  setup.mockInput.pressArrow("up")
  expect(text()).toBe("[Pasted ~3 lines] ")
  setup.mockInput.pressEnter()
  await setup.waitFor(() => prompts.length === 2)
  expect(prompts[1]).toBe("alpha\nbeta\ngamma ")
})
