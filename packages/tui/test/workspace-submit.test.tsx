import { expect, spyOn, test } from "bun:test"
import { InputRenderable, TextareaRenderable } from "@opentui/core"
import path from "node:path"
import { createAppFixture } from "./fixture/app"
import { json } from "./fixture/tui-client"

test.each(["agent", "model", "config"])(
  "Enter waits for the destination %s catalog after switching worktrees",
  async (catalog) => {
    await using fixture = await workspace(catalog)
    await fixture.switchWorkspace()
    const input = fixture.setup.renderer.currentFocusedEditor
    expect(input).toBeInstanceOf(TextareaRenderable)
    expect(input?.plainText).toBe("Review the changes")
    expect(input?.focused).toBe(true)

    fixture.setup.mockInput.pressEnter()
    await fixture.setup.waitForFrame((frame) => frame.includes("[⋯] Loading workspace…"))
    expect(fixture.created).toHaveLength(0)
    expect(fixture.sent).toHaveLength(0)
    fixture.release()

    await fixture.setup.waitFor(() => fixture.sent.length === 1)
    expect(fixture.created[0]).toMatchObject({
      location: { directory: fixture.target },
      agent: "review",
      model: { providerID: "provider", id: "target-model" },
    })
    expect(fixture.sent[0]).toMatchObject({ text: "Review the changes" })
  },
)

// The tests above cover the static indicator at 100 columns. The animated spinner is wider,
// so check that it still fits next to the label in a narrow terminal.
test("pending submission fits the animated spinner in a narrow terminal", async () => {
  await using fixture = await workspace("agent", { animations: true })
  await fixture.switchWorkspace()
  fixture.setup.resize(44, 30)
  await fixture.setup.renderOnce()
  expect(fixture.setup.captureCharFrame()).not.toContain("Loading workspace…")
  fixture.setup.mockInput.pressEnter()
  await fixture.setup.waitForFrame((frame) => frame.includes("Loading workspace…"))
  expect(fixture.setup.captureCharFrame()).toMatch(/[■⬝]{8} Loading workspace…/)
  expect(fixture.setup.captureCharFrame()).not.toContain("esc interrupt")
  expect(fixture.setup.renderer.currentFocusedEditor?.plainText).toBe("Review the changes")
  expect(fixture.sent).toHaveLength(0)
  fixture.release()
  await fixture.setup.waitFor(() => fixture.sent.length === 1)
  await fixture.setup.waitForFrame((frame) => !frame.includes("Loading workspace…"))
})

test("repeated Enter during worktree loading submits only once", async () => {
  await using fixture = await workspace("agent")
  await fixture.switchWorkspace()
  fixture.setup.mockInput.pressEnter()
  fixture.setup.mockInput.pressEnter()
  await fixture.setup.waitForVisualIdle({ quietFrames: 2 })
  fixture.release()
  await fixture.setup.waitFor(() => fixture.sent.length === 1)
  // A duplicate would follow the first send, so let it settle before counting.
  await fixture.setup.waitForVisualIdle({ quietFrames: 3 })
  expect(fixture.created).toHaveLength(1)
  expect(fixture.sent).toHaveLength(1)
})

test("editing the prompt while the worktree loads cancels the pending submit", async () => {
  await using fixture = await workspace("agent")
  await fixture.switchWorkspace()
  fixture.setup.mockInput.pressEnter()
  await fixture.setup.waitForFrame((frame) => frame.includes("Loading workspace…"))
  await fixture.setup.mockInput.typeText(" and tests")
  await fixture.setup.waitForFrame((frame) => !frame.includes("Loading workspace…"))
  fixture.release()
  await fixture.setup.waitForVisualIdle({ quietFrames: 2 })
  expect(fixture.created).toHaveLength(0)
  expect(fixture.sent).toHaveLength(0)
  expect(fixture.setup.renderer.currentFocusedEditor?.plainText).toBe("Review the changes and tests")
  fixture.setup.mockInput.pressEnter()
  await fixture.setup.waitFor(() => fixture.sent.length === 1)
  expect(fixture.sent[0]).toMatchObject({ text: "Review the changes and tests" })
})

test("switching away while the worktree loads cancels the pending submit", async () => {
  await using fixture = await workspace("agent")
  await fixture.switchWorkspace()
  fixture.setup.mockInput.pressEnter()
  await fixture.setup.waitForFrame((frame) => frame.includes("Loading workspace…"))
  await fixture.selectWorkspace(process.cwd())
  expect(fixture.setup.captureCharFrame()).not.toContain("Loading workspace…")
  expect(fixture.setup.renderer.currentFocusedEditor?.plainText).toBe("Review the changes")
  fixture.setup.mockInput.pressEnter()
  await fixture.setup.waitFor(() => fixture.sent.length === 1)
  expect(fixture.created[0]).toMatchObject({ location: { directory: process.cwd() }, agent: "build" })
  fixture.release()
  await fixture.setup.waitForVisualIdle({ quietFrames: 2 })
  expect(fixture.created).toHaveLength(1)
  expect(fixture.sent).toHaveLength(1)
})

test("opening the workspace picker cancels a waiting send until a fresh Enter", async () => {
  await using fixture = await workspace("agent")
  await fixture.switchWorkspace()
  fixture.setup.mockInput.pressEnter()
  await fixture.setup.waitForVisualIdle({ quietFrames: 2 })
  await fixture.openWorkspace(process.cwd())
  fixture.release()
  await fixture.setup.waitForVisualIdle({ quietFrames: 3 })
  expect(fixture.created).toHaveLength(0)
  expect(fixture.sent).toHaveLength(0)

  fixture.setup.mockInput.pressEnter()
  await fixture.setup.waitForVisualIdle({ quietFrames: 3 })
  expect(fixture.created).toHaveLength(0)
  expect(fixture.sent).toHaveLength(0)
  expect(fixture.setup.renderer.currentFocusedEditor?.plainText).toBe("Review the changes")

  fixture.setup.mockInput.pressEnter()
  await fixture.setup.waitFor(() => fixture.sent.length === 1)
  expect(fixture.created[0]).toMatchObject({
    location: { directory: process.cwd() },
    agent: "build",
    model: { providerID: "provider", id: "source-model" },
  })
  expect(fixture.sent[0]).toMatchObject({ text: "Review the changes" })
})

// No dialog opens here, so only the location check stops the send.
test("a session moved while its send waits cancels the send", async () => {
  await using fixture = await workspace("agent", { session: true })
  await fixture.setup.ready
  await fixture.setup.waitForFrame((frame) => frame.includes("Build · Source Model Provider"))
  await fixture.setup.waitFor(() => fixture.setup.renderer.currentFocusedEditor instanceof TextareaRenderable)
  fixture.setup.renderer.currentFocusedEditor?.setText("Review the changes")
  fixture.move(fixture.target)
  await fixture.requested
  fixture.setup.mockInput.pressEnter()
  await fixture.setup.waitForFrame((frame) => frame.includes("Loading workspace…"))
  fixture.move(process.cwd())
  // Wait for the move itself rather than the spinner, so a send that was not cancelled is caught below.
  await fixture.setup.waitForFrame((frame) => frame.split("Moved to").length === 3)
  fixture.release()
  await fixture.setup.waitForVisualIdle({ quietFrames: 3 })
  expect(fixture.sent).toHaveLength(0)
  expect(fixture.setup.captureCharFrame()).not.toContain("Loading workspace…")
  expect(fixture.setup.renderer.currentFocusedEditor?.plainText).toBe("Review the changes")
})

test("a temporary catalog failure keeps Enter pending until recovery", async () => {
  await using fixture = await workspace("agent", { holdRetry: true })
  await fixture.switchWorkspace()
  fixture.setup.mockInput.pressEnter()
  await fixture.setup.waitForFrame((frame) => frame.includes("Loading workspace…"))
  fixture.fail()
  await fixture.retried
  await fixture.setup.waitForFrame((frame) => frame.includes("Loading workspace…"))
  expect(fixture.setup.captureCharFrame()).not.toContain("Failed to prepare prompt")
  expect(fixture.created).toHaveLength(0)
  fixture.releaseRetry()
  await fixture.setup.waitFor(() => fixture.sent.length === 1)
  expect(fixture.created).toHaveLength(1)
  expect(fixture.setup.captureCharFrame()).not.toContain("Failed to prepare prompt")
})

test("exhausted catalog retries preserve the prompt and report the error", async () => {
  await using fixture = await workspace("agent")
  await fixture.switchWorkspace()
  fixture.setup.mockInput.pressEnter()
  await fixture.setup.waitForFrame((frame) => frame.includes("Loading workspace…"))
  fixture.fail(Infinity)
  await fixture.exhausted
  await fixture.setup.waitForFrame((frame) => frame.includes("Failed to prepare prompt"))
  expect(fixture.setup.captureCharFrame()).not.toContain("Loading workspace…")
  expect(fixture.created).toHaveLength(0)
  expect(fixture.sent).toHaveLength(0)
  expect(fixture.setup.renderer.currentFocusedEditor?.plainText).toBe("Review the changes")
  fixture.recover()
  fixture.setup.mockInput.pressEnter()
  await fixture.setup.waitFor(() => fixture.sent.length === 1)
  expect(fixture.sent[0]).toMatchObject({ text: "Review the changes" })
})

test("a missing location fails without retrying the prompt catalogs", async () => {
  await using fixture = await workspace("agent")
  await fixture.switchWorkspace()
  fixture.setup.mockInput.pressEnter()
  await fixture.setup.waitForFrame((frame) => frame.includes("Loading workspace…"))
  fixture.missing()
  await fixture.setup.waitForFrame((frame) => frame.includes("Failed to prepare prompt"))
  expect(fixture.created).toHaveLength(0)
  expect(fixture.setup.renderer.currentFocusedEditor?.plainText).toBe("Review the changes")
  expect(fixture.setup.captureCharFrame()).not.toContain("Loading workspace…")
  expect(fixture.loads()).toBe(1)
})

test("a catalog published under another location fails instead of waiting forever", async () => {
  await using fixture = await workspace("agent", { misplaced: true })
  await fixture.switchWorkspace()
  fixture.setup.mockInput.pressEnter()
  await fixture.setup.waitForFrame((frame) => frame.includes("Loading workspace…"))
  fixture.release()
  await fixture.setup.waitForFrame((frame) => frame.includes("Failed to prepare prompt"))
  expect(fixture.setup.captureCharFrame()).not.toContain("Loading workspace…")
  expect(fixture.created).toHaveLength(0)
  expect(fixture.sent).toHaveLength(0)
  expect(fixture.setup.renderer.currentFocusedEditor?.plainText).toBe("Review the changes")
})

test("slash submission waits for the destination command catalog after the agents load", async () => {
  await using fixture = await workspace("agent", { text: "/review changed files", command: true })
  await fixture.switchWorkspace()
  fixture.setup.mockInput.pressEnter()
  await fixture.setup.waitForFrame((frame) => frame.includes("Loading workspace…"))
  fixture.release()
  await fixture.setup.waitForVisualIdle({ quietFrames: 2 })
  expect(fixture.created).toHaveLength(0)
  expect(fixture.sent).toHaveLength(0)
  expect(fixture.commands).toHaveLength(0)
  expect(fixture.setup.captureCharFrame()).toContain("Loading workspace…")

  fixture.releaseCommand()
  await fixture.setup.waitFor(() => fixture.commands.length === 1)
  expect(fixture.sent).toHaveLength(0)
  expect(fixture.commands[0]).toMatchObject({ name: "review", text: "changed files" })
  expect(fixture.created[0]).toMatchObject({ location: { directory: fixture.target }, agent: "review" })
  await fixture.setup.waitForFrame((frame) => !frame.includes("Loading workspace…"))
})

test("ordinary prompts do not wait for the destination command catalog", async () => {
  await using fixture = await workspace("command")
  await fixture.switchWorkspace()
  fixture.setup.mockInput.pressEnter()
  await fixture.setup.waitFor(() => fixture.sent.length === 1)
  expect(fixture.commands).toHaveLength(0)
  expect(fixture.sent[0]).toMatchObject({ text: "Review the changes" })
})

test("opening the external editor cancels a waiting send and keeps the edited draft", async () => {
  const editor = await import("../src/editor")
  const opened = Promise.withResolvers<void>()
  const content = Promise.withResolvers<string>()
  using open = spyOn(editor, "openEditor").mockImplementation(() => {
    opened.resolve()
    return content.promise
  })
  await using fixture = await workspace("agent")
  try {
    await fixture.switchWorkspace()
    fixture.setup.mockInput.pressEnter()
    await fixture.setup.waitForFrame((frame) => frame.includes("Loading workspace…"))
    fixture.setup.mockInput.pressKey("F9")
    await opened.promise
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ value: "Review the changes" }))
    fixture.release()
    await fixture.setup.waitForVisualIdle({ quietFrames: 2 })
    expect(fixture.setup.captureCharFrame()).not.toContain("Loading workspace…")
    expect(fixture.created).toHaveLength(0)
    expect(fixture.sent).toHaveLength(0)

    content.resolve("Edited changes")
    await fixture.setup.waitForFrame((frame) => frame.includes("Edited changes"))
    expect(fixture.setup.renderer.currentFocusedEditor?.plainText).toBe("Edited changes")
    fixture.setup.mockInput.pressEnter()
    await fixture.setup.waitFor(() => fixture.sent.length === 1)
    expect(fixture.sent[0]).toMatchObject({ text: "Edited changes" })
  } finally {
    content.resolve("Edited changes")
    await fixture.setup.waitForVisualIdle({ quietFrames: 2 })
  }
})

async function workspace(
  catalog: string,
  options: {
    text?: string
    command?: boolean
    animations?: boolean
    holdRetry?: boolean
    misplaced?: boolean
    // Open an existing session in the source worktree instead of the home screen.
    session?: boolean
  } = {},
) {
  const source = process.cwd()
  const existing = {
    id: "ses_existing",
    title: "Existing session",
    projectID: "proj_test",
    location: { directory: source },
    agent: "build",
    model: { providerID: "provider", id: "source-model" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 1 },
  }
  let moves = 0
  const target = path.join(path.parse(source).root, "opencode-worktree")
  const gate = Promise.withResolvers<void>()
  const requested = Promise.withResolvers<void>()
  const retried = Promise.withResolvers<void>()
  const exhausted = Promise.withResolvers<void>()
  const retry = Promise.withResolvers<void>()
  if (!options.holdRetry) retry.resolve()
  const command = Promise.withResolvers<void>()
  if (!options.command) command.resolve()
  const created: unknown[] = []
  const sent: unknown[] = []
  const commands: unknown[] = []
  let session: unknown
  let failures = 0
  let missing = false
  let loads = 0
  const setup = await createAppFixture({
    config: { animations: options.animations ?? false, tabs: { enabled: false }, keybinds: { "prompt.editor": "f9" } },
    args: options.session ? { sessionID: existing.id } : undefined,
    fetch: async (url, request) => {
      const directory = url.searchParams.get("location[directory]") ?? source
      const destination = directory === target
      const location = { directory, project: { id: "proj_test", directory, canonical: source } }
      if (destination && url.pathname === `/api/${catalog}`) {
        loads++
        requested.resolve()
        await gate.promise
        if (loads > 1) {
          retried.resolve()
          await retry.promise
        }
        if (missing)
          return json(
            { _tag: "LocationNotFoundError", location: { directory }, message: "Workspace no longer exists" },
            { status: 404 },
          )
        if (failures > 0) {
          failures--
          if (loads >= 3) exhausted.resolve()
          return json({ message: "Catalog unavailable" }, { status: 503 })
        }
      }
      if (destination && url.pathname === "/api/command") await command.promise
      if (url.pathname === "/api/location") return json(location)
      if (url.pathname === "/api/fs/list") return json({ location, data: [] })
      if (url.pathname === "/api/agent")
        return json({
          // A misplaced response publishes the destination's agents under another location's key.
          location:
            destination && options.misplaced ? { ...location, directory: path.join(target, "canonical") } : location,
          data: [{ id: destination ? "review" : "build", mode: "primary", hidden: false, permissions: [] }],
        })
      if (url.pathname === "/api/model")
        return json({
          location,
          data: [
            { id: "source-model", providerID: "provider", name: "Source Model", variants: [] },
            { id: "target-model", providerID: "provider", name: "Target Model", variants: [] },
          ],
        })
      if (url.pathname === "/api/config")
        return json(destination ? [{ type: "document", info: { model: "provider/target-model" } }] : [])
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "provider", name: "Provider" }] })
      if (url.pathname === "/api/command")
        return json({ location, data: [{ name: "review", description: "Review the changes" }] })
      if (url.pathname === "/api/worktree") return json([{ directory: source }, { directory: target, strategy: "git" }])
      if (url.pathname === "/api/session" && request.method === "POST") {
        const body = await request.json()
        created.push(body)
        session = {
          ...body,
          projectID: "proj_test",
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 1, updated: 1 },
        }
        return json({ data: session })
      }
      if (options.session && url.pathname === `/api/session/${existing.id}`) return json({ data: existing })
      if (session && /^\/api\/session\/[^/]+$/.test(url.pathname)) return json({ data: session })
      if (/^\/api\/session\/[^/]+\/(message|inbox|permission)$/.test(url.pathname))
        return json({ data: [], cursor: {} })
      if (/^\/api\/session\/[^/]+\/prompt$/.test(url.pathname)) {
        sent.push(await request.json())
        return json({ data: {} })
      }
      if (/^\/api\/session\/[^/]+\/command$/.test(url.pathname)) {
        commands.push(await request.json())
        return new Response(null, { status: 204 })
      }
      return undefined
    },
  })

  async function openWorkspace(directory: string) {
    setup.mockInput.pressKey("p", { ctrl: true })
    await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof InputRenderable)
    await setup.mockInput.typeText("move")
    await setup.waitForFrame((frame) => frame.includes("Manage workspaces"))
    setup.mockInput.pressEnter()
    await setup.waitForFrame((frame) => frame.includes("Worktrees") && frame.includes(target))
    await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof InputRenderable)
    await setup.mockInput.typeText(directory)
    await setup.waitForFrame((frame) => frame.includes(path.basename(directory)) && frame.includes("new ctrl+a"))
  }

  async function selectWorkspace(directory: string) {
    await openWorkspace(directory)
    setup.mockInput.pressEnter()
    await setup.waitForFrame((frame) => !frame.includes("Worktrees") && frame.includes(path.basename(directory)))
  }

  return {
    setup,
    target,
    created,
    sent,
    commands,
    requested: requested.promise,
    release: gate.resolve,
    releaseCommand: command.resolve,
    move(directory: string) {
      moves++
      setup.events.emit({
        id: `evt_moved_${moves}`,
        created: moves + 1,
        type: "session.moved",
        durable: { aggregateID: existing.id, seq: moves, version: 1 },
        data: { sessionID: existing.id, location: { directory }, projectID: "proj_test" },
      })
    },
    retried: retried.promise,
    exhausted: exhausted.promise,
    releaseRetry: retry.resolve,
    loads: () => loads,
    fail(count = 1) {
      failures = count
      gate.resolve()
    },
    recover() {
      failures = 0
    },
    missing() {
      missing = true
      gate.resolve()
    },
    openWorkspace,
    selectWorkspace,
    async switchWorkspace() {
      await setup.ready
      await setup.waitForFrame((frame) => frame.includes("Build · Source Model Provider"))
      await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof TextareaRenderable)
      setup.renderer.currentFocusedEditor?.setText("")
      setup.renderer.currentFocusedEditor?.setText(options.text ?? "Review the changes")
      setup.renderer.currentFocusedEditor?.gotoBufferEnd()
      setup.mockInput.pressEscape()
      await selectWorkspace(target)
      await requested.promise
    },
    async [Symbol.asyncDispose]() {
      gate.resolve()
      command.resolve()
      retry.resolve()
      await setup[Symbol.asyncDispose]()
    },
  }
}
