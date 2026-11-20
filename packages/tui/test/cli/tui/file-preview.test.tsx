/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { afterEach, expect, test } from "bun:test"
import { FilePreview } from "../../../src/routes/session"

let setup: Awaited<ReturnType<typeof testRender>> | undefined

afterEach(() => {
  setup?.renderer.destroy()
  setup = undefined
})

const content = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`).join("\n")

test("clips to a preview until it's expanded", async () => {
  const [expanded, setExpanded] = createSignal(false)
  setup = await testRender(
    () => (
      <box flexDirection="column">
        <FilePreview expanded={expanded()} hint="the hint">
          <text>{content}</text>
        </FilePreview>
        <text>after</text>
      </box>
    ),
    { width: 40, height: 40 },
  )

  await setup.renderOnce()
  let frame = setup.captureCharFrame()
  expect(frame).toContain("line 10")
  expect(frame).not.toContain("line 11")
  expect(frame).toContain("the hint")
  expect(frame).toContain("after")

  setExpanded(true)
  await setup.renderOnce()
  frame = setup.captureCharFrame()
  expect(frame).toContain("line 30")
  expect(frame).toContain("after")

  setExpanded(false)
  await setup.renderOnce()
  expect(setup.captureCharFrame()).not.toContain("line 11")
})
