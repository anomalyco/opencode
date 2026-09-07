import { expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { InputRenderable, TextareaRenderable } from "@opentui/core"
import { Effect, FileSystem } from "effect"
import { Global } from "@opencode-ai/util/global"
import { takeDraft } from "../src/component/prompt/draft-stash"
import { createEventStream, createFetch, directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"

test.each([
  "untouched",
  "away",
  "returned",
  "typing",
  "away-draft",
  "cleared",
  "multiple",
  "shell-draft",
  "history-paste",
  "setup-mode",
])("failed prompt recovery preserves input after %s", async (scenario) => {
  await using state = await tmpdir()
  const setup = await createTestRenderer({ width: 100, height: 30, useThread: false, kittyKeyboard: true })
  setup.renderer.start()
  const ready = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const requested = Promise.withResolvers<void>()
  let sessionID = `ses_recovery_${scenario}`
  const location = { directory, project: { id: "project", directory, canonical: directory } }
  const events = createEventStream()
  const calls = createFetch(async (url, request) => {
    if (scenario === "setup-mode" && url.pathname === "/api/session" && request.method === "POST") {
      sessionID = (await request.json()).id
    }
    if (
      url.pathname === `/api/session/${sessionID}` ||
      (scenario === "setup-mode" && url.pathname === "/api/session" && request.method === "POST")
    )
      return json({
        data: {
          id: sessionID,
          projectID: "project",
          title: "Prompt recovery",
          agent: "build",
          model: { providerID: "demo", id: "model" },
          location: { directory },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 0, updated: 0 },
        },
      })
    if (url.pathname === `/api/session/${sessionID}/message`) return json({ data: [], cursor: {} })
    if (/^\/api\/session\/[^/]+\/(inbox|permission)$/.test(url.pathname)) return json({ data: [] })
    if (url.pathname === "/api/agent")
      return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
    if (url.pathname === "/api/provider") return json({ location, data: [{ id: "demo", name: "Demo" }] })
    if (url.pathname === "/api/model")
      return json({ location, data: [{ id: "model", providerID: "demo", name: "Demo Model", variants: [] }] })
    if (url.pathname === `/api/session/${sessionID}/model`) {
      requested.resolve()
      await release.promise
      return json({ message: "Fixture admission rejected" }, { status: 400 })
    }
    return undefined
  }, events)
  const server = Bun.serve({ port: 0, fetch: (request) => calls.fetch(request) })
  const { run } = await import("../src/app")
  const task = Effect.runPromise(
    run({
      app: { name: "test", version: "test", channel: "test" },
      server: { endpoint: { url: server.url.toString() } },
      config: {
        get: async () => ({
          animations: false,
          keybinds: {
            "session.new": "f6",
            "session.tab.select.1": "f7",
            "prompt.stash.pop": "f8",
            "prompt.stash": "f9",
          },
        }),
        update: async () => ({}),
      },
      packages: { resolve: async () => undefined },
      terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: ready.resolve }),
      args: scenario === "setup-mode" ? {} : { sessionID },
      log: () => {},
    }).pipe(Effect.provide(Global.layerWith({ state: state.path })), Effect.provide(FileSystem.layerNoop({}))),
  )
  const input = () => {
    const focused = setup.renderer.currentFocusedRenderable
    if (!(focused instanceof TextareaRenderable)) throw new Error("composer is not focused")
    return focused
  }
  const navigate = async (key: "F6" | "F7") => {
    const previous = input()
    setup.mockInput.pressKey(key)
    await setup.waitForFrame(
      () =>
        setup.renderer.currentFocusedRenderable instanceof TextareaRenderable &&
        setup.renderer.currentFocusedRenderable !== previous,
    )
  }
  try {
    await ready.promise
    await setup.waitForFrame((frame) => frame.includes("Demo Model"))
    await setup.mockInput.typeText("Recover this failed prompt")
    if (scenario === "history-paste") {
      await setup.mockInput.pasteBracketedText("first pasted line\nsecond pasted line\nthird pasted line")
      await setup.waitForFrame(() => input().plainText.includes("[Pasted"))
      expect(input().extmarks.getAll()).toHaveLength(1)
    }
    setup.mockInput.pressEnter()
    await requested.promise
    expect(input().plainText).toBe("")
    expect(setup.captureCharFrame()).toContain("Recover this failed prompt")

    if (scenario === "setup-mode") {
      await setup.mockInput.typeText("!")
      await setup.waitForFrame((frame) => frame.includes("Shell"))
      await setup.mockInput.typeText("Keep my newer draft")
      setup.mockInput.pressKey("F9")
      await setup.waitForFrame(() => input().plainText === "")
      setup.mockInput.pressKey("F8")
      await setup.waitForFrame(() => input().plainText === "Keep my newer draft")
      setup.mockInput.pressKey("ESCAPE")
      await setup.waitForFrame((frame) => !frame.includes("Shell"))
      release.resolve()
      await setup.waitForFrame((frame) => frame.includes("Fixture admission rejected"))
      await setup.waitForFrame(() => input().plainText === "Keep my newer draft")
      await setup.renderOnce()
      expect(setup.captureCharFrame()).not.toContain("Shell")
      return
    }

    if (scenario === "shell-draft") {
      await setup.mockInput.typeText("!")
      await setup.waitForFrame((frame) => frame.includes("Shell"))
    }
    if (scenario === "typing" || scenario === "away-draft" || scenario === "cleared" || scenario === "shell-draft")
      await setup.mockInput.typeText("Keep my newer draft")
    if (scenario === "history-paste") {
      setup.mockInput.pressArrow("up")
      await setup.waitForFrame(() => input().plainText.includes("[Pasted"))
    }
    if (scenario === "multiple") {
      await setup.mockInput.typeText("Another failed prompt")
      setup.mockInput.pressEnter()
      await setup.waitForFrame((frame) => frame.includes("Another failed prompt") && input().plainText === "")
    }
    if (scenario === "away" || scenario === "returned" || scenario === "away-draft") await navigate("F6")
    if (scenario === "returned") await navigate("F7")
    release.resolve()
    await setup.waitForFrame((frame) => frame.includes("Fixture admission rejected"))
    if (scenario === "away" || scenario === "away-draft") {
      expect(input().plainText).toBe("")
      await navigate("F7")
    }

    if (scenario === "history-paste") {
      await setup.waitForFrame((frame) => frame.includes("Failed to send:"))
      input().gotoBufferEnd()
      setup.mockInput.pressArrow("down")
      await setup.waitForFrame((frame) => input().plainText.includes("[Pasted") && !frame.includes("Failed to send:"))
      expect(input().extmarks.getAll()).toHaveLength(1)
      return
    }

    if (scenario === "multiple") {
      await setup.waitForFrame((frame) => frame.includes("Failed to send: Another failed prompt"))
      expect(input().plainText).toBe("Recover this failed prompt")
      input().clear()
      await setup.waitForFrame(
        (frame) => input().plainText === "Another failed prompt" && !frame.includes("Failed to send:"),
      )
      return
    }

    if (scenario === "cleared") {
      await setup.waitForFrame((frame) => frame.includes("Failed to send:"))
      expect(input().plainText).toBe("Keep my newer draft")
      input().clear()
    }

    if (scenario === "typing" || scenario === "away-draft" || scenario === "shell-draft") {
      const failed = await setup.waitForFrame((frame) => frame.includes("Failed to send:") && frame.includes("restore"))
      expect(failed).toContain("Recover this failed prompt")
      expect(input().plainText).toBe("Keep my newer draft")
      if (scenario === "away-draft") {
        setup.mockInput.pressKey("p", { ctrl: true })
        await setup.waitForFrame(() => setup.renderer.currentFocusedRenderable instanceof InputRenderable)
        await setup.mockInput.typeText("Restore failed prompt")
        await setup.renderOnce()
        setup.mockInput.pressEnter()
      } else {
        const lines = failed.split("\n")
        const row = lines.findIndex((line) => line.includes("restore"))
        await setup.mockMouse.click(lines[row].indexOf("restore"), row)
      }
      await setup.waitForFrame(
        (frame) => input().plainText === "Recover this failed prompt" && !frame.includes("Failed to send:"),
      )

      // Restoring explicitly stashes the newer draft rather than discarding it.
      input().clear()
      setup.mockInput.pressKey("F8")
      await setup.waitForFrame(() => input().plainText === "Keep my newer draft")
      if (scenario === "shell-draft") await setup.waitForFrame((frame) => frame.includes("Shell"))
    } else {
      await setup.waitForFrame(() => input().plainText === "Recover this failed prompt")
    }
  } finally {
    release.resolve()
    setup.renderer.destroy()
    await task
    await server.stop()
    takeDraft(sessionID)
    if (scenario === "setup-mode") takeDraft(undefined)
  }
})
