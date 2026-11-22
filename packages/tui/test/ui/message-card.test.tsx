/** @jsxImportSource @opentui/solid */
import { afterEach, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type { UiStyle } from "../../src/ui/design"
import { MessageCard } from "../../src/ui/message-card"

let setup: Awaited<ReturnType<typeof testRender>> | undefined

afterEach(() => {
  setup?.renderer.destroy()
  setup = undefined
})

async function frame(style: UiStyle) {
  setup?.renderer.destroy()
  setup = await testRender(
    () => (
      <MessageCard
        style={style}
        borderColor={RGBA.fromInts(80, 160, 240)}
        backgroundColor={RGBA.fromInts(20, 20, 20)}
      >
        <box paddingLeft={2}>
          <text>Review the diff</text>
        </box>
      </MessageCard>
    ),
    { width: 30, height: 6 },
  )
  await setup.renderOnce()
  await setup.renderOnce()
  return setup
    .captureCharFrame()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
}

test("fork style draws the rounded card", async () => {
  const output = await frame("fork")

  expect(output).toContain("╭")
  expect(output).toContain("╰")
  expect(output).toContain("Review the diff")
})

test("opencode style restores the upstream left rule", async () => {
  const output = await frame("opencode")

  expect(output).toContain("┃")
  expect(output).not.toContain("╭")
  expect(output).not.toContain("╰")
})
