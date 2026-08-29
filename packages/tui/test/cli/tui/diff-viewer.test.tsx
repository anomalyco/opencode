/** @jsxImportSource @opentui/solid */
import { afterAll, expect, test } from "bun:test"
import { readdir } from "node:fs/promises"
import path from "node:path"
import {
  BoxRenderable,
  DiffRenderable,
  ImageRenderable,
  MouseButton,
  type Renderable,
  ScrollBoxRenderable,
} from "@opentui/core"
import { testRender } from "@opentui/solid"
import type {
  Context,
  Destination,
  KeymapCommand,
  KeymapLayer,
  Page,
  SlotClaim,
  Route,
} from "@opencode-ai/plugin/tui/context"
import { ThemeProvider, useThemes } from "../../../src/context/theme"
import { emptyThemeSource, tmpdir } from "../../fixture/fixture"
import { StorageProvider, useStorage } from "../../../src/context/storage"
import { TuiAppProvider } from "../../../src/context/runtime"
import { ConfigProvider, type Info } from "../../../src/config"
import type { TuiKeybind } from "../../../src/config/keybind"
import { Keymap } from "../../../src/context/keymap"
import diffViewerPlugin from "../../../src/feature-plugins/system/diff-viewer"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createApi, createEventStream, createFetch, json } from "../../fixture/tui-client"
import { DialogProvider, useDialog } from "../../../src/ui/dialog"
import { createDialogApi } from "../../../src/plugin/api"
import { ToastProvider } from "../../../src/ui/toast"
import { createSignal, Show } from "solid-js"
import { diffImageFixture } from "../../fixture/diff-image"

const temporary = await tmpdir()
afterAll(() => temporary[Symbol.asyncDispose]())

test("closing the diff viewer returns to the route it opened from", async () => {
  const viewer = await renderDiffViewer([])
  try {
    expect(viewer.current()).toEqual({
      type: "plugin",
      id: "opencode.diffs",
      name: "diff",
      data: { sessionID: "session-1", returnRoute: startRoute },
    })
    const route = viewer.current()
    expect(route.type === "plugin" ? route.data?.returnRoute : undefined).not.toBe(startRoute)
    expect(viewer.vcsDiffInput()).toEqual({
      location: { directory: "/repo/session" },
      mode: "branch",
      base: "refs/heads/v2",
      context: "12",
    })

    expect(viewer.commands.has("diff.close")).toBe(true)
    viewer.commands.get("diff.close")!.run()
    expect(viewer.current()).toEqual(startRoute)
  } finally {
    viewer.app.renderer.destroy()
  }
})

test("ctrl+c closes the diff viewer without exiting the application", async () => {
  const viewer = await renderDiffViewer([])

  try {
    viewer.app.mockInput.pressKey("c", { ctrl: true })
    await viewer.app.waitFor(() => viewer.current().type !== "plugin")
    expect(viewer.current()).toEqual(startRoute)
  } finally {
    viewer.app.renderer.destroy()
  }
})

test("shows an error instead of an empty diff when loading fails", async () => {
  const viewer = await renderDiffViewer([], { fail: true })
  try {
    await viewer.app.waitForFrame((frame) => frame.includes("Could not load diff"))
    expect(viewer.app.captureCharFrame()).not.toContain("No changes to show")
  } finally {
    viewer.app.renderer.destroy()
  }
})

test("uses the active location when opened outside a session", async () => {
  const viewer = await renderDiffViewer([], { initialRoute: { type: "home" } })
  try {
    expect(viewer.vcsDiffInput()).toEqual({
      location: { directory: "/repo/default" },
      mode: "branch",
      base: "refs/heads/v2",
      context: "12",
    })
  } finally {
    viewer.app.renderer.destroy()
  }
})

test("base lookup is lazy until the viewer opens", async () => {
  const viewer = await renderDiffViewer([], { open: false })
  try {
    expect(viewer.baseRequests).toHaveLength(0)
    expect(viewer.diffRequests).toHaveLength(0)
    viewer.commands.get("diff.open")!.run()
    await viewer.app.waitForFrame((frame) => frame.includes("No changes to show"))
    expect(viewer.baseRequests).toHaveLength(1)
    expect(viewer.baseRequests[0].searchParams.get("location[directory]")).toBe("/repo/session")
    expect(viewer.diffRequests).toHaveLength(1)
    expect(viewer.vcsDiffInput()).toMatchObject({ mode: "branch", base: "refs/heads/v2" })
  } finally {
    viewer.app.renderer.destroy()
  }
})

test.each([50, 160])("the source chooser selects all three scopes directly at %i columns", async (width) => {
  const files = {
    branch: ["committed.txt", "staged.txt", "unstaged.txt", "untracked.txt"],
    committed: ["committed.txt"],
    working: ["staged.txt", "unstaged.txt", "untracked.txt"],
  }
  const viewer = await renderDiffViewer([], {
    width,
    height: 30,
    diffResponse: async (url) => {
      const mode = url.searchParams.get("mode")
      if (mode !== "branch" && mode !== "committed" && mode !== "working") throw new Error("Unexpected diff mode")
      return json({
        location: session.location,
        data: files[mode].map((file) => ({
          file,
          status: "modified",
          additions: 1,
          deletions: 0,
        })),
      })
    },
  })
  try {
    expect(viewer.vcsDiffInput()).toMatchObject({ mode: "branch" })
    for (const choice of [
      { mode: "committed", index: 1, label: "Committed", absent: "untracked.txt" },
      { mode: "working", index: 2, label: "Uncommitted", absent: "committed.txt" },
      { mode: "branch", index: 0, label: "All", absent: "never-present.txt" },
    ] as const) {
      await chooseSource(viewer, choice.index)
      await viewer.app.waitForFrame((frame) => frame.includes(choice.label) && !frame.includes("Loading diff"))
      const frame = viewer.app.captureCharFrame()
      expect(frame).toContain(files[choice.mode][0])
      expect(frame).not.toContain(choice.absent)
      expect(viewer.vcsDiffInput()).toMatchObject({ mode: choice.mode })
      expect(viewer.diffRequests.at(-1)!.searchParams.get("base")).toBe(
        choice.mode === "working" ? null : "refs/heads/v2",
      )
    }
    expect(viewer.baseRequests).toHaveLength(1)
    expect(viewer.diffRequests).toHaveLength(4)
    expect(viewer.writes).toHaveLength(0)
    expect(viewer.settings().diffs?.source).toBeUndefined()
  } finally {
    viewer.app.renderer.destroy()
  }
})

test.each(["branch", "committed", "working"] as const)(
  "reopening remembers the last source choice instead of the initial %s setting",
  async (source) => {
    const viewer = await renderDiffViewer(hunkDiff, { source, height: 30 })
    try {
      expect(viewer.vcsDiffInput()).toMatchObject({ mode: source })
      expect(viewer.baseRequests).toHaveLength(source === "working" ? 0 : 1)
      await chooseSource(viewer, source === "working" ? 1 : 2)
      await viewer.app.waitForFrame(
        (frame) => frame.includes(source === "working" ? "Committed" : "Uncommitted") && frame.includes("const first"),
      )
      expect(viewer.writes).toHaveLength(0)
      expect(viewer.settings().diffs?.source).toBe(source)
      viewer.commands.get("diff.close")!.run()
      await viewer.app.flush()
      viewer.commands.get("diff.open")!.run()
      await viewer.app.waitForFrame((frame) => frame.includes("const first"))
      expect(viewer.vcsDiffInput()).toMatchObject({ mode: source === "working" ? "committed" : "working" })
      expect(viewer.baseRequests).toHaveLength(source === "working" ? 2 : 1)
      expect(viewer.diffRequests).toHaveLength(3)
    } finally {
      viewer.app.renderer.destroy()
    }
  },
)

test("explicit route source overrides the configured default", async () => {
  const viewer = await renderDiffViewer(hunkDiff, {
    source: "working",
    initialRoute: { type: "plugin", id: "opencode.diffs", name: "diff", data: { mode: "committed" } },
  })
  try {
    expect(viewer.vcsDiffInput()).toMatchObject({ mode: "committed", base: "refs/heads/v2" })
    expect(viewer.settings().diffs?.source).toBe("working")
  } finally {
    viewer.app.renderer.destroy()
  }
})

test.each([50, 80, 160])(
  "keeps scope, base, and review count on one row with a selectable base at %i columns",
  async (width) => {
    const viewer = await renderDiffViewer(hunkDiff, {
      width,
      height: 30,
      kittyKeyboard: true,
      base: {
        name: "release",
        ref: "refs/remotes/origin/release",
        source: "reflog",
      },
    })
    try {
      const header = viewer.app.renderer.root.findDescendantById("diff-source-header")!
      const source = viewer.app.renderer.root.findDescendantById("diff-source-switch")!
      const count = viewer.app.renderer.root.findDescendantById("diff-review-count")!
      expect(header.height).toBe(1)
      expect(source.y).toBe(header.y)
      expect(count.y).toBe(header.y)
      expect(viewer.app.captureCharFrame().split("\n")[header.y]).toMatch(/All · vs release\s+0\/1/)
      expect(viewer.app.captureCharFrame()).not.toContain("reviewed")
      expect(viewer.vcsDiffInput()).toMatchObject({ base: "refs/remotes/origin/release" })
      await viewer.app.mockMouse.click(source.x, source.y)
      await viewer.app.waitForFrame((frame) => frame.includes("Diff source"))
      expect(viewer.app.captureCharFrame()).toMatch(/Base\s+release/)
      const rows = viewer.app.captureCharFrame().split("\n")
      const first = rows.findIndex((row) => row.includes("Branch + local changes"))
      expect(rows[first]).toMatch(/All\s+Branch \+ local changes/)
      expect(rows[first + 1]).toMatch(/Committed\s+Branch commits only/)
      expect(rows[first + 2]).toMatch(/Uncommitted\s+Local changes only/)
      expect(rows[first + 3]).toMatch(/Base\s+release/)
      expect(rows[first + 1].indexOf("Branch commits only")).toBe(rows[first].indexOf("Branch + local changes"))
      expect(rows[first + 2].indexOf("Local changes only")).toBe(rows[first].indexOf("Branch + local changes"))
      viewer.app.mockInput.pressEscape()
      await viewer.app.waitForFrame((frame) => !frame.includes("Diff source"))
      viewer.commands.get("diff.mark_reviewed")!.run()
      await viewer.app.flush()
      expect(viewer.app.captureCharFrame().split("\n")[header.y]).toMatch(/All · vs release\s+1\/1/)
      await chooseSource(viewer, 2)
      await viewer.app.waitForFrame((frame) => frame.includes("Uncommitted · vs HEAD"))
      viewer.app.mockInput.pressKey("d")
      await viewer.app.waitForFrame((frame) => frame.includes("Diff source"))
      expect(viewer.app.captureCharFrame()).toMatch(/Base\s+release/)
      expect(viewer.app.captureCharFrame()).not.toMatch(/Base\s+HEAD/)
      expect(viewer.baseRequests).toHaveLength(1)
    } finally {
      viewer.app.renderer.destroy()
    }
  },
)

test.each([50, 80, 100, 160])(
  "long comparison bases cannot hide the source or review count at %i columns",
  async (width) => {
    const viewer = await renderDiffViewer(hunkDiff, {
      width,
      source: "committed",
      base: { ...baseFixture, name: "release/very-long-comparison-branch-name-that-does-not-fit-in-the-header" },
    })
    try {
      const header = viewer.app.renderer.root.findDescendantById("diff-source-header")!
      const count = viewer.app.renderer.root.findDescendantById("diff-review-count")!
      const row = viewer.app.captureCharFrame().split("\n")[header.y]
      expect(header.height).toBe(1)
      expect(row).toContain("Committed · vs")
      expect(row).toContain("0/1")
      expect(row).not.toContain("release/very-long-comparison-branch-name-that-does-not-fit-in-the-header")
      expect(count.y).toBe(header.y)
      expect(count.x + count.width).toBeLessThanOrEqual(header.x + header.width)
      const hint = viewer.app.renderer.root.findDescendantById("diff-help-shortcut")!
      if (width < 90) {
        expect(hint.y).toBe(header.y)
        expect(hint.x).toBeGreaterThan(count.x + count.width)
        expect(findScrollBox(viewer.app.renderer.root)!.viewport.y).toBeGreaterThan(header.y)
      }
    } finally {
      viewer.app.renderer.destroy()
    }
  },
)

test("opening the source chooser from initial Uncommitted does not resolve a branch base", async () => {
  const viewer = await renderDiffViewer(hunkDiff, { source: "working" })
  try {
    viewer.app.mockInput.pressKey("d")
    await viewer.app.waitForFrame((frame) => frame.includes("Diff source"))
    expect(viewer.app.captureCharFrame()).toContain("Uncommitted · vs HEAD")
    expect(viewer.app.captureCharFrame()).toMatch(/Base\s+Choose\.\.\./)
    expect(viewer.baseRequests).toHaveLength(0)
    expect(viewer.diffRequests).toHaveLength(1)
  } finally {
    viewer.app.renderer.destroy()
  }
})

test.each(["branch", "committed", "working"] as const)(
  "choosing a base remembers it and refreshes only the affected %s comparison",
  async (source) => {
    const viewer = await renderDiffViewer(hunkDiff, { source, height: 30, kittyKeyboard: true })
    try {
      viewer.commands.get("diff.mark_reviewed")!.run()
      await viewer.app.flush()
      expect(viewer.app.captureCharFrame()).toContain("1/1")
      await chooseSource(viewer, 3)
      await viewer.app.waitForFrame((frame) => frame.includes("Base branch") && frame.includes("origin/release"))
      expect(viewer.app.captureCharFrame()).toMatch(/●\s+v2/)
      expect(viewer.branchesRequests[0].searchParams.get("location[directory]")).toBe("/repo/session")
      expect(viewer.branchesRequests[0].searchParams.get("limit")).toBe("100")
      await viewer.app.mockInput.typeText("origin/release")
      await Bun.sleep(160)
      await viewer.app.waitFor(() => viewer.branchesRequests.at(-1)?.searchParams.get("search") === "origin/release")
      await viewer.app.waitForFrame((frame) => frame.includes("origin/release") && !frame.includes("Loading branches"))
      viewer.app.mockInput.pressEnter()
      await viewer.app.waitForFrame((frame) => !frame.includes("Base branch") && frame.includes("src/file.txt"))
      expect(viewer.mutationRequests).toHaveLength(0)
      expect(viewer.vcsDiffInput()).toEqual({
        location: session.location,
        mode: source,
        context: "12",
        ...(source === "working" ? {} : { base: "origin/release" }),
      })
      expect(viewer.diffRequests).toHaveLength(source === "working" ? 1 : 2)
      expect(viewer.app.captureCharFrame()).toContain(source === "working" ? "1/1" : "0/1")
      expect(viewer.writes).toHaveLength(0)
      if (source !== "working") viewer.commands.get("diff.mark_reviewed")!.run()
      await viewer.app.flush()
      expect(viewer.app.captureCharFrame()).toContain("1/1")
      viewer.commands.get("diff.close")!.run()
      await viewer.app.flush()
      viewer.commands.get("diff.open")!.run()
      await viewer.app.waitForFrame((frame) => frame.includes("const first"))
      expect(viewer.app.captureCharFrame()).toContain("0/1")
      expect(viewer.diffRequests).toHaveLength(source === "working" ? 2 : 3)
      if (source !== "working") expect(viewer.vcsDiffInput()).toMatchObject({ base: "origin/release" })
      await chooseSource(viewer, 3)
      await viewer.app.waitForFrame((frame) => /●\s+origin\/release/.test(frame))
      expect(viewer.baseRequests).toHaveLength(1)
    } finally {
      viewer.app.renderer.destroy()
    }
  },
)

test.each(["branch", "committed"] as const)("an ambiguous base never requests a guessed %s diff", async (source) => {
  const viewer = await renderDiffViewer([], {
    source,
    height: 30,
    kittyKeyboard: true,
    baseResponse: async () => json({ message: "choose a base" }, { status: 503 }),
    diffResponse: async (url) =>
      url.searchParams.get("base")
        ? json({ location: session.location, data: hunkDiff })
        : json({ message: "choose a base" }, { status: 503 }),
  })
  try {
    expect(viewer.app.captureCharFrame()).toContain("Choose a base branch")
    expect(viewer.app.captureCharFrame()).not.toContain("No changes to show")
    expect(viewer.diffRequests).toHaveLength(0)
    await chooseSource(viewer, 3)
    await viewer.app.waitForFrame((frame) => frame.includes("Base branch") && frame.includes("origin/release"))
    viewer.app.mockInput.pressKey("HOME")
    viewer.app.mockInput.pressArrow("down")
    viewer.app.mockInput.pressEnter()
    await viewer.app.waitForFrame((frame) => frame.includes("vs release") && frame.includes("const first"))
    expect(viewer.vcsDiffInput()).toMatchObject({ mode: source, base: "release" })
    expect(viewer.settings().diffs?.source).toBe(source)
    expect(viewer.baseRequests).toHaveLength(1)
  } finally {
    viewer.app.renderer.destroy()
  }
})

test("base and scope choices survive reopening but not a new TUI instance", async () => {
  const viewer = await renderDiffViewer(hunkDiff, { source: "working", height: 30, kittyKeyboard: true })
  try {
    await chooseSource(viewer, 3)
    await viewer.app.waitForFrame((frame) => frame.includes("origin/release"))
    viewer.app.mockInput.pressArrow("down")
    viewer.app.mockInput.pressEnter()
    await viewer.app.waitForFrame((frame) => !frame.includes("Base branch"))
    await chooseSource(viewer, 1)
    await viewer.app.waitForFrame((frame) => frame.includes("Committed · vs release") && frame.includes("const first"))
    viewer.commands.get("diff.close")!.run()
    await viewer.app.flush()
    viewer.commands.get("diff.open")!.run()
    await viewer.app.waitForFrame((frame) => frame.includes("Committed · vs release") && frame.includes("const first"))
    expect(viewer.writes).toHaveLength(0)
    expect(viewer.mutationRequests).toHaveLength(0)
    expect(await readdir(path.join(viewer.state, "test", "tui"))).toEqual([])
  } finally {
    viewer.app.renderer.destroy()
  }

  const restarted = await renderDiffViewer(hunkDiff, { state: viewer.state, source: "working", height: 30 })
  try {
    expect(restarted.vcsDiffInput()).toMatchObject({ mode: "working" })
    await chooseSource(restarted, 1)
    await restarted.app.waitForFrame((frame) => frame.includes("Committed · vs v2") && frame.includes("const first"))
    expect(restarted.vcsDiffInput()).toMatchObject({ base: "refs/heads/v2" })
    expect(restarted.writes).toHaveLength(0)
  } finally {
    restarted.app.renderer.destroy()
  }
})

test("base choices are isolated by branch within the same location", async () => {
  const viewer = await renderDiffViewer(hunkDiff, { height: 30, kittyKeyboard: true })
  try {
    await chooseSource(viewer, 3)
    await viewer.app.waitForFrame((frame) => frame.includes("origin/release"))
    viewer.app.mockInput.pressArrow("down")
    viewer.app.mockInput.pressEnter()
    await viewer.app.waitForFrame((frame) => frame.includes("All · vs release") && frame.includes("const first"))
    viewer.setBranch("other-feature")
    await viewer.app.waitForFrame((frame) => frame.includes("All · vs v2") && frame.includes("const first"))
    expect(viewer.vcsDiffInput()).toMatchObject({ base: "refs/heads/v2" })
    viewer.setBranch("feature")
    await viewer.app.waitForFrame((frame) => frame.includes("All · vs release") && frame.includes("const first"))
    expect(viewer.vcsDiffInput()).toMatchObject({ base: "release" })
    expect(viewer.baseRequests).toHaveLength(2)
    expect(viewer.mutationRequests).toHaveLength(0)
  } finally {
    viewer.app.renderer.destroy()
  }
})

test("an invalid comparison reports an error and allows another base choice", async () => {
  const viewer = await renderDiffViewer(hunkDiff, {
    height: 30,
    kittyKeyboard: true,
    diffResponse: async (url) =>
      url.searchParams.get("base") === "release"
        ? json({ message: "no common history" }, { status: 503 })
        : json({ location: session.location, data: hunkDiff }),
  })
  try {
    await chooseSource(viewer, 3)
    await viewer.app.waitForFrame((frame) => frame.includes("origin/release"))
    viewer.app.mockInput.pressArrow("down")
    viewer.app.mockInput.pressEnter()
    await viewer.app.waitForFrame((frame) => frame.includes("Base or diff unavailable"))
    expect(viewer.app.captureCharFrame()).not.toContain("No changes to show")
    await chooseSource(viewer, 3)
    await viewer.app.waitForFrame((frame) => frame.includes("origin/release"))
    viewer.app.mockInput.pressKey("HOME")
    viewer.app.mockInput.pressEnter()
    await viewer.app.waitForFrame((frame) => frame.includes("All · vs v2") && frame.includes("const first"))
    expect(viewer.diffRequests).toHaveLength(3)
    expect(viewer.vcsDiffInput()).toMatchObject({ base: "v2" })
    expect(viewer.mutationRequests).toHaveLength(0)
  } finally {
    viewer.app.renderer.destroy()
  }
})

test("base search failures are visible without changing the diff", async () => {
  const viewer = await renderDiffViewer(hunkDiff, {
    height: 30,
    branchesResponse: async () => json({ message: "branches unavailable" }, { status: 503 }),
  })
  try {
    await chooseSource(viewer, 3)
    await viewer.app.waitForFrame((frame) => frame.includes("Could not load branches"))
    expect(viewer.app.captureCharFrame()).toContain("All · vs v2")
    expect(viewer.mutationRequests).toHaveLength(0)
    expect(viewer.diffRequests).toHaveLength(1)
  } finally {
    viewer.app.renderer.destroy()
  }
})

test("a late base lookup cannot overwrite an in-memory base choice", async () => {
  const pending = Promise.withResolvers<Response>()
  const viewer = await renderDiffViewer(hunkDiff, {
    height: 30,
    pending: true,
    kittyKeyboard: true,
    baseResponse: () => pending.promise,
  })
  try {
    await chooseSource(viewer, 3)
    await viewer.app.waitForFrame((frame) => frame.includes("origin/release"))
    viewer.app.mockInput.pressArrow("down")
    viewer.app.mockInput.pressEnter()
    await viewer.app.waitForFrame((frame) => frame.includes("All · vs release") && frame.includes("const first"))
    pending.resolve(json({ location: session.location, data: baseFixture }))
    await viewer.app.flush()
    expect(viewer.app.captureCharFrame()).toContain("All · vs release")
    expect(viewer.diffRequests).toHaveLength(1)
    expect(viewer.vcsDiffInput()).toMatchObject({ base: "release" })
    expect(viewer.baseRequests).toHaveLength(1)
    await chooseSource(viewer, 1)
    await viewer.app.waitForFrame((frame) => frame.includes("Committed · vs release"))
    expect(viewer.vcsDiffInput()).toMatchObject({ mode: "committed", base: "release" })
    viewer.app.mockInput.pressKey("d")
    await viewer.app.waitForFrame((frame) => frame.includes("Diff source"))
    expect(viewer.app.captureCharFrame()).toMatch(/Base\s+release/)
  } finally {
    pending.resolve(json({ location: session.location, data: baseFixture }))
    viewer.app.renderer.destroy()
  }
})

test("dismissing the base picker leaves the comparison unchanged", async () => {
  const viewer = await renderDiffViewer(hunkDiff, {
    height: 30,
    kittyKeyboard: true,
  })
  try {
    await chooseSource(viewer, 3)
    await viewer.app.waitForFrame((frame) => frame.includes("origin/release"))
    viewer.app.mockInput.pressArrow("down")
    viewer.app.mockInput.pressEscape()
    await viewer.app.waitForFrame((frame) => !frame.includes("Base branch"))
    viewer.app.mockInput.pressKey("d")
    await viewer.app.waitForFrame((frame) => frame.includes("Diff source"))
    expect(viewer.app.captureCharFrame()).toContain("Diff source")
    expect(viewer.app.captureCharFrame()).toContain("All · vs v2")
    expect(viewer.diffRequests).toHaveLength(1)
  } finally {
    viewer.app.renderer.destroy()
  }
})

test("the base picker remembers its captured location without refreshing a moved session", async () => {
  const viewer = await renderDiffViewer(hunkDiff, { height: 30, kittyKeyboard: true })
  try {
    await chooseSource(viewer, 3)
    await viewer.app.waitForFrame((frame) => frame.includes("origin/release"))
    viewer.setSessionLocation({ directory: "/repo/moved" })
    await viewer.app.flush()
    viewer.app.mockInput.pressArrow("down")
    viewer.app.mockInput.pressEnter()
    await viewer.app.waitForFrame((frame) => !frame.includes("Base branch"))
    expect(viewer.mutationRequests).toHaveLength(0)
    expect(viewer.vcsDiffInput()).toMatchObject({ location: { directory: "/repo/moved" }, base: "refs/heads/v2" })
    expect(viewer.diffRequests).toHaveLength(2)
    viewer.setSessionLocation(session.location)
    await viewer.app.waitForFrame((frame) => frame.includes("All · vs release") && frame.includes("const first"))
    expect(viewer.vcsDiffInput()).toMatchObject({ location: session.location, base: "release" })
  } finally {
    viewer.app.renderer.destroy()
  }
})

test("tree, single-file, and layout preferences do not refetch base or diff", async () => {
  const viewer = await renderDiffViewer(hunkDiff, { width: 160 })
  try {
    for (const command of ["diff.toggle_file_tree", "diff.single_patch", "diff.toggle_view"]) {
      viewer.commands.get(command)!.run()
      await viewer.app.flush()
    }
    expect(viewer.writes).toHaveLength(3)
    expect(viewer.settings().diffs).toMatchObject({ tree: false, single: true, view: "unified" })
    expect(viewer.baseRequests).toHaveLength(1)
    expect(viewer.diffRequests).toHaveLength(1)
  } finally {
    viewer.app.renderer.destroy()
  }
})

test("the remapped source chooser preserves its current selection marker", async () => {
  const viewer = await renderDiffViewer(hunkDiff, { height: 30, keybinds: { "diff.switch_source": "x" } })
  try {
    viewer.app.mockInput.pressKey("d")
    await viewer.app.flush()
    expect(viewer.app.captureCharFrame()).not.toContain("Diff source")
    await chooseSource(viewer, 1, "x")
    await viewer.app.waitForFrame((frame) => frame.includes("Committed") && frame.includes("const first"))
    viewer.app.mockInput.pressKey("x")
    await viewer.app.waitForFrame((frame) => frame.includes("Diff source"))
    expect(viewer.app.captureCharFrame()).toMatch(/●\s+Committed/)
    expect(viewer.app.captureCharFrame()).toContain("Branch commits only")
    expect(viewer.app.captureCharFrame()).toContain("Local changes only")
    expect(viewer.app.captureCharFrame()).toMatch(/Base\s+v2/)
    expect(viewer.writes).toHaveLength(0)
  } finally {
    viewer.app.renderer.destroy()
  }
})

test("pending and failed scopes never render the previous scope's files", async () => {
  const pending = Promise.withResolvers<Response>()
  const viewer = await renderDiffViewer([], {
    height: 30,
    diffResponse: async (url) =>
      url.searchParams.get("mode") === "committed"
        ? pending.promise
        : json({ location: session.location, data: hunkDiff }),
  })
  try {
    expect(viewer.app.captureCharFrame()).toContain("const first")
    await chooseSource(viewer, 1)
    await viewer.app.waitForFrame((frame) => frame.includes("Loading diff"))
    expect(viewer.app.captureCharFrame()).toContain("Committed")
    expect(viewer.app.captureCharFrame()).not.toContain("src/file.txt")
    expect(findDiffs(viewer.app.renderer.root)).toHaveLength(0)
    pending.resolve(json({ message: "comparison failed" }, { status: 503 }))
    await viewer.app.waitForFrame((frame) => frame.includes("Could not load diff"))
    expect(viewer.app.captureCharFrame()).not.toContain("No changes to show")
    expect(viewer.app.captureCharFrame()).not.toContain("src/file.txt")
    await chooseSource(viewer, 2)
    await viewer.app.waitForFrame((frame) => frame.includes("Uncommitted") && frame.includes("const first"))
    expect(viewer.baseRequests).toHaveLength(1)
  } finally {
    pending.resolve(json({ location: session.location, data: [] }))
    viewer.app.renderer.destroy()
  }
})

test("late diff responses cannot replace the selected scope", async () => {
  const pending = Promise.withResolvers<Response>()
  const viewer = await renderDiffViewer([], {
    height: 30,
    diffResponse: async (url) =>
      url.searchParams.get("mode") === "committed"
        ? pending.promise
        : json({ location: session.location, data: [{ ...hunkDiff[0], file: "uncommitted.txt" }] }),
  })
  try {
    await chooseSource(viewer, 1)
    await viewer.app.waitForFrame((frame) => frame.includes("Loading diff"))
    await chooseSource(viewer, 2)
    await viewer.app.waitForFrame((frame) => frame.includes("uncommitted.txt"))
    pending.resolve(json({ location: session.location, data: [{ ...hunkDiff[0], file: "committed.txt" }] }))
    await viewer.app.flush()
    expect(viewer.app.captureCharFrame()).toContain("Uncommitted")
    expect(viewer.app.captureCharFrame()).toContain("uncommitted.txt")
    expect(viewer.app.captureCharFrame()).not.toMatch(/\scommitted\.txt/)
    expect(viewer.baseRequests).toHaveLength(1)
  } finally {
    pending.resolve(json({ location: session.location, data: [] }))
    viewer.app.renderer.destroy()
  }
})

test("switching to uncommitted does not wait for or display a late base result", async () => {
  const pending = Promise.withResolvers<Response>()
  const viewer = await renderDiffViewer(hunkDiff, { height: 30, pending: true, baseResponse: () => pending.promise })
  try {
    expect(viewer.app.captureCharFrame()).toContain("Loading diff")
    expect(viewer.diffRequests).toHaveLength(0)
    await chooseSource(viewer, 2)
    await viewer.app.waitForFrame((frame) => frame.includes("Uncommitted") && frame.includes("const first"))
    pending.resolve(json({ location: session.location, data: baseFixture }))
    await viewer.app.flush()
    expect(viewer.app.captureCharFrame()).toContain("vs HEAD")
    expect(viewer.app.captureCharFrame()).not.toContain("vs v2")
    expect(viewer.diffRequests).toHaveLength(1)
    expect(viewer.vcsDiffInput()).toMatchObject({ mode: "working" })
  } finally {
    pending.resolve(json({ location: session.location, data: baseFixture }))
    viewer.app.renderer.destroy()
  }
})

test.each([false, true])(
  "missing base metadata preserves provider branch review (has branch changes: %s)",
  async (changed) => {
    const viewer = await renderDiffViewer([], {
      base: null,
      height: 30,
      diffResponse: async (url) =>
        json({
          location: session.location,
          data:
            url.searchParams.get("mode") === "working"
              ? [{ ...hunkDiff[0], file: "dirty.txt" }]
              : changed
                ? [{ ...hunkDiff[0], file: "branch.txt" }]
                : [],
        }),
    })
    try {
      expect(viewer.app.captureCharFrame()).toContain("All")
      expect(viewer.app.captureCharFrame()).toContain("Base not reported")
      expect(viewer.app.captureCharFrame()).toContain(changed ? "branch.txt" : "No changes to show")
      expect(viewer.app.captureCharFrame()).not.toContain("dirty.txt")
      expect(viewer.app.captureCharFrame()).not.toContain("showing uncommitted")
      expect(viewer.vcsDiffInput()).toEqual({ location: session.location, mode: "branch", context: "12" })
      await chooseSource(viewer, 1)
      await viewer.app.waitForFrame((frame) => frame.includes("Committed comparison unavailable"))
      expect(viewer.app.captureCharFrame()).toContain("Base not reported")
      expect(viewer.app.captureCharFrame()).not.toContain("No changes to show")
      expect(viewer.app.captureCharFrame()).not.toContain("branch.txt")
      expect(viewer.diffRequests).toHaveLength(1)
      await chooseSource(viewer, 2)
      await viewer.app.waitForFrame((frame) => frame.includes("dirty.txt"))
      expect(viewer.app.captureCharFrame()).not.toContain("Base not reported")
      expect(viewer.vcsDiffInput()).toEqual({ location: session.location, mode: "working", context: "12" })
      expect(viewer.diffRequests).toHaveLength(2)
      expect(viewer.baseRequests).toHaveLength(1)
    } finally {
      viewer.app.renderer.destroy()
    }
  },
)

test("unresolved branch comparisons report errors without switching to working", async () => {
  const viewer = await renderDiffViewer([], {
    base: null,
    height: 30,
    diffResponse: async (url) =>
      url.searchParams.get("mode") === "branch"
        ? json({ message: "comparison base unavailable" }, { status: 503 })
        : json({ location: session.location, data: hunkDiff }),
  })
  try {
    expect(viewer.app.captureCharFrame()).toContain("Could not load diff")
    expect(viewer.app.captureCharFrame()).not.toContain("No changes to show")
    expect(viewer.vcsDiffInput()).toMatchObject({ mode: "branch" })
    expect(viewer.diffRequests).toHaveLength(1)
    await chooseSource(viewer, 2)
    await viewer.app.waitForFrame((frame) => frame.includes("const first"))
    expect(viewer.vcsDiffInput()).toMatchObject({ mode: "working" })
    expect(viewer.baseRequests).toHaveLength(1)
  } finally {
    viewer.app.renderer.destroy()
  }
})

test("base lookup failures are errors rather than missing-base fallbacks", async () => {
  const viewer = await renderDiffViewer([], {
    height: 30,
    baseResponse: async () => json({ message: "base failed" }, { status: 503 }),
  })
  try {
    expect(viewer.app.captureCharFrame()).toContain("Could not load diff")
    expect(viewer.app.captureCharFrame()).not.toContain("No changes to show")
    expect(viewer.app.captureCharFrame()).not.toContain("showing uncommitted")
    expect(viewer.diffRequests).toHaveLength(0)
    await chooseSource(viewer, 2)
    await viewer.app.waitForFrame((frame) => frame.includes("No changes to show"))
    expect(viewer.vcsDiffInput()).toMatchObject({ mode: "working" })
  } finally {
    viewer.app.renderer.destroy()
  }
})

test.each([undefined, "Binary files a/assets/preview.png and b/assets/preview.png differ"])(
  "committed images never read the working-tree image (patch: %s)",
  async (patch) => {
    const viewer = await renderDiffViewer(
      [{ file: "assets/preview.png", status: "modified", additions: 0, deletions: 0, patch }],
      { source: "committed" },
    )
    try {
      expect(viewer.app.captureCharFrame()).toContain("Committed image preview unavailable")
      expect(viewer.imageReadInput()).toBeUndefined()
      expect(viewer.app.captureCharFrame()).not.toContain("Working tree preview")
    } finally {
      viewer.app.renderer.destroy()
    }
  },
)

async function chooseSource(viewer: Awaited<ReturnType<typeof renderDiffViewer>>, index: number, key = "d") {
  viewer.app.mockInput.pressKey(key)
  await viewer.app.waitForFrame((frame) => /Diff source\s+esc/.test(frame))
  viewer.app.mockInput.pressKey("HOME")
  await viewer.app.flush()
  for (let i = 0; i < index; i++) {
    viewer.app.mockInput.pressArrow("down")
    await viewer.app.flush()
  }
  viewer.app.mockInput.pressEnter()
  await viewer.app.waitForFrame((frame) => !/Diff source\s+esc/.test(frame))
}

test("brackets navigate diff hunks", async () => {
  const viewer = await renderDiffViewer(hunkDiff, { height: 12 })
  try {
    await viewer.app.waitForFrame((frame) => frame.includes("const first"))
    await viewer.app.waitFor(() => Boolean(findScrollBox(viewer.app.renderer.root)))
    await viewer.app.flush()
    expect(findDiffs(viewer.app.renderer.root)).toHaveLength(3)
    const scroll = findScrollBox(viewer.app.renderer.root)!
    const initial = scroll.scrollTop

    viewer.app.mockInput.pressKey("]")
    await viewer.app.renderOnce()
    const first = scroll.scrollTop
    expect(first).toBeGreaterThan(initial)
    expect(findDiffs(viewer.app.renderer.root)[1].y).toBeGreaterThanOrEqual(scroll.viewport.y + 2)

    viewer.app.mockInput.pressKey("]")
    await viewer.app.renderOnce()
    const second = scroll.scrollTop
    expect(second).toBeGreaterThan(first)
    expect(findDiffs(viewer.app.renderer.root)[2].y).toBeGreaterThanOrEqual(scroll.viewport.y + 2)

    viewer.app.mockInput.pressKey("[")
    await viewer.app.renderOnce()
    expect(scroll.scrollTop).toBe(first)

    viewer.app.mockInput.pressKey("]")
    await viewer.app.renderOnce()
    expect(scroll.scrollTop).toBe(second)

    scroll.scrollTo(initial)
    viewer.app.mockInput.pressKey("]")
    await viewer.app.renderOnce()
    expect(scroll.scrollTop).toBe(first)
  } finally {
    viewer.app.renderer.destroy()
  }
})

test("disabled diff keybinds have no component fallbacks", async () => {
  const viewer = await renderDiffViewer(hunkDiff, {
    height: 12,
    keybinds: disabledDiffKeybinds,
  })
  try {
    await viewer.app.waitForFrame((frame) => frame.includes("const first"))
    await viewer.app.waitFor(() => Boolean(findScrollBox(viewer.app.renderer.root)))
    await viewer.app.flush()
    const scroll = findScrollBox(viewer.app.renderer.root)!
    const initial = scroll.scrollTop

    Object.keys(disabledDiffKeybinds).forEach((command) => expect(viewer.shortcut(command)).toBe(""))

    viewer.app.mockInput.pressKey("j")
    await viewer.app.renderOnce()

    expect(scroll.scrollTop).toBe(initial)
  } finally {
    viewer.app.renderer.destroy()
  }
})

test.each(["added", "deleted"] as const)("%s files use full width even in split view", async (status) => {
  const viewer = await renderDiffViewer(
    [
      {
        file: "src/new.txt",
        status,
        additions: status === "added" ? 1 : 0,
        deletions: status === "deleted" ? 1 : 0,
        patch:
          status === "added"
            ? "--- /dev/null\n+++ b/src/new.txt\n@@ -0,0 +1 @@\n+full width content\n"
            : "--- a/src/new.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-full width content\n",
      },
    ],
    { width: 160 },
  )
  try {
    await viewer.app.waitForFrame((frame) => frame.includes("full width content"))
    const diffs = findDiffs(viewer.app.renderer.root)
    expect(diffs).toHaveLength(1)
    expect(diffs[0].view).toBe("unified")
    expect(viewer.app.captureCharFrame()).not.toMatch(/[├└┌┐┬┴─]/)
  } finally {
    viewer.app.renderer.destroy()
  }
})

test.each([80, 160])("adapts navigation and modified patches at %i columns", async (width) => {
  const viewer = await renderDiffViewer(hunkDiff, { width })
  try {
    await viewer.app.waitForFrame((frame) => frame.includes("const first"))
    expect(findDiffs(viewer.app.renderer.root)[0].view).toBe(width === 80 ? "unified" : "split")
    expect(viewer.app.captureCharFrame()).toContain("0/1")
  } finally {
    viewer.app.renderer.destroy()
  }
})

test("the first file title sits below full-height top padding with a blank row below", async () => {
  const viewer = await renderDiffViewer(hunkDiff)
  try {
    await viewer.app.waitForFrame((frame) => frame.includes("const first"))
    const lines = viewer.app.captureCharFrame().split("\n")
    const title = lines.findIndex((line) => line.includes("src/file.txt"))
    expect(title).toBeGreaterThan(0)
    const padding = viewer.app.captureSpans().lines[title - 1].spans.find((span) => span.width > 2)!
    expect(lines[title - 1].trim()).toBe("")
    expect(padding.bg).toEqual(
      viewer.app.captureSpans().lines[title].spans.find((span) => span.text.includes("src/"))!.bg,
    )
    expect(lines[title + 1].trim()).toBe("")
    expect(lines[title + 2]).toContain("const first")
    expect(lines[title]).toMatch(/\+3\s+-3/)
  } finally {
    viewer.app.renderer.destroy()
  }
})

test.each([100, 160])("shared pane edges align headings and stay fixed at %i columns", async (width) => {
  const viewer = await renderDiffViewer(manyDiffs.slice(0, 6), { width, height: 40 })
  try {
    await viewer.app.waitForFrame((frame) => frame.includes("const first"))
    await viewer.app.flush()
    const lines = viewer.app.captureCharFrame().split("\n")
    const title = lines.findIndex((line) => line.includes("file00.txt"))
    expect(lines.findIndex((line) => line.includes("All"))).toBe(title)
    const frame = viewer.app.captureSpans()
    const caps = frame.lines[title - 1].spans.filter((span) => span.width > 2)
    expect(caps).toHaveLength(2)
    caps.forEach((span) => expect(span.text.trim()).toBe(""))
    expect(caps[0].bg).toEqual(frame.lines[title].spans.find((span) => span.text.includes("All"))!.bg)
    expect(caps[1].bg).toEqual(frame.lines[title].spans.find((span) => span.text.includes("file00.txt"))!.bg)
    expect(title).toBe(1)
    expect(viewer.app.captureCharFrame()).not.toContain("Diff working tree")
    expect(lines[title + 1].slice(lines[title].indexOf("file00.txt")).trim()).toBe("")
    expect(lines[title + 2]).toContain("const first")

    const scroll = findScrollBox(viewer.app.renderer.root)!
    scroll.scrollTo(5)
    await viewer.app.flush()
    expect(viewer.app.captureCharFrame().split("\n")[title - 1]).toBe(lines[title - 1])
    expect(viewer.app.captureCharFrame().split("\n")[title]).toContain("file00.txt")

    viewer.commands.get("diff.next_file")!.run()
    await viewer.app.flush()
    expect(viewer.app.captureCharFrame().split("\n")[title - 1]).toBe(lines[title - 1])
    expect(viewer.app.captureCharFrame().split("\n")[title]).toContain("file01.txt")
    viewer.commands.get("diff.single_patch")!.run()
    await viewer.app.flush()
    expect(viewer.app.captureCharFrame().split("\n")[title]).toContain("file01.txt")

    viewer.app.resize(80, 30)
    await viewer.app.flush()
    expect(viewer.app.renderer.root.findDescendantById("diff-tree-top-edge")).toBeUndefined()
    expect(viewer.app.renderer.root.findDescendantById("diff-patch-top-edge")).toBeDefined()
    expect(viewer.app.captureCharFrame().split("\n")[title + 1]).toContain("file01.txt")
  } finally {
    viewer.app.renderer.destroy()
  }
})

test.each(["dark", "light"] as const)("the pane edge matches the visible reviewed card in %s mode", async (mode) => {
  const viewer = await renderDiffViewer(
    Array.from({ length: 4 }, (_, index) => ({ ...hunkDiff[0], file: `src/file${index}.txt` })),
    { width: 160, height: 18, mode },
  )
  try {
    await viewer.app.waitForFrame((frame) => frame.includes("const first"))
    await viewer.app.flush()
    const scroll = findScrollBox(viewer.app.renderer.root)!
    const expectEdge = (file: string, collapsed = false) => {
      const frame = viewer.app.captureSpans()
      const edge = frame.lines[scroll.viewport.y - 1].spans.find((span) => span.width === scroll.viewport.width)!
      const page = frame.lines[scroll.viewport.y - 1].spans.at(-1)!.bg
      const title = frame.lines[scroll.viewport.y].spans.find((span) => span.text.includes(file))!
      expect(title, viewer.app.captureCharFrame()).toBeDefined()
      expect(edge.text.trim()).toBe("")
      expect(edge.bg).toEqual(title.bg)
      expect(edge.bg).not.toEqual(page)
      expect(frame.lines[0].spans[0].bg).toEqual(frame.lines[1].spans.find((span) => span.text.includes("All"))!.bg)
      const bottom = frame.lines[scroll.viewport.y + 1].spans.findLast((span) => span.text.includes("▀"))
      if (!collapsed) {
        expect(bottom).toBeUndefined()
        return
      }
      expect(bottom?.text.trim()).toBe("▀".repeat(scroll.viewport.width))
      expect(bottom?.fg).toEqual(edge.bg)
      expect(bottom?.bg).toEqual(page)
    }
    expectEdge("file0.txt")
    viewer.app.mockInput.pressKey("m")
    await viewer.app.flush()
    expectEdge("file0.txt", true)
    viewer.app.mockInput.pressKey("n")
    await viewer.app.flush()
    expectEdge("file1.txt")
    viewer.app.mockInput.pressKey("m")
    await viewer.app.flush()
    expectEdge("file1.txt", true)
    viewer.app.mockInput.pressKey("n")
    await viewer.app.flush()
    expectEdge("file2.txt")

    // Scrolling back must follow the visible card, not the selected unreviewed file.
    scroll.scrollTo(0)
    await viewer.app.flush()
    expectEdge("file0.txt", true)
    const second = viewer.app.renderer.root.findDescendantById("diff-file-header-1")!
    const frame = viewer.app.captureSpans()
    expect(frame.lines[second.y - 1].spans.findLast((span) => span.text.includes("▄"))!.fg).toEqual(
      frame.lines[second.y].spans.find((span) => span.text.includes("file1.txt"))!.bg,
    )

    viewer.commands.get("diff.single_patch")!.run()
    await viewer.app.flush()
    expectEdge("file0.txt", true)
    viewer.app.mockInput.pressKey("m")
    await viewer.app.waitForFrame((frame) => frame.includes("const first"))
    await viewer.app.flush()
    expectEdge("file0.txt")
  } finally {
    viewer.app.renderer.destroy()
  }
})

test("the sidebar holds a compact help hint and the patch pane reaches the screen bottom", async () => {
  const viewer = await renderDiffViewer(hunkDiff, { width: 160, height: 40, kittyKeyboard: true })
  try {
    await viewer.app.waitForFrame((frame) => frame.includes("const first"))
    await viewer.app.flush()
    const scroll = findScrollBox(viewer.app.renderer.root)!
    const hint = viewer.app.renderer.root.findDescendantById("diff-help-shortcut")!
    expect(scroll.viewport.y + scroll.viewport.height).toBe(40)
    expect(hint.x).toBe(2)
    expect(hint.y).toBe(37)
    expect(
      findScrollBox(viewer.app.renderer.root, false)!.parent!.y +
        findScrollBox(viewer.app.renderer.root, false)!.parent!.height,
    ).toBe(40)
    expect(viewer.app.captureCharFrame()).not.toContain("n/p files")
    expect(viewer.app.captureCharFrame()).not.toContain("tab focus")
    expect(viewer.app.captureCharFrame()).toContain("? help")
    expect(viewer.app.captureCharFrame()).not.toContain("next file")
    expect(viewer.app.captureCharFrame()).not.toContain("next hunk")
    expect(viewer.app.captureCharFrame()).not.toContain("half page")
    viewer.app.mockInput.pressTab()
    await viewer.app.renderOnce()
    expect(viewer.app.captureCharFrame()).toContain("? help")

    viewer.app.mockInput.pressKey("?")
    await viewer.app.waitForFrame((frame) => frame.includes("Diff shortcuts"))
    expect(viewer.app.captureCharFrame()).toContain("Next file")
    expect(viewer.app.captureCharFrame()).toContain("Half page")
    expect(viewer.app.captureCharFrame()).toContain("Split / unified")
    expect(viewer.app.captureCharFrame()).toContain("alt+↓")
    expect(viewer.app.captureCharFrame()).toContain("Review + collapse / reopen")
    expect(viewer.app.captureCharFrame()).toContain("right-click")
    expect(viewer.app.captureCharFrame()).not.toContain("Focus files")
    expect(viewer.app.captureCharFrame()).not.toContain("Description")
    viewer.app.mockInput.pressEscape()
    await viewer.app.waitForFrame((frame) => !frame.includes("Diff shortcuts"))
    expect(viewer.current()).toEqual(expect.objectContaining({ type: "plugin", name: "diff" }))
  } finally {
    viewer.app.renderer.destroy()
  }
})

test("compact gutter help leaves the full patch viewport available when the sidebar is hidden", async () => {
  const viewer = await renderDiffViewer(hunkDiff, { width: 160, height: 24, kittyKeyboard: true })
  try {
    await viewer.app.waitForFrame((frame) => frame.includes("const first"))
    viewer.app.mockInput.pressKey("b")
    await viewer.app.flush()
    const scroll = findScrollBox(viewer.app.renderer.root)!
    const hint = viewer.app.renderer.root.findDescendantById("diff-help-shortcut")!
    expect(hint.y).toBe(0)
    expect(hint.x).toBe(159)
    expect(scroll.viewport.y).toBe(2)
    expect(scroll.viewport.y + scroll.viewport.height).toBe(24)
    await viewer.app.mockMouse.click(hint.x, hint.y)
    await viewer.app.waitForFrame((frame) => frame.includes("Diff shortcuts"))
    expect(viewer.app.renderer.getSelection()).toBeNull()
    viewer.app.mockInput.pressEscape()
    await viewer.app.waitForFrame((frame) => !frame.includes("Diff shortcuts"))

    viewer.app.mockInput.pressKey("b")
    await viewer.app.flush()
    expect(viewer.app.renderer.root.findDescendantById("diff-help-shortcut")!.y).toBe(21)
    viewer.app.resize(80, 24)
    await viewer.app.flush()
    expect(viewer.app.renderer.root.findDescendantById("diff-help-shortcut")!.y).toBe(0)
    expect(viewer.app.renderer.root.findDescendantById("diff-help-shortcut")!.x).toBe(79)
    expect(scroll.viewport.y + scroll.viewport.height).toBe(24)
    expect(viewer.app.captureCharFrame()).not.toContain("? help")
    expect(viewer.app.captureCharFrame().split("\n")[0].at(-1)).toBe("?")
    viewer.app.mockInput.pressKey("d")
    await viewer.app.waitForFrame((frame) => frame.includes("Diff source"))
    viewer.app.mockInput.pressEscape()
    await viewer.app.waitForFrame((frame) => !frame.includes("Diff source"))
  } finally {
    viewer.app.renderer.destroy()
  }
})

test("compact help scrolls at a narrow size and reflects customized bindings", async () => {
  const viewer = await renderDiffViewer(hunkDiff, {
    width: 50,
    height: 20,
    kittyKeyboard: true,
    keybinds: { "diff.next_file": "ctrl+n", "diff.previous_file": "ctrl+p", "diff.close": "x" },
  })
  try {
    await viewer.app.waitForFrame((frame) => frame.includes("const first"))
    viewer.app.mockInput.pressKey("?")
    await viewer.app.waitForFrame((frame) => frame.includes("Diff shortcuts"))
    const scroll = viewer.app.renderer.root.findDescendantById("diff-help-scroll")
    if (!(scroll instanceof ScrollBoxRenderable)) throw new Error("Missing help scrollbox")
    expect(scroll.width).toBeLessThanOrEqual(46)
    expect(viewer.app.captureCharFrame()).toMatch(/ctrl\+n\s+Next file/)
    expect(viewer.app.captureCharFrame()).not.toContain("alt+↓")
    scroll.scrollTo(scroll.scrollHeight)
    await viewer.app.flush()
    expect(viewer.app.captureCharFrame()).toContain("Show / hide file tree")
    expect(viewer.app.captureCharFrame()).not.toContain("Focus files")
    expect(viewer.app.captureCharFrame()).toMatch(/x\s+Close diff viewer/)
    viewer.app.mockInput.pressEscape()
    await viewer.app.waitForFrame((frame) => !frame.includes("Diff shortcuts"))
    expect(viewer.current()).toEqual(expect.objectContaining({ type: "plugin", name: "diff" }))
  } finally {
    viewer.app.renderer.destroy()
  }
})

test.each([
  { key: "?", shift: false },
  { key: "?", shift: true },
  { key: "/", shift: true },
])("the viewer opens help from $key with shift=$shift", async (input) => {
  const viewer = await renderDiffViewer(hunkDiff, { width: 160, height: 40, kittyKeyboard: true })
  try {
    await viewer.app.waitForFrame((frame) => frame.includes("const first") && frame.includes("? help"))
    viewer.app.mockInput.pressKey(input.key, { shift: input.shift })
    await viewer.app.waitForFrame((frame) => frame.includes("Diff shortcuts"))
    expect(viewer.app.captureCharFrame()).toContain("Next file")
    viewer.app.mockInput.pressEscape()
    await viewer.app.waitForFrame((frame) => !frame.includes("Diff shortcuts"))
    expect(viewer.app.captureCharFrame()).toContain("const first")
  } finally {
    viewer.app.renderer.destroy()
  }
})

test.each([80, 160])("file titles stick to the viewport and hand off while scrolling at %i columns", async (width) => {
  const viewer = await renderDiffViewer(
    Array.from({ length: 4 }, (_, index) => ({ ...hunkDiff[0], file: `src/file${index}.txt` })),
    { width, height: 18 },
  )
  try {
    await viewer.app.waitForFrame((frame) => frame.includes("const first"))
    await viewer.app.flush()
    const scroll = findScrollBox(viewer.app.renderer.root)!
    const first = viewer.app.renderer.root.findDescendantById("diff-file-header-0")
    const second = viewer.app.renderer.root.findDescendantById("diff-file-header-1")
    if (!(first instanceof BoxRenderable) || !(second instanceof BoxRenderable)) throw new Error("Missing file titles")
    const next = second.y - scroll.content.y

    scroll.scrollTo(5)
    await viewer.app.flush()
    expect(first.y).toBe(scroll.viewport.y)
    expect(viewer.app.captureCharFrame().split("src/file0.txt")).toHaveLength(2)

    viewer.app.resize(width === 160 ? 80 : 160, 22)
    await viewer.app.flush()
    expect(first.y).toBe(scroll.viewport.y)
    viewer.app.resize(width, 18)
    await viewer.app.flush()
    expect(first.y).toBe(scroll.viewport.y)

    if (width === 160) {
      viewer.app.mockInput.pressTab()
      await viewer.app.renderOnce()
      expect(first.y).toBe(scroll.viewport.y)
      expect(viewer.app.captureCharFrame()).toContain("src/file0.txt")
      viewer.app.mockInput.pressTab()
    }

    scroll.scrollTo(next + 3)
    await viewer.app.flush()
    expect(second.y).toBe(scroll.viewport.y)
    expect(first.y + first.height).toBeLessThanOrEqual(scroll.viewport.y)
    expect(viewer.app.captureCharFrame().split("src/file1.txt")).toHaveLength(2)
    expect(viewer.app.captureCharFrame()).not.toContain("src/file0.txt")

    const background = second.backgroundColor
    viewer.commands.get("diff.mark_reviewed")!.run()
    await viewer.app.flush()
    expect(second.backgroundColor).not.toEqual(background)
    expect(second.y).toBe(scroll.viewport.y)

    scroll.scrollTo(0)
    await viewer.app.flush()
    expect(first.translateY).toBe(0)
    expect(first.y).toBe(scroll.viewport.y)

    viewer.commands.get("diff.single_patch")!.run()
    await viewer.app.flush()
    expect(viewer.app.renderer.root.findDescendantById("diff-file-header-1")).toBeUndefined()
    const single = viewer.app.renderer.root.findDescendantById("diff-file-header-0")
    if (!(single instanceof BoxRenderable)) throw new Error("Missing single file title")
    scroll.scrollTo(5)
    await viewer.app.flush()
    expect(single.y).toBe(scroll.viewport.y)
  } finally {
    viewer.app.renderer.destroy()
  }
})

test("split diff filler keeps the full card background", async () => {
  const viewer = await renderDiffViewer(
    [
      {
        file: ".gitignore",
        status: "modified",
        additions: 1,
        deletions: 0,
        patch: "--- a/.gitignore\n+++ b/.gitignore\n@@ -1 +1,2 @@\n node_modules/\n+artifacts/\n",
      },
    ],
    { width: 160 },
  )
  try {
    await viewer.app.waitForFrame((frame) => frame.includes("artifacts/"))
    const diff = findDiffs(viewer.app.renderer.root)[0]
    const frame = viewer.app.captureSpans()
    const backgrounds = (row: number) =>
      frame.lines[row].spans.flatMap((span) => Array.from({ length: span.width }, () => span.bg))
    expect(backgrounds(diff.y + 1).slice(diff.x, diff.x + Math.floor(diff.width / 2))).toEqual(
      Array.from({ length: Math.floor(diff.width / 2) }, () => backgrounds(diff.y - 1)[diff.x]),
    )
  } finally {
    viewer.app.renderer.destroy()
  }
})

test.each(["patch", "image", "fallback"] as const)(
  "reviewing collapses a %s body and unmarking reopens it",
  async (kind) => {
    const file =
      kind === "patch"
        ? hunkDiff[0]
        : {
            file: kind === "image" ? "assets/preview.png" : "bun.lock",
            status: "modified",
            additions: 0,
            deletions: 0,
          }
    const content = kind === "patch" ? "const first" : kind === "image" ? "96 x 48" : "No patch available"
    const viewer = await renderDiffViewer([file], { width: 80, height: kind === "patch" ? 16 : 24 })
    try {
      await viewer.app.waitForFrame((frame) => frame.includes(content))
      const scroll = findScrollBox(viewer.app.renderer.root)!
      if (kind === "patch") {
        scroll.scrollTo(4)
        await viewer.app.flush()
        expect(scroll.scrollTop).toBeGreaterThan(0)
      }
      viewer.app.mockInput.pressKey("m")
      await viewer.app.flush()
      const header = viewer.app.renderer.root.findDescendantById("diff-file-header-0")
      if (!(header instanceof BoxRenderable)) throw new Error("Missing reviewed file title")
      expect(header.parent?.height).toBe(header.height)
      expect(header.height).toBe(2)
      expect(viewer.app.captureCharFrame().split("\n")[header.y + 1].trim()).toBe("▀".repeat(header.width))
      expect(header.y).toBe(scroll.viewport.y)
      expect(viewer.app.captureCharFrame()).toContain(file.file)
      expect(viewer.app.captureCharFrame()).toContain("✓")
      expect(viewer.app.captureCharFrame()).not.toContain(content)
      expect(findDiffs(viewer.app.renderer.root)).toHaveLength(0)

      viewer.app.mockInput.pressKey("m")
      await viewer.app.waitForFrame((frame) => frame.includes(content))
      await viewer.app.flush()
      expect(header.parent!.height).toBeGreaterThan(header.height)
      expect(viewer.app.captureCharFrame().split("\n")[header.y + 1].trim()).toBe("")
      expect(viewer.app.captureCharFrame()).not.toContain("✓")
      if (kind === "patch") {
        viewer.app.mockInput.pressKey("]")
        await viewer.app.flush()
        expect(scroll.scrollTop).toBeGreaterThan(0)
      }
    } finally {
      viewer.app.renderer.destroy()
    }
  },
)

test("reviewing after scrolling targets the visible file rather than the initial file", async () => {
  const viewer = await renderDiffViewer(
    [
      { ...hunkDiff[0], file: "src/file0.txt" },
      { ...hunkDiff[0], file: "src/file1.txt" },
    ],
    { width: 160, height: 16 },
  )
  try {
    await viewer.app.waitForFrame((frame) => frame.includes("const first"))
    await viewer.app.flush()
    const scroll = findScrollBox(viewer.app.renderer.root)!
    scroll.scrollTo(scroll.scrollTop + findDiffs(viewer.app.renderer.root)[3].y - scroll.viewport.y)
    await viewer.app.renderOnce()
    viewer.commands.get("diff.mark_reviewed")!.run()
    await viewer.app.waitForFrame((frame) => /file1\.txt\s+✓/.test(frame))
    expect(viewer.app.captureCharFrame()).not.toMatch(/file0\.txt\s+✓/)
  } finally {
    viewer.app.renderer.destroy()
  }
})

test.each([80, 160])(
  "single-file review advances, but reopening and the last file stay put at %i columns",
  async (width) => {
    const viewer = await renderDiffViewer(
      Array.from({ length: 3 }, (_, index) => ({ ...hunkDiff[0], file: `src/file${index}.txt` })),
      { width, height: 24, kittyKeyboard: true },
    )
    try {
      await viewer.app.waitForFrame((frame) => frame.includes("const first"))
      viewer.app.mockInput.pressKey("s")
      await viewer.app.flush()
      if (width === 160) viewer.app.mockInput.pressTab()
      viewer.app.mockInput.pressKey("m")
      await viewer.app.flush()
      expect(viewer.app.renderer.root.findDescendantById("diff-file-header-0")).toBeUndefined()
      expect(viewer.app.renderer.root.findDescendantById("diff-file-header-1")).toBeDefined()
      expect(viewer.app.captureCharFrame()).toContain("const first")

      viewer.app.mockInput.pressKey("p")
      await viewer.app.flush()
      expect(findDiffs(viewer.app.renderer.root)).toHaveLength(0)
      viewer.app.mockInput.pressKey("m")
      await viewer.app.waitForFrame((frame) => frame.includes("const first"))
      expect(viewer.app.renderer.root.findDescendantById("diff-file-header-0")).toBeDefined()
      expect(viewer.app.renderer.root.findDescendantById("diff-file-header-1")).toBeUndefined()

      viewer.app.mockInput.pressKey("n")
      await viewer.app.flush()
      viewer.app.mockInput.pressKey("m")
      await viewer.app.flush()
      expect(viewer.app.renderer.root.findDescendantById("diff-file-header-2")).toBeDefined()
      viewer.app.mockInput.pressKey("m")
      await viewer.app.flush()
      expect(viewer.app.renderer.root.findDescendantById("diff-file-header-2")).toBeDefined()
      expect(viewer.app.renderer.root.findDescendantById("diff-file-header-0")).toBeUndefined()
      expect(findDiffs(viewer.app.renderer.root)).toHaveLength(0)

      viewer.app.mockInput.pressKey("?")
      await viewer.app.waitForFrame((frame) => frame.includes("Review + next / reopen"))
    } finally {
      viewer.app.renderer.destroy()
    }
  },
)

test.each([false, true])("Alt+arrows navigate files rather than session tabs (after Tab: %s)", async (afterTab) => {
  let tabChanges = 0
  const viewer = await renderDiffViewer(manyDiffs, {
    width: 160,
    height: 24,
    kittyKeyboard: true,
    onSessionTab: () => tabChanges++,
  })
  try {
    await viewer.app.waitForFrame((frame) => frame.includes("const first"))
    await viewer.app.flush()
    const scroll = findScrollBox(viewer.app.renderer.root)!
    if (afterTab) viewer.app.mockInput.pressTab()
    viewer.app.mockInput.pressKey("down", { meta: true })
    await viewer.app.flush()
    expect(viewer.app.captureCharFrame().split("\n")[scroll.viewport.y]).toContain("file01.txt")
    viewer.app.mockInput.pressKey("up", { meta: true })
    await viewer.app.flush()
    expect(scroll.scrollTop).toBe(0)
    expect(tabChanges).toBe(0)
  } finally {
    viewer.app.renderer.destroy()
  }
})

test.each([
  { target: "tree", mode: "dark" },
  { target: "heading", mode: "dark" },
  { target: "tree", mode: "light" },
  { target: "heading", mode: "light" },
] as const)("the $target context menu completes the clicked file without selecting it in $mode mode", async (input) => {
  const viewer = await renderDiffViewer(manyDiffs.slice(0, 3), {
    width: 160,
    height: 40,
    kittyKeyboard: true,
    mode: input.mode,
  })
  try {
    await viewer.app.waitForFrame((frame) => frame.includes("const first"))
    await viewer.app.flush()
    const scroll = findScrollBox(viewer.app.renderer.root)!
    const node = () =>
      viewer.app.renderer.root.findDescendantById(input.target === "tree" ? "diff-file-row-1" : "diff-file-header-1")!
    await viewer.app.mockMouse.click(node().x + 4, node().y, MouseButton.RIGHT)
    await viewer.app.waitForFrame((frame) => frame.includes("Mark complete"))
    expect(scroll.scrollTop).toBe(0)
    expect(viewer.app.captureCharFrame()).toContain("0/3")
    viewer.app.mockInput.pressKey("n")
    viewer.app.mockInput.pressKey("m")
    await viewer.app.flush()
    expect(scroll.scrollTop).toBe(0)
    expect(viewer.app.captureCharFrame()).toContain("0/3")
    const menu = viewer.app.renderer.root.findDescendantById("diff-file-menu")!
    expect(
      viewer.app.captureSpans().lines[menu.y].spans.find((span) => span.text.includes("Mark complete"))!.bg,
    ).not.toEqual(viewer.app.captureSpans().lines[1].spans.find((span) => span.text.includes("All"))!.bg)
    await viewer.app.mockMouse.click(menu.x + 1, menu.y)
    await viewer.app.waitForFrame((frame) => frame.includes("1/3"))
    expect(viewer.app.captureCharFrame()).toMatch(/file01\.txt\s+✓/)
    expect(viewer.app.captureCharFrame()).not.toMatch(/file00\.txt\s+✓/)
    expect(viewer.app.renderer.root.findDescendantById("diff-file-menu")).toBeUndefined()
    expect(findDiffs(viewer.app.renderer.root)).toHaveLength(6)
    expect(scroll.scrollTop).toBe(0)

    await viewer.app.mockMouse.click(node().x + 4, node().y, MouseButton.RIGHT)
    await viewer.app.waitForFrame((frame) => frame.includes("Mark incomplete"))
    viewer.app.mockInput.pressEnter()
    await viewer.app.waitForFrame((frame) => frame.includes("0/3"))
    expect(findDiffs(viewer.app.renderer.root)).toHaveLength(9)
    expect(scroll.scrollTop).toBe(0)
  } finally {
    viewer.app.renderer.destroy()
  }
})

test.each(["escape", "outside"] as const)(
  "a clamped file menu dismisses with %s without closing the viewer",
  async (dismiss) => {
    const viewer = await renderDiffViewer(hunkDiff, { width: 80, height: 16, kittyKeyboard: true })
    try {
      await viewer.app.waitForFrame((frame) => frame.includes("const first"))
      await viewer.app.flush()
      const header = viewer.app.renderer.root.findDescendantById("diff-file-header-0")!
      await viewer.app.mockMouse.click(header.x + header.width - 1, header.y, MouseButton.RIGHT)
      await viewer.app.waitForFrame((frame) => frame.includes("Mark complete"))
      const menu = viewer.app.renderer.root.findDescendantById("diff-file-menu")!
      expect(menu.x).toBeGreaterThanOrEqual(0)
      expect(menu.x + menu.width).toBeLessThanOrEqual(80)
      expect(menu.y + menu.height).toBeLessThanOrEqual(16)
      if (dismiss === "escape") viewer.app.mockInput.pressEscape()
      if (dismiss === "outside") await viewer.app.mockMouse.click(1, 1)
      await viewer.app.waitForFrame((frame) => !frame.includes("Mark complete"))
      expect(viewer.current()).toEqual(expect.objectContaining({ type: "plugin", name: "diff" }))
      expect(findDiffs(viewer.app.renderer.root)).toHaveLength(3)
      viewer.app.mockInput.pressKey("j")
      await viewer.app.flush()
      expect(findScrollBox(viewer.app.renderer.root)!.scrollTop).toBe(1)
    } finally {
      viewer.app.renderer.destroy()
    }
  },
)

test("single-file menu actions advance only when completing the current file", async () => {
  const viewer = await renderDiffViewer(manyDiffs.slice(0, 3), { width: 160, height: 24, kittyKeyboard: true })
  try {
    await viewer.app.waitForFrame((frame) => frame.includes("const first"))
    viewer.app.mockInput.pressKey("s")
    await viewer.app.flush()
    const other = viewer.app.renderer.root.findDescendantById("diff-file-row-2")!
    await viewer.app.mockMouse.click(other.x + 4, other.y, MouseButton.RIGHT)
    await viewer.app.waitForFrame((frame) => frame.includes("Mark complete"))
    viewer.app.mockInput.pressEnter()
    await viewer.app.waitForFrame((frame) => frame.includes("1/3"))
    expect(viewer.app.renderer.root.findDescendantById("diff-file-header-0")).toBeDefined()
    expect(viewer.app.renderer.root.findDescendantById("diff-file-header-2")).toBeUndefined()
    expect(viewer.app.captureCharFrame()).toMatch(/file02\.txt\s+✓/)
    const current = viewer.app.renderer.root.findDescendantById("diff-file-header-0")!
    await viewer.app.mockMouse.click(current.x + 4, current.y, MouseButton.RIGHT)
    await viewer.app.waitForFrame((frame) => frame.includes("Mark complete"))
    viewer.app.mockInput.pressEnter()
    await viewer.app.waitForFrame((frame) => frame.includes("2/3") && frame.includes("const first"))
    expect(viewer.app.renderer.root.findDescendantById("diff-file-header-0")).toBeUndefined()
    expect(viewer.app.renderer.root.findDescendantById("diff-file-header-1")).toBeDefined()
    expect(viewer.app.captureCharFrame()).toContain("const first")
  } finally {
    viewer.app.renderer.destroy()
  }
})

test("image previews use the diff session's filesystem location", async () => {
  const viewer = await renderDiffViewer([
    { file: "assets/mock image.png", status: "modified", additions: 0, deletions: 0 },
  ])
  try {
    await viewer.app.waitFor(() => viewer.imageReadInput() !== undefined)
    expect(viewer.imageReadInput()).toEqual({ path: "assets/mock image.png", location: { directory: "/repo/session" } })
    await viewer.app.waitForFrame((frame) => frame.includes("96 x 48"))
    const lines = viewer.app.captureCharFrame().split("\n")
    const row = lines.findIndex((line) => line.includes("Working tree preview"))
    const top = lines[lines.findIndex((line) => line.includes("assets/mock image.png")) - 1]
    const header = viewer.app.renderer.root.findDescendantById("diff-file-header-0")!
    const background = viewer.app.captureSpans().lines[row].spans.find((span) => span.text.includes("Working tree"))!.bg
    const edges = viewer.app
      .captureSpans()
      .lines[row + 2].spans.flatMap((span) => Array.from({ length: span.width }, () => span.bg))
    expect(top.trim()).toBe("")
    expect(edges[header.x]).toEqual(background)
    expect(edges[header.x + header.width - 1]).toEqual(background)
  } finally {
    viewer.app.renderer.destroy()
  }
})

test("single-file images load once per file and cancel reads when their preview is removed", async () => {
  const reads: { file: string; signal: AbortSignal }[] = []
  const viewer = await renderDiffViewer(
    ["a.png", "b.png"].map((file) => ({ file, status: "modified", additions: 0, deletions: 0 })),
    {
      single: true,
      readImage: async (file, signal) => {
        reads.push({ file, signal })
        return diffImageFixture
      },
    },
  )
  try {
    await viewer.app.waitForFrame((frame) => frame.includes("96 x 48"))
    expect(reads.map((read) => read.file)).toEqual(["a.png"])
    viewer.app.mockInput.pressKey("n")
    await viewer.app.waitForFrame((frame) => frame.includes("b.png") && frame.includes("96 x 48"))
    await viewer.app.flush()
    expect(reads.map((read) => read.file)).toEqual(["a.png", "b.png"])
    expect(reads[0].signal.aborted).toBe(true)
    viewer.app.mockInput.pressKey("j")
    await viewer.app.flush()
    expect(reads.map((read) => read.file)).toEqual(["a.png", "b.png"])
    viewer.app.mockInput.pressKey("m")
    await viewer.app.flush()
    expect(reads[1].signal.aborted).toBe(true)
  } finally {
    viewer.app.renderer.destroy()
  }
})

test("reviewing a mouse-scrolled past selection keeps the visible file in place", async () => {
  const viewer = await renderDiffViewer(manyDiffs.slice(0, 5), { width: 160, height: 24, kittyKeyboard: true })
  try {
    await viewer.app.waitForFrame((frame) => frame.includes("const first"))
    viewer.app.mockInput.pressKey("n")
    await viewer.app.flush()
    const scroll = findScrollBox(viewer.app.renderer.root)!
    const header = viewer.app.renderer.root.findDescendantById("diff-file-header-2")!
    scroll.scrollTo(scroll.scrollTop + header.y - scroll.viewport.y + 2)
    await viewer.app.flush()
    await viewer.app.mockMouse.scroll(scroll.x + 5, scroll.viewport.y + 5, "down")
    await viewer.app.flush()
    const before = scroll.scrollTop
    const row = viewer.app.renderer.root.findDescendantById("diff-file-row-1")!
    await viewer.app.mockMouse.click(row.x + 4, row.y, MouseButton.RIGHT)
    await viewer.app.waitForFrame((frame) => frame.includes("Mark complete"))
    viewer.app.mockInput.pressEnter()
    await viewer.app.flush()
    expect(viewer.app.captureCharFrame().split("\n")[scroll.viewport.y]).toContain("file02.txt")
    expect(scroll.scrollTop).toBeLessThan(before)
    viewer.app.mockInput.pressKey("m")
    await viewer.app.waitForFrame((frame) => /file02\.txt\s+✓/.test(frame))
  } finally {
    viewer.app.renderer.destroy()
  }
})

test.each(["patch", "image"] as const)(
  "completing and reopening an earlier %s preserves the reading position",
  async (kind) => {
    const pending = Promise.withResolvers<Uint8Array>()
    let reads = 0
    const viewer = await renderDiffViewer(
      [
        ...(kind === "image" ? [{ file: "a.png", status: "modified", additions: 0, deletions: 0 }] : []),
        ...manyDiffs.slice(0, 4),
      ],
      {
        width: 160,
        height: 24,
        kittyKeyboard: true,
        readImage: () => (++reads === 1 ? Promise.resolve(diffImageFixture) : pending.promise),
      },
    )
    try {
      await viewer.app.waitForFrame((frame) => frame.includes(kind === "image" ? "96 x 48" : "const first"))
      viewer.app.mockInput.pressKey("n")
      await viewer.app.flush()
      const scroll = findScrollBox(viewer.app.renderer.root)!
      scroll.scrollBy(4)
      await viewer.app.flush()
      const patchFrame = () =>
        viewer.app
          .captureCharFrame()
          .split("\n")
          .map((line) => line.slice(scroll.x))
          .join("\n")
      const before = patchFrame()
      const row = viewer.app.renderer.root.findDescendantById("diff-file-row-0")!
      for (const label of ["Mark complete", "Mark incomplete"]) {
        await viewer.app.mockMouse.click(row.x + 4, row.y, MouseButton.RIGHT)
        await viewer.app.waitForFrame((frame) => frame.includes(label))
        viewer.app.mockInput.pressEnter()
        await viewer.app.flush()
        expect(patchFrame()).toBe(before)
      }
      if (kind === "patch") return
      pending.resolve(diffImageFixture)
      await viewer.app.waitFor(() => {
        const image = viewer.app.renderer.root.findDescendantById("diff-image-a.png")
        return image instanceof ImageRenderable && image.image?.width === 96
      })
      await viewer.app.flush()
      expect(patchFrame()).toBe(before)
    } finally {
      pending.resolve(diffImageFixture)
      viewer.app.renderer.destroy()
    }
  },
)

test.each([
  { file: "bun.lock", status: "modified" as const, message: "No patch available for this file." },
  { file: "assets/old.png", status: "deleted" as const, message: "Deleted image." },
])("pads $file fallback messages inside the card without reading images", async (input) => {
  const viewer = await renderDiffViewer([{ file: input.file, status: input.status, additions: 0, deletions: 0 }])
  try {
    await viewer.app.waitForFrame((frame) => frame.includes(input.message))
    expect(viewer.imageReadInput()).toBeUndefined()
    const header = viewer.app.renderer.root.findDescendantById("diff-file-header-0")
    if (!(header instanceof BoxRenderable)) throw new Error("Missing file title")
    const lines = viewer.app.captureCharFrame().split("\n")
    const title = lines.findIndex((line) => line.includes(input.file))
    const row = lines.findIndex((line) => line.includes(input.message))
    expect(lines[row].indexOf(input.message)).toBe(lines[title].indexOf(input.file))
    expect(lines[row + 1].trim()).toBe("")
    const padding = viewer.app
      .captureSpans()
      .lines[row + 1].spans.flatMap((span) => Array.from({ length: span.width }, () => span.bg))
    expect(padding[header.x]).toEqual(header.backgroundColor)
    expect(padding[header.x + header.width - 1]).toEqual(header.backgroundColor)
  } finally {
    viewer.app.renderer.destroy()
  }
})

test("Ctrl+D and Ctrl+U scroll the patch viewport by half a page, without closing", async () => {
  const viewer = await renderDiffViewer(manyDiffs, { width: 160, height: 24 })
  try {
    await viewer.app.waitForFrame((frame) => frame.includes("const first"))
    await viewer.app.flush()
    const scroll = findScrollBox(viewer.app.renderer.root)!
    viewer.app.mockInput.pressKey("d", { ctrl: true })
    await viewer.app.renderOnce()
    expect(viewer.current().type).toBe("plugin")
    expect(scroll.scrollTop).toBe(Math.floor(scroll.viewport.height / 2))
    viewer.app.mockInput.pressKey("u", { ctrl: true })
    await viewer.app.renderOnce()
    expect(scroll.scrollTop).toBe(0)
    viewer.app.mockInput.pressKey("f", { ctrl: true })
    await viewer.app.renderOnce()
    expect(scroll.scrollTop).toBe(scroll.viewport.height)
    viewer.app.mockInput.pressKey("b", { ctrl: true })
    await viewer.app.renderOnce()
    expect(scroll.scrollTop).toBe(0)
  } finally {
    viewer.app.renderer.destroy()
  }
})

test.each([20, 32])("Tab and file clicks never redirect scrolling keys into the tree at %i rows", async (height) => {
  const viewer = await renderDiffViewer(manyDiffs, { width: 160, height, keybinds: { "diff.switch_focus": "tab" } })
  try {
    await viewer.app.waitForFrame((frame) => frame.includes("const first"))
    await viewer.app.flush()
    const scroll = findScrollBox(viewer.app.renderer.root)!
    const tree = findScrollBox(viewer.app.renderer.root, false)!
    const row = viewer.app.renderer.root.findDescendantById("diff-file-row-0")!
    expect(viewer.commands.has("diff.switch_focus")).toBe(false)
    await viewer.app.mockMouse.click(row.x + 4, row.y)
    viewer.app.mockInput.pressTab()
    viewer.app.mockInput.pressKey("j")
    await viewer.app.renderOnce()
    expect(scroll.scrollTop).toBe(1)
    expect(tree.scrollTop).toBe(0)
    viewer.app.mockInput.pressKey("k")
    await viewer.app.renderOnce()
    expect(scroll.scrollTop).toBe(0)
    viewer.app.mockInput.pressArrow("down")
    await viewer.app.renderOnce()
    expect(scroll.scrollTop).toBe(1)
    viewer.app.mockInput.pressArrow("up")
    await viewer.app.renderOnce()
    expect(scroll.scrollTop).toBe(0)
    viewer.app.mockInput.pressKey("d", { ctrl: true })
    await viewer.app.renderOnce()
    const half = Math.floor(scroll.viewport.height / 2)
    expect(viewer.current().type).toBe("plugin")
    expect(scroll.scrollTop).toBe(half)
    expect(tree.scrollTop).toBe(0)
    viewer.app.mockInput.pressKey("u", { ctrl: true })
    await viewer.app.renderOnce()
    expect(scroll.scrollTop).toBe(0)
    viewer.app.mockInput.pressKey("f", { ctrl: true })
    await viewer.app.renderOnce()
    expect(scroll.scrollTop).toBe(scroll.viewport.height)
    expect(tree.scrollTop).toBe(0)
  } finally {
    viewer.app.renderer.destroy()
  }
})

test("folders are mouse controlled and n/p reveal files inside collapsed folders", async () => {
  const viewer = await renderDiffViewer(
    [
      { ...hunkDiff[0], file: "src/a/first.txt" },
      { ...hunkDiff[0], file: "src/b/second.txt" },
      { ...hunkDiff[0], file: "test/third.txt" },
    ],
    { width: 160, height: 28 },
  )
  try {
    await viewer.app.waitForFrame((frame) => frame.includes("const first"))
    await viewer.app.flush()
    const treeFrame = () =>
      viewer.app
        .captureCharFrame()
        .split("\n")
        .map((line) => line.slice(0, 40))
        .join("\n")
    const folder = viewer.app.renderer.root.findDescendantById("diff-folder-row-0")!
    await viewer.app.mockMouse.click(folder.x + 1, folder.y, MouseButton.RIGHT)
    expect(viewer.app.renderer.root.findDescendantById("diff-file-menu")).toBeUndefined()
    expect(treeFrame()).toContain("first.txt")
    await viewer.app.mockMouse.click(folder.x + 1, folder.y)
    await viewer.app.renderOnce()
    expect(treeFrame()).toContain("▸ src")
    expect(treeFrame()).not.toContain("first.txt")
    viewer.app.mockInput.pressTab()
    viewer.app.mockInput.pressKey("l")
    viewer.app.mockInput.pressKey("}")
    viewer.app.mockInput.pressKey("h")
    await viewer.app.renderOnce()
    expect(treeFrame()).toContain("▸ src")
    viewer.app.mockInput.pressKey("n")
    await viewer.app.flush()
    expect(treeFrame()).toContain("▾ src")
    expect(treeFrame()).toContain("second.txt")
    const scroll = findScrollBox(viewer.app.renderer.root)!
    expect(viewer.app.captureCharFrame().split("\n")[scroll.viewport.y]).toContain("src/b/second.txt")
    viewer.app.mockInput.pressKey("p")
    await viewer.app.flush()
    expect(scroll.scrollTop).toBe(0)
  } finally {
    viewer.app.renderer.destroy()
  }
})

test("n/p jump between files and gg/G always navigate the diff", async () => {
  const viewer = await renderDiffViewer(manyDiffs, { width: 160, height: 24 })
  try {
    await viewer.app.waitForFrame((frame) => frame.includes("const first"))
    await viewer.app.flush()
    const scroll = findScrollBox(viewer.app.renderer.root)!
    const row = viewer.app.renderer.root.findDescendantById("diff-file-row-0")!
    viewer.app.mockInput.pressKey("n")
    await viewer.app.flush()
    expect(viewer.app.renderer.root.findDescendantById("diff-file-row-0")).toBe(row)
    expect(scroll.scrollTop).toBeGreaterThan(0)
    expect(viewer.app.captureCharFrame()).toContain("file01.txt")
    viewer.app.mockInput.pressKey("p")
    await viewer.app.flush()
    expect(viewer.app.renderer.root.findDescendantById("diff-file-row-0")).toBe(row)
    expect(scroll.scrollTop).toBe(0)
    viewer.app.mockInput.pressKey("G")
    await viewer.app.renderOnce()
    expect(scroll.scrollTop).toBe(scroll.scrollHeight - scroll.viewport.height)
    viewer.app.mockInput.pressKey("g")
    viewer.app.mockInput.pressKey("g")
    await viewer.app.renderOnce()
    expect(scroll.scrollTop).toBe(0)
    viewer.app.mockInput.pressTab()
    viewer.app.mockInput.pressKey("G")
    await viewer.app.renderOnce()
    expect(scroll.scrollTop).toBe(scroll.scrollHeight - scroll.viewport.height)
    expect(findScrollBox(viewer.app.renderer.root, false)!.scrollTop).toBe(0)
    viewer.app.mockInput.pressKey("g")
    viewer.app.mockInput.pressKey("g")
    viewer.app.mockInput.pressKey("m")
    await viewer.app.waitForFrame((frame) => /file00\.txt\s+✓/.test(frame))
  } finally {
    viewer.app.renderer.destroy()
  }
})

async function renderDiffViewer(
  vcsDiff: unknown[],
  options: {
    width?: number
    height?: number
    initialRoute?: Route
    fail?: boolean
    mode?: "dark" | "light"
    single?: boolean
    readImage?: (file: string, signal: AbortSignal) => Promise<Uint8Array>
    onSessionTab?: () => void
    keybinds?: TuiKeybind.KeybindOverrides
    kittyKeyboard?: boolean
    source?: "branch" | "committed" | "working"
    base?: typeof baseFixture | null
    open?: boolean
    pending?: boolean
    baseResponse?: () => Promise<Response>
    diffResponse?: (url: URL) => Promise<Response>
    branchesResponse?: (url: URL) => Promise<Response>
    state?: string
  } = {},
) {
  const commands = new Map<string, KeymapCommand>()
  const [current, setCurrent] = createSignal<Route>(options.initialRoute ?? startRoute)
  const [sessionLocation, setSessionLocation] = createSignal(session.location)
  const [branch, setBranch] = createSignal("feature")
  const state = options.state ?? path.join(temporary.path, crypto.randomUUID())
  let renderDiff: Page["render"] | undefined
  let renderCommands: SlotClaim<"app">["render"] | undefined
  let vcsDiffInput: unknown
  let imageReadInput: unknown
  let shortcut: (command: string) => string | undefined = () => undefined
  const stored: { info: Info } = {
    info: { keybinds: options.keybinds, diffs: { source: options.source, single: options.single } },
  }
  const writes: Info[] = []
  const baseRequests: URL[] = []
  const diffRequests: URL[] = []
  const branchesRequests: URL[] = []
  const mutationRequests: URL[] = []
  const config = createTuiResolvedConfig(stored.info)
  const transport = createFetch(async (url, request) => {
    if (request.method !== "GET") mutationRequests.push(url)
    if (url.pathname.startsWith("/api/fs/read/")) {
      const file = decodeURIComponent(url.pathname.slice("/api/fs/read/".length))
      imageReadInput = {
        path: file,
        location: { directory: url.searchParams.get("location[directory]") },
      }
      return new Response(
        options.readImage ? (await options.readImage(file, request.signal)).slice() : diffImageFixture,
      )
    }
    if (url.pathname === "/api/vcs/base") {
      baseRequests.push(url)
      return options.baseResponse
        ? options.baseResponse()
        : json({ location: session.location, data: options.base === undefined ? baseFixture : options.base })
    }
    if (url.pathname === "/api/vcs/branches") {
      branchesRequests.push(url)
      return options.branchesResponse
        ? options.branchesResponse(url)
        : json({
            location: session.location,
            data: ["v2", "release", "origin/release"].filter((name) =>
              name.includes(url.searchParams.get("search") ?? ""),
            ),
          })
    }
    if (url.pathname !== "/api/vcs/diff") return
    diffRequests.push(url)
    vcsDiffInput = {
      location: { directory: url.searchParams.get("location[directory]") },
      mode: url.searchParams.get("mode"),
      context: url.searchParams.get("context"),
      ...(url.searchParams.has("base") ? { base: url.searchParams.get("base") } : {}),
    }
    if (options.diffResponse) return options.diffResponse(url)
    if (options.fail) return json({ message: "boom" }, { status: 500 })
    return json({
      location: { directory: "/repo/session", project: { id: "project-1", directory: "/repo/session" } },
      data: vcsDiff,
    })
  }, createEventStream())
  function Harness() {
    let theme: ReturnType<ReturnType<typeof useThemes>["currentTokens"]>
    function Content() {
      const dialog = useDialog()
      const keymap = Keymap.use()
      const shortcuts = Keymap.useShortcuts()
      if (options.onSessionTab) {
        Keymap.createLayer(() => ({
          mode: "global",
          commands: ["session.tab.next", "session.tab.previous"].map((id) => ({
            id,
            title: id,
            run: () => options.onSessionTab?.(),
          })),
        }))
      }
      shortcut = shortcuts.get
      theme = useThemes().currentTokens()
      const context = {
        options: {},
        storage: useStorage(),
        client: createApi(transport.fetch),
        data: {
          session: { get: () => ({ ...session, location: sessionLocation() }) },
          location: {
            default: () => ({ directory: "/repo/default" }),
            vcs: { info: () => ({ branch: { current: branch() } }) },
          },
        },
        get theme() {
          return theme
        },
        keymap: {
          layer(input: () => KeymapLayer) {
            input().commands?.forEach((command) => {
              if (command.id) commands.set(command.id, command)
            })
            Keymap.createLayer(input)
          },
          dispatch: keymap.dispatch,
          shortcuts: shortcuts.list,
          mode: keymap.mode,
        },
        ui: {
          dialog: createDialogApi(dialog, (render) => render()),
          router: {
            register(page: Page) {
              if (page.name === "diff") renderDiff = page.render
              return () => {}
            },
            navigate(destination: Destination) {
              setCurrent(
                destination.type === "plugin" && !("id" in destination)
                  ? { ...destination, id: "opencode.diffs" }
                  : destination,
              )
            },
            current,
          },
          slot(claim: SlotClaim<"app">) {
            renderCommands = claim.render
            return () => {}
          },
        },
      } as unknown as Context

      void diffViewerPlugin.setup(context)
      const commandView = renderCommands?.({})
      return (
        <>
          {commandView}
          <Show when={current().type === "plugin" ? current() : undefined} keyed>
            {(route) => renderDiff?.({ data: route.type === "plugin" ? route.data : undefined })}
          </Show>
        </>
      )
    }

    return (
      <TestTuiContexts paths={{ state }}>
        <TuiAppProvider value={{ name: "test", version: "test", channel: "test" }}>
          <StorageProvider>
            <ConfigProvider
              config={config}
              service={{
                get: async () => stored.info,
                update: async (update) => {
                  const next = structuredClone(stored.info)
                  update(next)
                  stored.info = next
                  writes.push(next)
                  return next
                },
              }}
            >
              <Keymap.Provider>
                <ToastProvider>
                  <ThemeProvider mode={options.mode ?? "dark"} source={emptyThemeSource}>
                    <DialogProvider>
                      <Content />
                    </DialogProvider>
                  </ThemeProvider>
                </ToastProvider>
              </Keymap.Provider>
            </ConfigProvider>
          </StorageProvider>
        </TuiAppProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />, {
    width: options.width ?? 80,
    height: options.height ?? 20,
    kittyKeyboard: options.kittyKeyboard,
  })
  await app.waitFor(() => commands.has("diff.open"))
  if (options.open !== false && current().type !== "plugin") commands.get("diff.open")!.run()
  if (options.open !== false) await app.waitFor(() => commands.has("diff.close"))
  await app.flush()
  if (!options.pending) await app.waitForFrame((frame) => !frame.includes("Loading diff"))
  return {
    app,
    commands,
    current,
    shortcut: (command: string) => shortcut(command),
    vcsDiffInput: () => vcsDiffInput,
    imageReadInput: () => imageReadInput,
    baseRequests,
    diffRequests,
    branchesRequests,
    mutationRequests,
    setSessionLocation,
    setBranch,
    state,
    writes,
    settings: () => stored.info,
  }
}

const startRoute: Route = { type: "session", sessionID: "session-1" }

const baseFixture = { name: "v2", ref: "refs/heads/v2", source: "default" }

const disabledDiffKeybinds = {
  "diff.down": "none",
  "diff.up": "none",
  "diff.page.down": "none",
  "diff.page.up": "none",
  "diff.half_page.down": "none",
  "diff.half_page.up": "none",
  "diff.mark_reviewed": "none",
} satisfies TuiKeybind.KeybindOverrides

const hunkDiff = [
  {
    file: "src/file.txt",
    additions: 3,
    deletions: 3,
    status: "modified",
    patch: `--- a/src/file.txt
+++ b/src/file.txt
@@ -1,3 +1,3 @@
 const first = true
-const oldFirst = true
+const newFirst = true
 const afterFirst = true
@@ -20,3 +20,3 @@
 const second = true
-const oldSecond = true
+const newSecond = true
 const afterSecond = true
@@ -40,3 +40,3 @@
 const third = true
-const oldThird = true
+const newThird = true
 const afterThird = true`,
  },
]

const manyDiffs = Array.from({ length: 40 }, (_, index) => ({
  ...hunkDiff[0],
  file: `file${String(index).padStart(2, "0")}.txt`,
}))

function findScrollBox(root: Renderable, patches = true): ScrollBoxRenderable | undefined {
  const node = root.findDescendantById(patches ? "diff-patches" : "diff-files")
  return node instanceof ScrollBoxRenderable ? node : undefined
}

function findDiffs(root: Renderable): DiffRenderable[] {
  return root instanceof DiffRenderable ? [root] : root.getChildren().flatMap(findDiffs)
}

const session = {
  id: "session-1",
  projectID: "project-1",
  location: { directory: "/repo/session" },
  title: "Session",
  cost: { currency: "USD", amount: 0 },
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: {
    created: 0,
    updated: 0,
  },
}

test.each([100, 160])("the sidebar source picker switches VCS sources at %i columns", async (width) => {
  const viewer = await renderDiffViewer(hunkDiff, {
    width,
    kittyKeyboard: true,
    initialRoute: {
      type: "plugin",
      id: "opencode.diffs",
      name: "diff",
      data: { mode: "branch", sessionID: "session-1", returnRoute: startRoute },
    },
  })
  try {
    expect(viewer.current()).toEqual({
      type: "plugin",
      id: "opencode.diffs",
      name: "diff",
      data: { mode: "branch", sessionID: "session-1", returnRoute: startRoute },
    })
    expect(viewer.vcsDiffInput()).toEqual({
      location: { directory: "/repo/session" },
      mode: "branch",
      base: "refs/heads/v2",
      context: "12",
    })
    await viewer.app.waitForFrame((frame) => frame.includes("const first"))
    await viewer.app.flush()
    const source = () => viewer.app.renderer.root.findDescendantById("diff-source-switch")!
    expect(source().y).toBe(1)
    expect(viewer.app.captureCharFrame().split("\n")[1]).toContain("All")
    await viewer.app.mockMouse.click(source().x, source().y, MouseButton.RIGHT)
    await viewer.app.flush()
    expect(viewer.app.captureCharFrame()).not.toContain("Diff source")
    await viewer.app.mockMouse.click(source().x, source().y)
    await viewer.app.waitForFrame((frame) => frame.includes("Diff source"))
    expect(viewer.app.renderer.getSelection()).toBeNull()
    viewer.app.mockInput.pressKey("HOME")
    viewer.app.mockInput.pressArrow("down")
    viewer.app.mockInput.pressArrow("down")
    await viewer.app.flush()
    viewer.app.mockInput.pressEnter()
    await viewer.app.waitForFrame((frame) => frame.includes("Uncommitted") && frame.includes("const first"))
    expect(viewer.vcsDiffInput()).toEqual({ location: { directory: "/repo/session" }, mode: "working", context: "12" })
    await viewer.app.mockMouse.click(source().x, source().y)
    await viewer.app.waitForFrame((frame) => frame.includes("Diff source"))
    viewer.app.mockInput.pressKey("HOME")
    await viewer.app.flush()
    viewer.app.mockInput.pressEnter()
    await viewer.app.waitForFrame((frame) => frame.includes("All") && frame.includes("const first"))
    expect(viewer.vcsDiffInput()).toEqual({
      location: { directory: "/repo/session" },
      mode: "branch",
      context: "12",
      base: "refs/heads/v2",
    })
    expect(viewer.baseRequests).toHaveLength(1)
    expect(viewer.writes).toHaveLength(0)
  } finally {
    viewer.app.renderer.destroy()
  }
})
