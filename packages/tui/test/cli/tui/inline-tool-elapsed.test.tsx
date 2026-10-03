import { afterEach, describe, expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { testRender, type JSX } from "@opentui/solid"
import { RGBA } from "@opentui/core"
import { InlineToolRow } from "../../../src/routes/session"
import { useToolElapsed } from "../../../src/routes/session/tool-elapsed"
import type { ToolPart } from "@opencode-ai/sdk/v2"

const muted = RGBA.fromValues(128, 128, 128, 1)

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined

afterEach(() => {
  testSetup?.renderer.destroy()
  testSetup = undefined
})

async function renderFrame(component: () => JSX.Element, options: { width: number; height: number }) {
  testSetup = await testRender(component, options)
  await testSetup.renderOnce()
  await testSetup.renderOnce()

  return testSetup
    .captureCharFrame()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trimEnd()
}

describe("TUI inline tool elapsed badge", () => {
  test("shows the frozen total on completed tools", async () => {
    const frame = await renderFrame(
      () => (
        <InlineToolRow icon="→" complete="src/index.ts" pending="Reading file…" elapsed="· 3.2s" elapsedColor={muted}>
          Read src/index.ts
        </InlineToolRow>
      ),
      { width: 72, height: 3 },
    )
    expect(frame).toContain("Read src/index.ts")
    expect(frame).toContain("· 3.2s")
  })

  test("shows the live value on running tools", async () => {
    const frame = await renderFrame(
      () => (
        <InlineToolRow icon="$" complete={false} pending="Running command…" elapsed="· 12.0s" elapsedColor={muted}>
          {`sleep 20`}
        </InlineToolRow>
      ),
      { width: 72, height: 3 },
    )
    expect(frame).toContain("· 12.0s")
  })

  test("renders nothing extra when elapsed is absent", async () => {
    const frame = await renderFrame(
      () => (
        <InlineToolRow icon="→" complete="src/index.ts" pending="Reading file…">
          Read src/index.ts
        </InlineToolRow>
      ),
      { width: 72, height: 3 },
    )
    expect(frame).toContain("Read src/index.ts")
    expect(frame).not.toContain("·")
  })

  test("updates the row when elapsed changes, like a live tick would", async () => {
    const [elapsed, setElapsed] = createSignal("")
    testSetup = await testRender(
      () => (
        <InlineToolRow icon="$" complete={false} pending="Running command…" elapsed={elapsed()} elapsedColor={muted}>
          sleep 20
        </InlineToolRow>
      ),
      { width: 72, height: 3 },
    )
    await testSetup.renderOnce()
    let frame = testSetup
      .captureCharFrame()
      .split("\n")
      .map((line) => line.trimEnd())
      .join("\n")
      .trimEnd()
    expect(frame).not.toContain("·")

    setElapsed("· 5.0s")
    await testSetup.renderOnce()
    frame = testSetup
      .captureCharFrame()
      .split("\n")
      .map((line) => line.trimEnd())
      .join("\n")
      .trimEnd()
    expect(frame).toContain("Running command…")
    expect(frame).toContain("· 5.0s")

    setElapsed("· 20.1s")
    await testSetup.renderOnce()
    frame = testSetup
      .captureCharFrame()
      .split("\n")
      .map((line) => line.trimEnd())
      .join("\n")
      .trimEnd()
    expect(frame).toContain("· 20.1s")
  })

  test("ticks live through the real hook while the part runs", async () => {
    const startedAt = Date.now()
    const running: ToolPart = {
      id: "prt_live",
      sessionID: "ses_1",
      messageID: "msg_1",
      type: "tool",
      callID: "call_1",
      tool: "bash",
      state: { status: "running", input: {}, time: { start: startedAt } },
    }
    function LiveFixture() {
      const elapsed = useToolElapsed(() => running)
      return (
        <InlineToolRow icon="$" complete={false} pending="Running command…" elapsed={elapsed()} elapsedColor={muted}>
          sleep 20
        </InlineToolRow>
      )
    }
    testSetup = await testRender(() => <LiveFixture />, { width: 72, height: 3 })
    const read = () =>
      testSetup!
        .captureCharFrame()
        .split("\n")
        .map((line) => line.trimEnd())
        .join("\n")
        .trimEnd()
    await testSetup.renderOnce()
    const first = read()
    await new Promise((resolve) => setTimeout(resolve, 2200))
    await testSetup.renderOnce()
    const second = read()
    const tick = (frame: string) => frame.match(/· (\d+(?:\.\d+)?m?s)/)?.[1]
    expect(tick(first)).toBeTruthy()
    expect(tick(second)).toBeTruthy()
    expect(tick(first)).not.toBe(tick(second))
    expect(second).toContain("Running command…")
  })
})
