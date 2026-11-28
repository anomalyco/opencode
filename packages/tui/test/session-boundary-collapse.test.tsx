import { expect, test } from "bun:test"
import { type Renderable, ScrollBoxRenderable } from "@opentui/core"
import type { SessionInfo, SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client"
import { findBoundaryCollapseGroup, type BoundaryCollapseMode } from "../src/routes/session/boundary-collapse"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"

type AppFixture = Awaited<ReturnType<typeof createAppFixture>>

async function mountBoundarySession(mode: BoundaryCollapseMode, commandCount = 8) {
  const sessionID = `ses_boundary_collapse_${mode}_${crypto.randomUUID()}`
  const session = {
    id: sessionID,
    title: `Boundary collapse (${mode})`,
    projectID: "proj_boundary_collapse",
    location: { directory },
    agent: "build",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 2 },
  } satisfies SessionInfo
  const commands: SessionMessageAssistantTool[] = Array.from({ length: commandCount }, (_, index) => ({
    type: "tool",
    id: `call_shell_${index}`,
    name: "shell",
    time: { created: 2 + index, completed: 3 + index },
    state: {
      status: "completed",
      input: { command: `echo step-${index}` },
      content: [
        {
          type: "text",
          text: Array.from({ length: 6 }, (__, line) => `step-${index} output line ${line}`).join("\n"),
        },
      ],
      metadata: { exit: 0, truncated: false },
    },
  }))
  const messages: SessionMessageInfo[] = [
    { id: "msg_user", type: "user", text: "Run many commands", time: { created: 1 } },
    {
      id: "msg_assistant",
      type: "assistant",
      agent: "build",
      model: { providerID: "fixture", id: "fixture" },
      finish: "stop",
      time: { created: 2, completed: 20 },
      content: [
        { type: "text", text: "Starting work." },
        ...commands,
        { type: "text", text: "All commands finished." },
      ],
    },
  ]

  const app = await createAppFixture({
    width: 110,
    height: 24,
    args: { sessionID },
    config: {
      animations: false,
      tabs: { mode: "off" },
      session: { sidebar: "hide", verbosity: "low", boundary_collapse: mode },
    },
    fetch: (url) => {
      if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
      if (url.pathname === `/api/session/${sessionID}`) return json({ data: session })
      if (url.pathname === `/api/session/${sessionID}/message`) return json({ data: messages.toReversed(), cursor: {} })
      if (url.pathname === `/api/session/${sessionID}/inbox` || url.pathname === `/api/session/${sessionID}/permission`)
        return json({ data: [] })
    },
  })

  await app.ready
  return app
}

async function click(app: AppFixture, text: string) {
  const lines = app.captureCharFrame().split("\n")
  const y = lines.findIndex((line) => line.includes(text))
  expect(y).toBeGreaterThanOrEqual(0)
  await app.mockMouse.click(lines[y].indexOf(text) + 1, y)
}

function findSessionScroll(root: Renderable): ScrollBoxRenderable {
  const find = (node: Renderable): ScrollBoxRenderable | undefined =>
    node instanceof ScrollBoxRenderable && node.getRenderable("msg_user")
      ? node
      : node.getChildren().map(find).find(Boolean)
  const scroll = find(root)
  if (!scroll) throw new Error("Session scrollbox not found")
  return scroll
}

test("findBoundaryCollapseGroup honors off, overflow, and always modes and picks outermost group", () => {
  const outerID = "group-outer"
  const innerID = "group-inner"
  const anchors = [
    {
      target: { type: "group" as const, groupID: outerID, kind: "activity" as const, level: 0 },
      node: { y: 4, height: 24, isDestroyed: false },
    },
    {
      target: { type: "group" as const, groupID: innerID, kind: "exploration" as const, level: 1 },
      node: { y: 8, height: 18, isDestroyed: false },
    },
  ]
  const expanded = () => true

  // Header visible (y=4 >= viewportTop=2): overflow hides, always shows outermost.
  expect(
    findBoundaryCollapseGroup({
      mode: "overflow",
      viewportTop: 2,
      viewportHeight: 16,
      anchors,
      isExpanded: expanded,
    }),
  ).toBeUndefined()
  expect(
    findBoundaryCollapseGroup({
      mode: "always",
      viewportTop: 2,
      viewportHeight: 16,
      anchors,
      isExpanded: expanded,
    })?.groupID,
  ).toBe(outerID)
  expect(
    findBoundaryCollapseGroup({
      mode: "off",
      viewportTop: 2,
      viewportHeight: 16,
      anchors,
      isExpanded: expanded,
    }),
  ).toBeUndefined()

  // Header scrolled above viewport (y=-3 < viewportTop=2): overflow shows outermost.
  const scrolled = [
    {
      target: { type: "group" as const, groupID: outerID, kind: "activity" as const, level: 0 },
      node: { y: -3, height: 24, isDestroyed: false },
    },
    {
      target: { type: "group" as const, groupID: innerID, kind: "exploration" as const, level: 1 },
      node: { y: 1, height: 18, isDestroyed: false },
    },
  ]
  expect(
    findBoundaryCollapseGroup({
      mode: "overflow",
      viewportTop: 2,
      viewportHeight: 16,
      anchors: scrolled,
      isExpanded: expanded,
    })?.groupID,
  ).toBe(outerID)

  // Bottom boundary past the group end (bottom=17 < bottomEdge=18): hidden in both modes.
  const ended = [
    {
      target: { type: "group" as const, groupID: outerID, kind: "activity" as const, level: 0 },
      node: { y: -3, height: 20, isDestroyed: false },
    },
  ]
  expect(
    findBoundaryCollapseGroup({
      mode: "always",
      viewportTop: 2,
      viewportHeight: 16,
      anchors: ended,
      isExpanded: expanded,
    }),
  ).toBeUndefined()
})

test("boundary collapse aligns with group header, sits left of Jump to latest, and folds the block", async () => {
  await using app = await mountBoundarySession("overflow", 8)
  await app.waitForFrame((frame) => frame.includes("+ 8 commands") && frame.includes("All commands finished."))
  expect(app.captureCharFrame()).not.toContain("− Collapse")

  // Expand the low-verbosity activity summary.
  await click(app, "+ 8 commands")
  await app.waitForFrame((frame) => frame.includes("− 8 commands") && frame.includes("step-0"))

  // In overflow mode, while the header is still visible on screen, − Collapse stays hidden.
  expect(app.captureCharFrame()).not.toContain("− Collapse")

  // Scroll just past the group header based on its actual rendered position, staying inside the expanded block.
  const scroll = findSessionScroll(app.renderer.root)
  const lines = app.captureCharFrame().split("\n")
  const headerRow = lines.findIndex((line) => line.includes("− 8 commands"))
  expect(headerRow).toBeGreaterThanOrEqual(0)
  const headerCol = lines[headerRow].indexOf("− 8 commands")
  scroll.scrollTo(scroll.scrollTop + (headerRow - scroll.viewport.y) + 1)
  await app.waitForFrame((frame) => frame.includes("− Collapse") && frame.includes("Jump to latest"))

  // Verify − Collapse sits on the exact same row as Jump to latest, aligned with the group header column.
  const boundaryLine = app
    .captureCharFrame()
    .split("\n")
    .find((line) => line.includes("− Collapse") && line.includes("Jump to latest"))
  expect(boundaryLine).toBeDefined()
  expect(boundaryLine!.indexOf("− Collapse")).toBe(headerCol)
  expect(boundaryLine!.indexOf("− Collapse")).toBeLessThan(boundaryLine!.indexOf("Jump to latest"))

  // Clicking − Collapse folds the block and brings "+ 8 commands" back into view.
  await click(app, "− Collapse")
  await app.waitForFrame((frame) => frame.includes("+ 8 commands") && !frame.includes("− Collapse"))
  expect(app.captureCharFrame()).not.toContain("step-0 output line")
})

test("boundary collapse always mode shows − Collapse while header is visible and hides when switched to off", async () => {
  await using app = await mountBoundarySession("always", 6)
  await app.waitForFrame((frame) => frame.includes("+ 6 commands"))
  await click(app, "+ 6 commands")

  // Header is still visible on screen, yet always mode immediately surfaces − Collapse.
  await app.waitForFrame((frame) => frame.includes("− 6 commands") && frame.includes("− Collapse"))

  // Jump directly to "Collapse at bottom" in Settings and cycle always -> off.
  app.mockInput.pressKey("p", { ctrl: true })
  await app.waitForFrame((frame) => frame.includes("Search"))
  await app.mockInput.typeText("Collapse at bottom")
  await app.waitForFrame((frame) => frame.includes("Collapse at bottom"))
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => frame.includes("Settings") && frame.includes("always"))
  app.mockInput.pressArrow("right")
  await app.waitForFrame((frame) => frame.includes("Collapse at bottom") && frame.includes("off"))
  app.mockInput.pressEscape()

  await app.waitForFrame((frame) => frame.includes("− 6 commands") && !frame.includes("− Collapse"))
})
