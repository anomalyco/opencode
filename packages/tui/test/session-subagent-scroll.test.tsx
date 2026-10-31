import { expect, test } from "bun:test"
import { ScrollBoxRenderable, type Renderable } from "@opentui/core"
import { createAppFixture } from "./fixture/app"
import { parent, fetch } from "./fixture/subagent-scroll"

test.each([80, 120])(
  "subagent history never flashes the initial prompt at width %s",
  async (width) => {
    await using app = await createAppFixture({
      width,
      height: 40,
      args: { sessionID: parent.id },
      config: {
        animations: false,
        tabs: { enabled: false },
        scroll: { speed: 12 },
      },
      fetch,
    })
    await app.waitForFrame((frame) => frame.includes("PARENT-MARKER"))
    app.mockInput.pressArrow("down")
    await app.waitForFrame((frame) => frame.includes("show inactive"))
    app.mockInput.pressKey("a", { ctrl: true })
    await app.waitForFrame((frame) => frame.includes("Synthetic scroll child"))
    app.mockInput.pressEnter()
    await app.waitForFrame((frame) => frame.includes("BLOCK-049"))
    await app.waitForVisualIdle()
    const find = (node: Renderable): ScrollBoxRenderable | undefined =>
      node instanceof ScrollBoxRenderable && node.getRenderable("answer-49")
        ? node
        : node.getChildren().map(find).find(Boolean)
    let scroll = find(app.renderer.root)
    if (!scroll) throw new Error("Missing child transcript")
    expect(scroll.getRenderable("answer-30") !== undefined).toBe(true)
    expect(scroll.getRenderable("answer-29") !== undefined).toBe(false)
    expect(scroll.getRenderable("initial-prompt") !== undefined).toBe(false)
    const frames: { first: number; prompt: boolean }[] = []
    const capture = () => {
      if (!scroll || scroll.isDestroyed) return
      const frame = app
        .captureCharFrame()
        .split("\n")
        .slice(scroll.viewport.y, scroll.viewport.y + scroll.viewport.height)
        .join("\n")
      const block = /BLOCK-(\d+)/.exec(frame)
      frames.push({ first: block ? Number(block[1]) : -1, prompt: frame.includes("INITIAL-PROMPT") })
    }
    app.renderer.on("frame", capture)
    try {
      for (const pass of ["first", "repeat", "reopen"]) {
        if (pass !== "first") {
          for (let step = 0; step < 400 && !app.captureCharFrame().includes("BLOCK-049"); step++) {
            await app.mockMouse.scroll(scroll.viewport.x + 2, scroll.viewport.y + 2, "down")
            await app.waitForVisualIdle({ quietFrames: 2 })
          }
          expect(app.captureCharFrame()).toContain("BLOCK-049")
        }
        if (pass === "reopen") {
          app.mockInput.pressEscape()
          await app.waitForFrame((frame) => frame.includes("PARENT-MARKER"))
          app.mockInput.pressArrow("down")
          await app.waitForFrame((frame) => frame.includes("show inactive"))
          app.mockInput.pressKey("a", { ctrl: true })
          await app.waitForFrame((frame) => frame.includes("Synthetic scroll child"))
          app.mockInput.pressEnter()
          await app.waitForFrame((frame) => frame.includes("BLOCK-049"))
          await app.waitForVisualIdle()
          scroll = find(app.renderer.root)
          if (!scroll) throw new Error("Missing reopened child transcript")
        }
        frames.length = 0
        for (let step = 0; step < 400 && !app.captureCharFrame().includes("INITIAL-PROMPT line 0:"); step++) {
          await app.mockMouse.scroll(scroll.viewport.x + 2, scroll.viewport.y + 2, "up")
          await app.waitForVisualIdle({ quietFrames: 2 })
        }
        expect(app.captureCharFrame()).toContain("INITIAL-PROMPT line 0:")
        expect(frames.some((frame) => frame.prompt)).toBe(true)
        const flash = frames.findIndex(
          (frame, index) => frame.prompt && frames.slice(index + 1).some((later) => !later.prompt && later.first > 0),
        )
        expect(flash, `${pass}: ${JSON.stringify(frames.slice(Math.max(0, flash - 2), flash + 4))}`).toBe(-1)
      }
    } finally {
      app.renderer.off("frame", capture)
    }
  },
  120000,
)
