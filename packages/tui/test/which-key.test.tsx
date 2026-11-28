import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"

test.each([44, 120])("opens as a popup, navigates, docks, and closes at width %i", async (width) => {
  await using setup = await createAppFixture({
    width,
    height: 40,
    config: {
      animations: false,
      keybinds: {
        "which-key.toggle": "f6",
        "which-key.layout.toggle": "f7",
        "which-key.group.next": "f8",
      },
    },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("ctrl+p commands"))

  setup.mockInput.pressKey("F6")
  await setup.waitForFrame((frame) => frame.includes("Keyboard shortcuts") && frame.includes("f6 close"))
  expect(setup.captureCharFrame()).toContain(width === 44 ? "‹ Agent ›" : "Agent")

  setup.mockInput.pressKey("F8")
  await setup.waitForFrame((frame) =>
    width === 44 ? frame.includes("‹ Prompt ›") : frame.includes("Prompt 4") && !frame.includes("Agent 4"),
  )

  setup.mockInput.pressKey("F7")
  await setup.waitForFrame((frame) => frame.includes("Keyboard shortcuts") && frame.includes("dock · pending off"))

  setup.mockInput.pressKey("F7")
  await setup.waitForFrame((frame) => frame.includes("Keyboard shortcuts") && frame.includes("f6 close"))

  setup.mockInput.pressKey("F6")
  await setup.waitForFrame((frame) => !frame.includes("Keyboard shortcuts"))
})

test("escape closes the popup", async () => {
  await using setup = await createAppFixture({
    width: 100,
    height: 30,
    config: {
      animations: false,
      keybinds: { "which-key.toggle": "f6" },
    },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("ctrl+p commands"))

  setup.mockInput.pressKey("F6")
  await setup.waitForFrame((frame) => frame.includes("Keyboard shortcuts"))

  setup.mockInput.pressEscape()
  await setup.waitForFrame((frame) => !frame.includes("Keyboard shortcuts"))
})

test("end jumps to the last section", async () => {
  await using setup = await createAppFixture({
    width: 60,
    height: 30,
    config: {
      animations: false,
      keybinds: { "which-key.toggle": "f6", "which-key.end": "f8" },
    },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("ctrl+p commands"))

  setup.mockInput.pressKey("F6")
  await setup.waitForFrame((frame) => frame.includes("‹ Agent ›"))

  setup.mockInput.pressKey("F8")
  await setup.waitForFrame((frame) => frame.includes("‹ Text Editing ›"))
})

test("previews valid continuations for a pending leader sequence", async () => {
  await using setup = await createAppFixture({
    width: 100,
    height: 30,
    config: {
      animations: false,
      leader: { timeout: 5_000 },
      keybinds: {
        "which-key.layout.toggle": "f6",
        "which-key.pending.toggle": "f7",
      },
    },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("ctrl+p commands"))

  setup.mockInput.pressKey("F6")
  setup.mockInput.pressKey("F7")
  setup.mockInput.pressKey("x", { ctrl: true })
  await setup.waitForFrame((frame) => frame.includes("Pending: ctrl+x") && frame.includes("Choose a valid next key"))
})
