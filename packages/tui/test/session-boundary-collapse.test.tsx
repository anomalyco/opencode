import { expect, test } from "bun:test"
import { type Renderable, ScrollBoxRenderable } from "@opentui/core"
import type { SessionInfo, SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client"
import { findBoundaryCollapseGroup } from "../src/routes/session/boundary-collapse"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"

test("findBoundaryCollapseGroup honors off, overflow, and always modes and picks outermost group", () => {
  const outerID = JSON.stringify(["m1", "p1", "activity", 0])
  const innerID = JSON.stringify(["m1", "p2", "exploration", 1])
  const anchors = [
    { target: { type: "group" as const, groupID: outerID }, node: { y: 4, height: 24, isDestroyed: false } },
    { target: { type: "group" as const, groupID: innerID }, node: { y: 8, height: 18, isDestroyed: false } },
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
    { target: { type: "group" as const, groupID: outerID }, node: { y: -3, height: 24, isDestroyed: false } },
    { target: { type: "group" as const, groupID: innerID }, node: { y: 1, height: 18, isDestroyed: false } },
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
    { target: { type: "group" as const, groupID: outerID }, node: { y: -3, height: 20, isDestroyed: false } },
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

test("boundary collapse control appears on the left of Jump to latest and collapses the expanded activity block", async () => {
  const sessionID = `ses_boundary_collapse_${crypto.randomUUID()}`
  const session = {
    id: sessionID,
    title: "Boundary collapse",
    projectID: "proj_boundary_collapse",
    location: { directory },
    agent: "build",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 2 },
  } satisfies SessionInfo
  const commands: SessionMessageAssistantTool[] = Array.from({ length: 8 }, (_, index) => ({
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

  await using app = await createAppFixture({
    width: 110,
    height: 24,
    args: { sessionID },
    config: {
      animations: false,
      tabs: { mode: "off" },
      session: { sidebar: "hide", verbosity: "low", boundary_collapse: "overflow" },
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
  await app.waitForFrame((frame) => frame.includes("+ 8 commands") && frame.includes("All commands finished."))
  expect(app.captureCharFrame()).not.toContain("− Collapse")

  async function click(text: string) {
    const lines = app.captureCharFrame().split("\n")
    const y = lines.findIndex((line) => line.includes(text))
    expect(y).toBeGreaterThanOrEqual(0)
    await app.mockMouse.click(lines[y].indexOf(text) + 1, y)
  }

  // Expand the low-verbosity activity summary.
  await click("+ 8 commands")
  await app.waitForFrame((frame) => frame.includes("− 8 commands") && frame.includes("step-0"))

  // Scroll into the middle of the expanded block so its header leaves the viewport while its body crosses the bottom edge.
  const findScroll = (root: Renderable): ScrollBoxRenderable | undefined =>
    root instanceof ScrollBoxRenderable && root.getRenderable("msg_user")
      ? root
      : root.getChildren().map(findScroll).find(Boolean)
  const scroll = findScroll(app.renderer.root)
  if (!scroll) throw new Error("Session scrollbox not found")

  // In overflow mode, while the header is still visible on screen, − Collapse stays hidden.
  expect(app.captureCharFrame()).not.toContain("− Collapse")

  // Scroll down past the header, staying inside the expanded block (before "All commands finished.").
  scroll.scrollTo(12)
  await app.waitForFrame((frame) => frame.includes("− Collapse") && frame.includes("Jump to latest"))

  // Verify − Collapse sits on the exact same row as Jump to latest, on the left side.
  const boundaryLine = app
    .captureCharFrame()
    .split("\n")
    .find((line) => line.includes("− Collapse") && line.includes("Jump to latest"))
  expect(boundaryLine).toBeDefined()
  expect(boundaryLine!.indexOf("− Collapse")).toBeLessThan(boundaryLine!.indexOf("Jump to latest"))

  // Clicking − Collapse folds the block and brings "+ 8 commands" back into view.
  await click("− Collapse")
  await app.waitForFrame((frame) => frame.includes("+ 8 commands") && !frame.includes("− Collapse"))
  expect(app.captureCharFrame()).not.toContain("step-0 output line")
})

test("boundary collapse always mode shows − Collapse even while the group header is visible, and Settings can switch it live", async () => {
  const sessionID = `ses_boundary_collapse_always_${crypto.randomUUID()}`
  const session = {
    id: sessionID,
    title: "Boundary collapse always",
    projectID: "proj_boundary_collapse",
    location: { directory },
    agent: "build",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 2 },
  } satisfies SessionInfo
  const commands: SessionMessageAssistantTool[] = Array.from({ length: 6 }, (_, index) => ({
    type: "tool",
    id: `call_always_${index}`,
    name: "shell",
    time: { created: 2 + index, completed: 3 + index },
    state: {
      status: "completed",
      input: { command: `echo always-${index}` },
      content: [{ type: "text", text: `always-${index}\nline2\nline3\nline4` }],
      metadata: { exit: 0, truncated: false },
    },
  }))
  const messages: SessionMessageInfo[] = [
    { id: "msg_user", type: "user", text: "Run commands", time: { created: 1 } },
    {
      id: "msg_assistant",
      type: "assistant",
      agent: "build",
      model: { providerID: "fixture", id: "fixture" },
      finish: "stop",
      time: { created: 2, completed: 20 },
      content: [...commands, { type: "text", text: "Done." }],
    },
  ]

  await using app = await createAppFixture({
    width: 110,
    height: 24,
    args: { sessionID },
    config: {
      animations: false,
      tabs: { mode: "off" },
      session: { sidebar: "hide", verbosity: "low", boundary_collapse: "always" },
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
  await app.waitForFrame((frame) => frame.includes("+ 6 commands"))
  const lines = app.captureCharFrame().split("\n")
  const y = lines.findIndex((line) => line.includes("+ 6 commands"))
  await app.mockMouse.click(lines[y].indexOf("+ 6 commands") + 1, y)
  // Header is still visible on screen, yet always mode immediately surfaces − Collapse.
  await app.waitForFrame((frame) => frame.includes("− 6 commands") && frame.includes("− Collapse"))

  // Open Settings and cycle "Collapse at bottom" from always -> off.
  app.mockInput.pressKey("p", { ctrl: true })
  await app.waitForFrame((frame) => frame.includes("Open settings"))
  await app.mockInput.typeText("Open settings")
  await app.waitForFrame((frame) => frame.includes("Open settings"))
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => frame.includes("Settings"))
  await app.mockInput.typeText("Collapse at bottom")
  await app.waitForFrame((frame) => frame.includes("Collapse at bottom") && frame.includes("always"))
  app.mockInput.pressArrow("right")
  await app.waitForFrame((frame) => frame.includes("Collapse at bottom") && frame.includes("off"))
  app.mockInput.pressEscape()

  await app.waitForFrame((frame) => frame.includes("− 6 commands") && !frame.includes("− Collapse"))
})
