import { expect, test } from "bun:test"
import {
  DiffRenderable,
  InputRenderable,
  MouseButton,
  type Renderable,
  ScrollBoxRenderable,
  TextareaRenderable,
} from "@opentui/core"
import type { FileDiffInfo, FormInfo, PermissionRequest, SessionInfo } from "@opencode-ai/client"
import type { Config } from "../src/config"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"

test("/diff focuses the production session panel without sending typing to the prompt", async () => {
  await using state = await tmpdir()
  await using setup = await createSessionFixture(state.path)
  await ready(setup)
  const prompt = editor(setup)
  const transcript = node(setup, "msg_panel_11")

  expect(setup.requests.base).toHaveLength(0)
  expect(setup.requests.diff).toHaveLength(0)
  await setup.mockInput.typeText("/diff")
  await setup.waitForFrame((frame) => frame.includes("Open diff viewer"))
  setup.mockInput.pressEnter()
  await panelReady(setup)
  const panel = node(setup, "session-panel")
  const patches = scroll(setup)
  expect(panel.width).toBeLessThan(setup.renderer.width)
  expect(setup.renderer.currentFocusedEditor).toBeNull()
  expect(node(setup, "msg_panel_11")).toBe(transcript)

  await setup.mockInput.typeText("xyz")
  setup.mockInput.pressEnter()
  await setup.flush()
  expect(prompt.plainText).toBe("")
  expect(setup.requests.prompt).toHaveLength(0)

  focus(setup, "left")
  await setup.waitFor(() => setup.renderer.currentFocusedEditor === prompt)
  await setup.mockInput.typeText("fjm")
  await setup.flush()
  expect(prompt.plainText).toBe("fjm")
  expect(panel.width).toBeLessThan(setup.renderer.width)
  expect(patches.scrollTop).toBe(0)
  expect(text(setup, "diff-review-count")).toBe("0/4")
  expect(text(setup, "diff-footer")).toContain("focus diff")

  focus(setup, "right")
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable === panel)
  setup.mockInput.pressKey("j")
  await setup.waitFor(() => patches.scrollTop > 0)
  expect(prompt.plainText).toBe("fjm")
  setup.mockInput.pressKey("q")
  await setup.waitFor(() => !setup.renderer.root.findDescendantById("session-panel"))
  await setup.waitFor(() => setup.renderer.currentFocusedEditor === prompt)
  expect(node(setup, "msg_panel_11")).toBe(transcript)
  expect(prompt.plainText).toBe("fjm")
  expect(setup.requests.prompt).toHaveLength(0)
})

test("repeated fullscreen toggles retain the viewer, transcript, scroll, and reviewed files", async () => {
  await using state = await tmpdir()
  await using setup = await createSessionFixture(state.path)
  await ready(setup)
  const prompt = editor(setup)
  const transcript = node(setup, "msg_panel_11")
  setup.mockInput.pressKey("F6")
  await panelReady(setup)
  const panel = node(setup, "session-panel")
  const patches = scroll(setup)
  const splitWidth = panel.width
  const history = descendants(setup.renderer.root).find(
    (item) => item instanceof ScrollBoxRenderable && item.findDescendantById("msg_panel_11"),
  )
  if (!(history instanceof ScrollBoxRenderable)) throw new Error("Missing session transcript scrollbox")
  history.scrollTo(4)
  await setup.flush()
  const historyTop = history.scrollTop
  expect(historyTop).toBeGreaterThan(0)

  setup.mockInput.pressKey("m")
  await setup.waitForFrame(() => text(setup, "diff-review-count") === "1/4")
  await setup.flush()
  setup.mockInput.pressKey("n")
  await setup.waitFor(() => patches.scrollTop > 0)
  setup.mockInput.pressKey("j")
  await setup.flush()
  const top = patches.scrollTop
  const header = node(setup, "diff-file-header-1")
  const diffs = descendants(patches).filter((item) => item instanceof DiffRenderable)
  expect(diffs).toHaveLength(3)
  expect(top).toBeGreaterThan(0)

  for (const fullscreen of [true, false, true, false]) {
    setup.mockInput.pressKey("f")
    await setup.waitFor(() => node(setup, "session-panel").width === (fullscreen ? setup.renderer.width : splitWidth))
    await setup.flush()
    expect(node(setup, "session-panel")).toBe(panel)
    expect(scroll(setup)).toBe(patches)
    expect(patches.scrollTop).toBe(top)
    expect(node(setup, "diff-file-header-1")).toBe(header)
    const current = descendants(patches).filter((item) => item instanceof DiffRenderable)
    expect(current).toHaveLength(diffs.length)
    current.forEach((item, index) => expect(item).toBe(diffs[index]))
    expect(text(setup, "diff-review-count")).toBe("1/4")
    expect(node(setup, "msg_panel_11")).toBe(transcript)
    expect(transcript.isDestroyed).toBe(false)
    expect(history.isDestroyed).toBe(false)
    expect(history.scrollTop).toBe(historyTop)
    expect(prompt.isDestroyed).toBe(false)
    expect(setup.renderer.currentFocusedRenderable).toBe(panel)
    expect(setup.requests.base).toHaveLength(1)
    expect(setup.requests.diff).toHaveLength(1)
  }

  setup.mockInput.pressKey("HOME")
  await setup.waitForFrame((frame) => frame.includes("file00.txt") && text(setup, "diff-file-header-0").includes("✓"))
  expect(text(setup, "diff-file-header-0")).toContain("✓")
  expect(setup.requests.diff[0].searchParams.get("location[directory]")).toBe(directory)
  expect(setup.requests.diff[0].searchParams.get("base")).toBe("refs/heads/v2")
})

test("docked tree commands leave the full-screen tree preference unchanged", async () => {
  await using state = await tmpdir()
  await using setup = await createSessionFixture(state.path, { diffs: { tree: true } })
  await ready(setup)
  setup.mockInput.pressKey("F6")
  await panelReady(setup)
  expect(setup.renderer.root.findDescendantById("diff-files")).toBeUndefined()
  setup.mockInput.pressKey("b")
  await setup.flush()
  expect(setup.renderer.root.findDescendantById("diff-files")).toBeUndefined()
  setup.mockInput.pressKey("f")
  await setup.waitFor(() => setup.renderer.root.findDescendantById("diff-files") !== undefined)
  setup.mockInput.pressKey("b")
  await setup.waitFor(() => setup.renderer.root.findDescendantById("diff-files") === undefined)
  setup.mockInput.pressKey("f")
  await setup.waitFor(() => node(setup, "session-panel").width < setup.renderer.width)
  setup.mockInput.pressKey("f")
  await setup.waitFor(() => node(setup, "session-panel").width === setup.renderer.width)
  expect(setup.renderer.root.findDescendantById("diff-files")).toBeUndefined()
  expect(setup.requests.diff).toHaveLength(1)
})

test("right-clicking an inactive diff focuses its screen-relative file menu", async () => {
  await using state = await tmpdir()
  await using setup = await createSessionFixture(state.path)
  await ready(setup)
  const prompt = editor(setup)
  setup.mockInput.pressKey("F6")
  await panelReady(setup)
  const panel = node(setup, "session-panel")
  focus(setup, "left")
  await setup.waitFor(() => setup.renderer.currentFocusedEditor === prompt)
  const header = node(setup, "diff-file-header-0")
  await setup.mockMouse.click(header.x + 1, header.y, MouseButton.RIGHT)
  await setup.waitFor(() => setup.renderer.root.findDescendantById("diff-file-menu") !== undefined)
  const menu = node(setup, "diff-file-menu")
  expect(menu.x).toBe(Math.min(header.x + 1, setup.renderer.width - menu.width))
  expect(menu.x + menu.width).toBeLessThanOrEqual(setup.renderer.width)
  expect(setup.renderer.currentFocusedRenderable).toBe(panel)
  setup.mockInput.pressEnter()
  await setup.waitForFrame(() => text(setup, "diff-review-count") === "1/4")
  expect(setup.renderer.root.findDescendantById("diff-file-menu")).toBeUndefined()
  expect(prompt.plainText).toBe("")
})

test.each([60, 80])("a panel opened at %i columns can split after growing without remounting", async (width) => {
  await using state = await tmpdir()
  await using setup = await createSessionFixture(state.path, { width })
  await ready(setup)
  const prompt = editor(setup)
  const transcript = node(setup, "msg_panel_11")
  setup.mockInput.pressKey("F6")
  await panelReady(setup)
  const panel = node(setup, "session-panel")
  const patches = scroll(setup)
  expect(panel.width).toBe(width)
  setup.mockInput.pressKey("f")
  await setup.flush()
  expect(panel.width).toBe(width)
  expect(prompt.plainText).toBe("")

  setup.resize(160, 36)
  await setup.flush()
  const grownWidth = panel.width
  setup.mockInput.pressKey("f")
  await setup.waitFor(() => node(setup, "session-panel").width !== grownWidth)
  expect(node(setup, "session-panel")).toBe(panel)
  setup.mockInput.pressKey("f")
  await setup.waitFor(() => panel.width === grownWidth)
  if (panel.width === setup.renderer.width) {
    setup.mockInput.pressKey("f")
    await setup.waitFor(() => panel.width < setup.renderer.width)
  }
  expect(panel.x).toBeGreaterThan(0)
  setup.resize(80, 36)
  await setup.waitFor(() => panel.width === 80)
  expect(scroll(setup)).toBe(patches)
  expect(node(setup, "msg_panel_11")).toBe(transcript)
  expect(prompt.isDestroyed).toBe(false)
  expect(setup.renderer.currentFocusedRenderable).toBe(panel)
  expect(setup.requests.base).toHaveLength(1)
  expect(setup.requests.diff).toHaveLength(1)
})

test("split eligibility uses the columns remaining beside vertical session tabs", async () => {
  await using state = await tmpdir()
  await using setup = await createSessionFixture(state.path, {
    width: 122,
    tabs: { enabled: true, layout: "vertical" },
  })
  await ready(setup)
  await setup.waitFor(() => editor(setup).x >= 42)
  setup.mockInput.pressKey("F6")
  await panelReady(setup)
  const panel = node(setup, "session-panel")
  expect(panel.x).toBe(0)
  expect(panel.width).toBe(122)
  setup.mockInput.pressKey("f")
  await setup.flush()
  expect(panel.x).toBe(0)
  expect(panel.width).toBe(122)

  setup.resize(180, 36)
  await setup.flush()
  const grownWidth = panel.width
  setup.mockInput.pressKey("f")
  await setup.waitFor(() => node(setup, "session-panel").width !== grownWidth)
  expect(node(setup, "session-panel")).toBe(panel)
  expect(setup.requests.base).toHaveLength(1)
  expect(setup.requests.diff).toHaveLength(1)
})

test("panel focus, scrolling, and fullscreen use customized keys and footer hints", async () => {
  await using state = await tmpdir()
  await using setup = await createSessionFixture(state.path, {
    width: 240,
    keybinds: {
      leader: "ctrl+space",
      "pane.focus.left": "<leader>h",
      "pane.focus.right": "<leader>l",
      "diff.toggle_fullscreen": "f7",
      "diff.down": "x",
      "diff.up": "z",
    },
  })
  await ready(setup)
  const prompt = editor(setup)
  setup.mockInput.pressKey("F6")
  await panelReady(setup)
  const panel = node(setup, "session-panel")
  const patches = scroll(setup)
  const splitWidth = panel.width
  expect(text(setup, "diff-footer")).toContain("ctrl+space h")
  expect(text(setup, "diff-footer")).toContain("f7")
  expect(text(setup, "diff-footer")).not.toContain("ctrl+x")
  setup.mockInput.pressKey("f")
  setup.mockInput.pressKey("j")
  focus(setup, "left")
  await setup.flush()
  expect(panel.width).toBe(splitWidth)
  expect(patches.scrollTop).toBe(0)
  expect(setup.renderer.currentFocusedRenderable).toBe(panel)
  setup.mockInput.pressKey("x")
  await setup.waitForFrame(() => patches.scrollTop > 0)
  setup.mockInput.pressKey("F7")
  await setup.waitFor(() => panel.width === setup.renderer.width)
  setup.mockInput.pressKey("F7")
  await setup.waitFor(() => panel.width === splitWidth)

  setup.mockInput.pressKey(" ", { ctrl: true })
  setup.mockInput.pressKey("h")
  await setup.waitFor(() => setup.renderer.currentFocusedEditor === prompt)
  await setup.waitForFrame(() => text(setup, "diff-footer").includes("ctrl+space l"))
  setup.mockInput.pressKey(" ", { ctrl: true })
  setup.mockInput.pressKey("l")
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable === panel)
  expect(prompt.plainText).toBe("")
})

test.each(["none", false] as const)(
  "disabled panel keys (%s) have no behavioral or footer fallbacks",
  async (binding) => {
    await using state = await tmpdir()
    await using setup = await createSessionFixture(state.path, {
      width: 240,
      keybinds: {
        "pane.focus.left": binding,
        "pane.focus.right": binding,
        "diff.toggle_fullscreen": binding,
        "diff.down": binding,
        "diff.up": binding,
        "diff.next_file": binding,
        "diff.previous_file": binding,
        "diff.next_hunk": binding,
        "diff.previous_hunk": binding,
        "diff.mark_reviewed": binding,
        "diff.close": binding,
        "diff.help": binding,
      },
    })
    await ready(setup)
    const prompt = editor(setup)
    setup.mockInput.pressKey("F6")
    await panelReady(setup)
    const panel = node(setup, "session-panel")
    const splitWidth = panel.width
    const patches = scroll(setup)
    await setup.mockInput.typeText("fjknpm?[]q")
    focus(setup, "left")
    await setup.flush()
    expect(setup.renderer.currentFocusedRenderable).toBe(panel)
    expect(panel.width).toBe(splitWidth)
    expect(patches.scrollTop).toBe(0)
    expect(text(setup, "diff-review-count")).toBe("0/4")
    expect(prompt.plainText).toBe("")
    expect(text(setup, "diff-footer")).not.toMatch(/ctrl\+x|full screen|j\/k|n\/p|hunks|q close|\? see all/)

    await setup.mockMouse.click(prompt.x + 1, prompt.y)
    await setup.waitFor(() => setup.renderer.currentFocusedEditor === prompt)
    await setup.flush()
    expect(text(setup, "diff-footer")).not.toContain("ctrl+x")
    focus(setup, "right")
    await setup.flush()
    expect(setup.renderer.currentFocusedEditor).toBe(prompt)
  },
)

test("Enter in the diff panel cannot approve a pending permission in either presentation", async () => {
  await using state = await tmpdir()
  await using setup = await createSessionFixture(state.path, { permission: true })
  await setup.waitForFrame((frame) => frame.includes("Permission required"))
  const permissionNode = node(setup, "session.permission")
  setup.mockInput.pressKey("F6")
  await panelReady(setup)
  const panel = node(setup, "session-panel")
  const splitWidth = panel.width
  setup.mockInput.pressEnter()
  await setup.flush()
  expect(setup.requests.permission).toHaveLength(0)
  setup.mockInput.pressKey("f")
  await setup.waitFor(() => panel.width === setup.renderer.width)
  setup.mockInput.pressEnter()
  await setup.flush()
  expect(setup.requests.permission).toHaveLength(0)
  expect(node(setup, "session.permission")).toBe(permissionNode)
  setup.mockInput.pressKey("f")
  await setup.waitFor(() => panel.width === splitWidth)

  focus(setup, "left")
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable !== panel)
  setup.mockInput.pressEnter()
  await setup.waitFor(() => setup.requests.permission.length === 1)
  expect(setup.requests.permission).toEqual([{ reply: "once" }])
})

test.each([true, false])("a form cannot capture diff keys (form already pending: %s)", async (pending) => {
  await using state = await tmpdir()
  await using setup = await createSessionFixture(state.path, { form: pending })
  await setup.waitForFrame((frame) => frame.includes(pending ? setup.form.title : "Transcript item 11"))
  setup.mockInput.pressKey("F6")
  await panelReady(setup)
  if (!pending) {
    setup.events.emit({
      id: "evt_panel_form",
      created: 20,
      type: "form.created",
      location: { directory },
      data: { form: setup.form },
    })
    await setup.waitForFrame((frame) => frame.includes(setup.form.title))
  }
  const panel = node(setup, "session-panel")
  const patches = scroll(setup)
  const splitWidth = panel.width
  setup.mockInput.pressKey("j")
  await setup.waitFor(() => patches.scrollTop > 0)
  setup.mockInput.pressKey("m")
  await setup.waitForFrame(() => text(setup, "diff-review-count") === "1/4")
  setup.mockInput.pressEnter()
  await setup.flush()
  expect(setup.requests.form).toHaveLength(0)
  expect(setup.renderer.currentFocusedRenderable).toBe(panel)
  setup.mockInput.pressKey("f")
  await setup.waitFor(() => panel.width === setup.renderer.width)
  setup.mockInput.pressKey("f")
  await setup.waitFor(() => panel.width === splitWidth)
  expect(setup.requests.form).toHaveLength(0)

  focus(setup, "left")
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable !== panel)
  setup.mockInput.pressKey("x")
  await setup.waitFor(() => setup.renderer.currentFocusedEditor?.plainText === "answerx")
  setup.mockInput.pressEnter()
  await setup.waitFor(() => setup.requests.form.length === 1)
  expect(setup.requests.form).toEqual([{ answer: { target: "answerx" } }])
})

test("disabling the registered diff plugin closes its open panel and removes its bindings", async () => {
  await using state = await tmpdir()
  await using setup = await createSessionFixture(state.path)
  await ready(setup)
  const prompt = editor(setup)
  const transcript = node(setup, "msg_panel_11")
  setup.mockInput.pressKey("F6")
  await panelReady(setup)
  const patches = scroll(setup)
  focus(setup, "left")
  await setup.waitFor(() => setup.renderer.currentFocusedEditor === prompt)
  await setup.mockInput.typeText("/plugins")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("Plugins") && frame.includes("show internal"))
  setup.mockInput.pressKey("a", { ctrl: true })
  await setup.waitForFrame((frame) => frame.includes("opencode.diffs"))
  await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof InputRenderable)
  await setup.mockInput.typeText("opencode.diffs")
  await setup.waitFor(() => setup.renderer.currentFocusedEditor?.plainText === "opencode.diffs")
  await setup.flush()
  setup.mockInput.pressEnter()
  await setup.waitFor(() => !setup.renderer.root.findDescendantById("session-panel"))
  await setup.flush()
  if (setup.captureCharFrame().includes("Plugins")) setup.mockInput.pressEscape()
  await setup.waitFor(() => setup.renderer.currentFocusedEditor === prompt)
  expect(patches.isDestroyed).toBe(true)
  expect(node(setup, "msg_panel_11")).toBe(transcript)
  setup.mockInput.pressKey("F6")
  await setup.flush()
  expect(setup.renderer.root.findDescendantById("session-panel")).toBeUndefined()
  await setup.mockInput.typeText("fjm")
  expect(prompt.plainText).toBe("fjm")
  expect(setup.requests.base).toHaveLength(1)
  expect(setup.requests.diff).toHaveLength(1)
})

const files = Array.from({ length: 4 }, (_, index) => ({
  file: `src/file0${index}.txt`,
  status: "modified",
  additions: 1,
  deletions: 1,
  patch: [
    `--- a/src/file0${index}.txt`,
    `+++ b/src/file0${index}.txt`,
    "@@ -1,30 +1,30 @@",
    `-before ${index}`,
    `+after ${index}`,
    ...Array.from({ length: 29 }, (_, line) => ` context ${index}-${line}`),
    "",
  ].join("\n"),
})) satisfies FileDiffInfo[]

async function createSessionFixture(
  state: string,
  input: {
    width?: number
    tabs?: Config.Info["tabs"]
    diffs?: Config.Info["diffs"]
    keybinds?: Config.Info["keybinds"]
    permission?: boolean
    form?: boolean
  } = {},
) {
  // Drafts survive app disposal in memory, so each production app needs its own session identity.
  const session = {
    id: `ses_panel_${crypto.randomUUID()}`,
    title: "Panel fixture",
    projectID: "proj_panel",
    location: { directory },
    agent: "build",
    model: { providerID: "fixture", id: "model" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 12 },
  } satisfies SessionInfo
  const permission = {
    id: `per_panel_${crypto.randomUUID()}`,
    sessionID: session.id,
    action: "shell",
    resources: ["echo permission-fixture"],
  } satisfies PermissionRequest
  const form = {
    id: `frm_panel_${crypto.randomUUID()}`,
    sessionID: session.id,
    title: "Panel form fixture",
    fields: [
      {
        key: "target",
        type: "string",
        title: "Target",
        options: [{ value: "staging", label: "Staging" }],
        custom: true,
        default: "answer",
      },
    ],
  } satisfies FormInfo
  const location = { directory, project: { id: session.projectID, directory, canonical: directory } }
  const requests = {
    base: [] as URL[],
    diff: [] as URL[],
    prompt: [] as unknown[],
    permission: [] as unknown[],
    form: [] as unknown[],
  }
  const setup = await createAppFixture({
    width: input.width ?? 160,
    height: 36,
    state,
    args: { sessionID: session.id },
    config: {
      animations: false,
      tabs: input.tabs ?? { enabled: false },
      session: { sidebar: "hide", terminal: false },
      // Keep patch geometry stable while testing host presentation changes, not split/unified diff layout.
      diffs: { tree: false, view: "unified", ...input.diffs },
      keybinds: { "diff.open": "f6", ...input.keybinds },
    },
    fetch: async (url, request) => {
      if (url.pathname === "/api/location") return json(location)
      if (url.pathname === "/api/fs/list") return json({ location, data: [] })
      if (url.pathname === "/api/agent")
        return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
      if (url.pathname === "/api/model")
        return json({ location, data: [{ id: "model", providerID: "fixture", name: "Model", variants: [] }] })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "fixture", name: "Fixture" }] })
      if (url.pathname === "/api/vcs") return json({ location, data: { branch: { current: "panel", default: "v2" } } })
      if (url.pathname === "/api/vcs/base") {
        requests.base.push(url)
        return json({ location, data: { name: "v2", ref: "refs/heads/v2", source: "default" } })
      }
      if (url.pathname === "/api/vcs/diff") {
        requests.diff.push(url)
        return json({ location, data: files })
      }
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (url.pathname === `/api/session/${session.id}/message`)
        return json({
          data: Array.from({ length: 12 }, (_, index) => ({
            id: `msg_panel_${String(index).padStart(2, "0")}`,
            type: "user",
            text: `Transcript item ${index}`,
            time: { created: index + 1 },
          })).toReversed(),
          cursor: {},
        })
      if (url.pathname === `/api/session/${session.id}/inbox`) return json({ data: [] })
      if (url.pathname === `/api/session/${session.id}/permission`)
        return json({ data: input.permission ? [permission] : [] })
      if (url.pathname === `/api/session/${session.id}/form`) return json({ data: input.form ? [form] : [] })
      if (url.pathname === `/api/session/${session.id}/prompt`) {
        requests.prompt.push(await request.json())
        return json({ data: {} })
      }
      if (url.pathname === `/api/session/${session.id}/permission/${permission.id}/reply`) {
        requests.permission.push(await request.json())
        return new Response(null, { status: 204 })
      }
      if (url.pathname === `/api/session/${session.id}/form/${form.id}/reply`) {
        requests.form.push(await request.json())
        return new Response(null, { status: 204 })
      }
      return undefined
    },
  })
  return { ...setup, requests, form }
}

type AppFixture = Awaited<ReturnType<typeof createAppFixture>>

async function ready(setup: AppFixture) {
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Transcript item 11") && frame.includes("Build · Model Fixture"), {
    maxPasses: 120,
  })
  await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof TextareaRenderable)
}

async function panelReady(setup: AppFixture) {
  await setup.waitForFrame(
    (frame) => frame.includes("file00.txt") && setup.renderer.currentFocusedRenderable?.id === "session-panel",
    { maxPasses: 120 },
  )
  await setup.flush()
}

function focus(setup: AppFixture, direction: "left" | "right") {
  setup.mockInput.pressKey("x", { ctrl: true })
  setup.mockInput.pressArrow(direction)
}

function node(setup: AppFixture, id: string) {
  const result = setup.renderer.root.findDescendantById(id)
  if (!result) throw new Error(`Missing renderable: ${id}\n${setup.captureCharFrame()}`)
  return result
}

function scroll(setup: AppFixture) {
  const result = node(setup, "diff-patches")
  if (!(result instanceof ScrollBoxRenderable)) throw new Error("Missing diff scrollbox")
  return result
}

function editor(setup: AppFixture) {
  const result = setup.renderer.currentFocusedEditor
  if (!(result instanceof TextareaRenderable)) throw new Error("Missing focused session prompt")
  return result
}

function text(setup: AppFixture, id: string) {
  const item = setup.renderer.root.findDescendantById(id)
  if (!item) return ""
  return setup
    .captureCharFrame()
    .split("\n")
    .slice(item.y, item.y + item.height)
    .map((line) => line.slice(item.x, item.x + item.width).trim())
    .join("\n")
    .trim()
}

function descendants(root: Renderable): Renderable[] {
  return root.getChildren().flatMap((item) => [item, ...descendants(item)])
}
