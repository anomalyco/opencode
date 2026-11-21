/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { InputRenderable, TextareaRenderable } from "@opentui/core"
import { createAppFixture } from "./fixture/app"
import { tmpdir } from "./fixture/fixture"
import { directory, json } from "./fixture/tui-client"

const location = { directory, project: { id: "project", directory, canonical: directory } }

const makeSession = (id: string, title: string) => ({
  id,
  title,
  projectID: "project",
  location: { directory },
  agent: "build",
  model: { providerID: "provider", id: "model" },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: 2 },
})

test("/sessions opens picker on Enter and /sessions <id> (and aliases) navigate directly", async () => {
  await using state = await tmpdir()
  const first = makeSession("ses_first_target", "First target session")
  const second = makeSession("ses_second_target", "Second target session")
  const third = makeSession("ses_0123456789abcdefghijABCDEF", "Third target session")
  const sessions = new Map([first, second, third].map((session) => [session.id, session]))

  await using setup = await createAppFixture({
    width: 110,
    height: 30,
    state: state.path,
    config: { animations: false, tabs: { mode: "on", layout: "vertical" }, session: { sidebar: "hide" } },
    fetch: (url) => {
      if (url.pathname === "/api/location") return json(location)
      if (url.pathname === "/api/agent")
        return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
      if (url.pathname === "/api/model")
        return json({ location, data: [{ id: "model", providerID: "provider", name: "Model", variants: [] }] })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "provider", name: "Provider" }] })
      if (url.pathname === "/api/session") return json({ data: [...sessions.values()], cursor: {} })
      const match = url.pathname.match(/^\/api\/session\/([^/]+)$/)
      if (match) {
        const found = sessions.get(match[1]!)
        if (found) return json({ data: found })
        return json(
          { _tag: "SessionNotFoundError", sessionID: match[1]!, message: `Session not found: ${match[1]!}` },
          { status: 404 },
        )
      }
      if (/^\/api\/session\/[^/]+\/(message|inbox|permission)$/.test(url.pathname))
        return json({ data: [], cursor: {} })
      return undefined
    },
  })

  await setup.ready
  await setup.waitForFrame(
    (frame) =>
      frame.includes("Build · Model Provider") && setup.renderer.currentFocusedRenderable instanceof TextareaRenderable,
  )

  // /sessions + Enter in autocomplete opens DialogSessionList immediately (no extra Enter required).
  await setup.mockInput.typeText("/sessions")
  await setup.waitForFrame((frame) => frame.includes("Switch session"))
  setup.mockInput.pressEnter()
  await setup.waitForFrame(
    (frame) =>
      frame.includes("Sessions") &&
      frame.includes("First target session") &&
      setup.renderer.currentFocusedRenderable instanceof InputRenderable,
  )
  setup.mockInput.pressEscape()
  await setup.waitForFrame(
    (frame) =>
      !frame.includes("First target session") && setup.renderer.currentFocusedRenderable instanceof TextareaRenderable,
  )

  // /sessions + Escape + Enter also opens DialogSessionList instead of submitting a prompt.
  await setup.mockInput.typeText("/sessions")
  await setup.waitForFrame((frame) => frame.includes("Switch session"))
  setup.mockInput.pressEscape()
  setup.mockInput.pressEnter()
  await setup.waitForFrame(
    (frame) =>
      frame.includes("Sessions") &&
      frame.includes("First target session") &&
      setup.renderer.currentFocusedRenderable instanceof InputRenderable,
  )
  setup.mockInput.pressEscape()
  await setup.waitForFrame(
    (frame) =>
      !frame.includes("First target session") && setup.renderer.currentFocusedRenderable instanceof TextareaRenderable,
  )

  // /sessions <id> navigates directly to that session.
  await setup.mockInput.typeText(`/sessions ${first.id}`)
  setup.mockInput.pressEnter()
  await setup.waitForFrame(
    (frame) => frame.includes(first.title) && setup.renderer.currentFocusedRenderable instanceof TextareaRenderable,
  )
  expect(setup.captureCharFrame()).toContain(first.title)

  // /resume <id> alias navigates directly to another session.
  await setup.mockInput.typeText(`/resume ${second.id}`)
  setup.mockInput.pressEnter()
  await setup.waitForFrame(
    (frame) => frame.includes(second.title) && setup.renderer.currentFocusedRenderable instanceof TextareaRenderable,
  )
  expect(setup.captureCharFrame()).toContain(second.title)

  // /continue <id> alias navigates directly with a full generated ID.
  await setup.mockInput.typeText(`/continue ${third.id}`)
  setup.mockInput.pressEnter()
  await setup.waitForFrame(
    (frame) => frame.includes(third.title) && setup.renderer.currentFocusedRenderable instanceof TextareaRenderable,
  )
  expect(setup.captureCharFrame()).toContain(third.title)
})

test("/sessions <unknown-id> shows a Session not found toast", async () => {
  await using state = await tmpdir()
  const missingID = "ses_missing_target"
  const requested: string[] = []

  await using setup = await createAppFixture({
    width: 110,
    height: 30,
    state: state.path,
    config: { animations: false, tabs: { mode: "off" }, session: { sidebar: "hide" } },
    fetch: (url) => {
      if (url.pathname === "/api/location") return json(location)
      if (url.pathname === "/api/agent")
        return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
      if (url.pathname === "/api/model")
        return json({ location, data: [{ id: "model", providerID: "provider", name: "Model", variants: [] }] })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "provider", name: "Provider" }] })
      if (url.pathname === "/api/session") return json({ data: [], cursor: {} })
      if (url.pathname === `/api/session/${missingID}`) {
        requested.push(missingID)
        return json(
          { _tag: "SessionNotFoundError", sessionID: missingID, message: `Session not found: ${missingID}` },
          { status: 404 },
        )
      }
      if (/^\/api\/session\/[^/]+\/(message|inbox|permission)$/.test(url.pathname))
        return json({ data: [], cursor: {} })
      return undefined
    },
  })

  await setup.ready
  await setup.waitForFrame(
    (frame) =>
      frame.includes("Build · Model Provider") && setup.renderer.currentFocusedRenderable instanceof TextareaRenderable,
  )

  await setup.mockInput.typeText(`/sessions ${missingID}`)
  setup.mockInput.pressEnter()
  const frame = await setup.waitForFrame(
    (frame) => requested.includes(missingID) && frame.includes(`Session not found: ${missingID}`),
  )
  expect(frame).toContain(`Session not found: ${missingID}`)
  expect(requested).toEqual([missingID])
})
