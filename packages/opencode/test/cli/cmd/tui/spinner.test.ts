import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { RGBA } from "@opentui/core"

import { createColors, createFrames } from "../../../../src/cli/cmd/tui/ui/spinner"

describe("frame spinner", () => {
  test("generates local prompt frames and colors", () => {
    const color = RGBA.fromHex("#ff0000")
    const frames = createFrames({
      color,
      style: "blocks",
      inactiveFactor: 0.6,
      minAlpha: 0.3,
    })
    const colors = createColors({
      color,
      style: "blocks",
      inactiveFactor: 0.6,
      minAlpha: 0.3,
    })

    expect(frames.length).toBeGreaterThan(0)
    expect(frames.some((frame) => frame.includes("■"))).toBe(true)
    expect(colors(0, 0, frames.length, frames[0]!.length)).toBeInstanceOf(RGBA)
  })

  test("uses the local frame spinner component instead of opentui-spinner", async () => {
    const source = await readFile(new URL("../../../../src/cli/cmd/tui/component/spinner.tsx", import.meta.url), "utf8")
    const promptSource = await readFile(new URL("../../../../src/cli/cmd/tui/component/prompt/index.tsx", import.meta.url), "utf8")

    expect(source).toContain("export function FrameSpinner")
    expect(source).not.toContain("opentui-spinner")
    expect(promptSource).toContain("<FrameSpinner")
    expect(promptSource).not.toContain("<spinner")
  })
})
