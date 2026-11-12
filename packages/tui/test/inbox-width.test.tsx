import { expect, test } from "bun:test"
import { InputRenderable, TextareaRenderable, TextRenderable, type Renderable } from "@opentui/core"
import path from "node:path"
import { createAppFixture } from "./fixture/app"
import { tmpdir } from "./fixture/fixture"
import { session } from "./fixture/local"
import { json } from "./fixture/tui-client"

type App = Awaited<ReturnType<typeof createAppFixture>>

const config = {
  animations: false,
  session: { inbox: true, inbox_layout: "sidebar" },
  tabs: { mode: "on", layout: "vertical" },
  keybinds: { "session.inbox.toggle": "f7" },
} as const

const target = { ...session("ses_inbox_width"), title: "Width" }
const workspace = {
  args: { sessionID: target.id },
  fetch: (url: URL) => {
    if (url.pathname === "/api/session") return json({ data: [target], cursor: {} })
    if (url.pathname === `/api/session/${target.id}`) return json({ data: target })
    if ([`/api/session/${target.id}/message`, `/api/session/${target.id}/inbox`].includes(url.pathname))
      return json({ data: [], cursor: {} })
  },
}

test("Inbox and vertical tabs have independent drag boundaries and double-click resets", async () => {
  await using app = await createAppFixture({ ...workspace, width: 220, height: 32, config })
  await ready(app)
  expectLayout(app, 64, 42)

  await app.mockMouse.drag(63, 5, 79, 5)
  await app.renderOnce()
  expectLayout(app, 80, 42)

  // This boundary is in terminal coordinates, after the actual Inbox width.
  await app.mockMouse.drag(121, 5, 135, 5)
  await app.renderOnce()
  expectLayout(app, 80, 56)

  await app.mockMouse.drag(79, 5, 47, 5)
  // Let deferred render-node cleanup finish before pressing the newly moved boundary.
  await app.waitForVisualIdle()
  expectLayout(app, 48, 56)

  app.renderer.clearSelection()
  await app.mockMouse.doubleClick(47, 5)
  await app.waitForFrame(() => app.renderer.root.findDescendantById("inbox-sidebar")?.width === 64)
  expectLayout(app, 64, 56)

  app.renderer.clearSelection()
  await app.mockMouse.doubleClick(119, 5)
  await app.renderOnce()
  expectLayout(app, 64, 42)
})

test("Inbox drag clamps to 32 through 96 without resizing neighboring tabs", async () => {
  await using app = await createAppFixture({ ...workspace, width: 220, height: 32, config })
  await ready(app)

  await app.mockMouse.drag(63, 5, 10, 5)
  await app.waitForVisualIdle()
  expectLayout(app, 32, 42)

  // Dragging continues even when the clamp leaves the pointer outside the Inbox.
  app.renderer.clearSelection()
  await app.mockMouse.drag(31, 5, 150, 5)
  await app.waitForFrame(() => app.renderer.root.findDescendantById("inbox-sidebar")?.width === 96)
  expectLayout(app, 96, 42)
})

test("Inbox and tabs widths survive relaunch through shared state", async () => {
  await using state = await tmpdir()
  {
    await using app = await createAppFixture({ ...workspace, width: 220, height: 32, state: state.path, config })
    await ready(app)
    await app.mockMouse.drag(63, 5, 79, 5)
    await app.renderOnce()
    await app.mockMouse.drag(121, 5, 131, 5)
    await app.renderOnce()
    expectLayout(app, 80, 52)
  }

  expect(await Bun.file(path.join(state.path, "test/tui/plugin.opencode.inbox.layout.json")).json()).toEqual({
    inboxWidth: 80,
  })
  await using app = await createAppFixture({ ...workspace, width: 220, height: 32, state: state.path, config })
  await ready(app)
  expectLayout(app, 80, 52)

  app.mockInput.pressKey("F7")
  await app.waitFor(() => !app.renderer.root.findDescendantById("inbox-sidebar"))
  await app.renderOnce()
  expectLayout(app, 0, 52)
  app.mockInput.pressKey("F7")
  await app.waitFor(() => !!app.renderer.root.findDescendantById("inbox-sidebar"))
  await app.renderOnce()
  expectLayout(app, 80, 52)
})

test("terminal shrink fits tabs in the remaining columns and restores both preferred widths", async () => {
  await using app = await createAppFixture({ ...workspace, width: 220, height: 32, config })
  await ready(app)
  await app.mockMouse.drag(63, 5, 79, 5)
  await app.renderOnce()
  await app.mockMouse.drag(121, 5, 131, 5)
  await app.renderOnce()
  expectLayout(app, 80, 52)

  app.resize(196, 32)
  await app.renderOnce()
  expectLayout(app, 80, 52)

  app.resize(195, 32)
  await app.renderOnce()
  expectLayout(app, 80, 115, false)

  app.resize(108, 32)
  await app.renderOnce()
  expectLayout(app, 64, 44, false)

  app.resize(76, 32)
  await app.renderOnce()
  expectLayout(app, 32, 44, false)

  app.resize(75, 32)
  await app.renderOnce()
  expectLayout(app, 0, 75, false)
  app.mockInput.pressKey("F7")
  await app.waitForFrame(
    (frame) => frame.includes("Search inbox sessions") && app.renderer.currentFocusedEditor instanceof InputRenderable,
  )
  const drawer = app.renderer.root.findDescendantById("dialog-drawer")!
  expect(drawer.x).toBe(0)
  expect(drawer.width).toBeGreaterThan(0)
  expect(drawer.width).toBeLessThanOrEqual(75)
  expect(app.config().session?.inbox).toBe(true)
  app.mockInput.pressEscape()
  await app.waitFor(() => app.renderer.currentFocusedEditor instanceof TextareaRenderable)

  app.resize(220, 32)
  await app.renderOnce()
  expectLayout(app, 80, 52)
})

test.each(["sidebar", "side-overlay"] as const)("%s with Inbox off leaves tabs at the far left", async (layout) => {
  await using app = await createAppFixture({
    ...workspace,
    width: 220,
    height: 32,
    config: { ...config, session: { inbox: false, inbox_layout: layout } },
  })
  await ready(app)
  expectLayout(app, 0, 42)

  app.mockInput.pressKey("F7")
  if (layout === "sidebar") {
    await app.waitFor(() => !!app.renderer.root.findDescendantById("inbox-sidebar"))
    await app.renderOnce()
    expectLayout(app, 64, 42)
    app.mockInput.pressKey("F7")
    await app.waitFor(() => !app.renderer.root.findDescendantById("inbox-sidebar"))
    await app.renderOnce()
    expectLayout(app, 0, 42)
    return
  }

  await app.waitForFrame(
    (frame) => frame.includes("Search inbox sessions") && app.renderer.currentFocusedEditor instanceof InputRenderable,
  )
  expect(app.renderer.root.findDescendantById("dialog-drawer")).toBeDefined()
  expectLayout(app, 0, 42)
  app.mockInput.pressKey("F7")
  await app.waitFor(() => app.renderer.currentFocusedEditor instanceof TextareaRenderable)
  expectLayout(app, 0, 42)
  expect(app.config().session).toEqual({ inbox: false, inbox_layout: "side-overlay" })
})

test("Inbox owns its width when tabs are disabled", async () => {
  await using app = await createAppFixture({
    ...workspace,
    width: 220,
    height: 32,
    config: { ...config, tabs: { mode: "off", layout: "vertical" } },
  })
  await ready(app)
  const inbox = app.renderer.root.findDescendantById("inbox-sidebar")!
  const prompt = descendants(app.renderer.root).find((node) => node instanceof TextareaRenderable)!
  expect(bounds(inbox)).toMatchObject({ x: 0, width: 64 })
  expect(bounds(paneContaining(prompt, inbox))).toMatchObject({ x: 64, width: 156 })

  await app.mockMouse.drag(63, 5, 87, 5)
  await app.renderOnce()
  expect(bounds(inbox)).toMatchObject({ x: 0, width: 88 })
  expect(bounds(paneContaining(prompt, inbox))).toMatchObject({ x: 88, width: 132 })
})

async function ready(app: App) {
  await app.ready
  await app.waitFor(() => app.renderer.currentFocusedEditor instanceof TextareaRenderable)
  await app.renderOnce()
}

function expectLayout(app: App, inboxWidth: number, tabsWidth: number, vertical = true) {
  const inbox = app.renderer.root.findDescendantById("inbox-sidebar")
  if (inboxWidth) expect(bounds(inbox!)).toEqual({ x: 0, y: 0, width: inboxWidth, height: 32 })
  if (!inboxWidth) expect(inbox).toBeUndefined()

  // Locate the real tab strip and content by their visible label and editor, not generated IDs.
  const nodes = descendants(app.renderer.root)
  const label = nodes.find(
    (node) =>
      node instanceof TextRenderable &&
      node.plainText.includes(target.title) &&
      (!inbox || !descendants(inbox).includes(node)),
  )
  const prompt = nodes.find((node) => node instanceof TextareaRenderable)
  expect(label).toBeDefined()
  expect(prompt).toBeDefined()
  expect(bounds(paneContaining(label!, prompt!))).toEqual({
    x: inboxWidth,
    y: 0,
    width: tabsWidth,
    height: vertical ? 32 : 1,
  })
  const left = inboxWidth + (vertical ? tabsWidth : 0)
  expect(bounds(paneContaining(prompt!, label!))).toMatchObject({ x: left, width: app.renderer.width - left })
}

function bounds(node: Renderable) {
  return { x: node.x, y: node.y, width: node.width, height: node.height }
}

function descendants(node: Renderable): Renderable[] {
  return [node, ...node.getChildren().flatMap(descendants)]
}

function paneContaining(node: Renderable, neighbor: Renderable): Renderable {
  if (!node.parent) throw new Error("Expected neighboring workspace panes")
  if (descendants(node.parent).includes(neighbor)) return node
  return paneContaining(node.parent, neighbor)
}
