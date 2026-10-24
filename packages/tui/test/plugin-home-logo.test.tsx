import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { copyPlugin } from "./fixture/fixture"

// The first wordmark row's left column. Every character is a glyph the Logo
// renders verbatim, so the row survives cursor placement and theme colors. It is
// contiguous at every covered width: 100 stays wide, 44 is the wide side of the
// breakpoint, and 40 is the narrow side that stacks the columns.
const wordmark = "█▀▀█ █▀▀█ █▀▀█ █▀▀▄"

// opencode.prompt.footer hides its shortcut hints below 44 columns, so only the
// wider frames carry a statusline token.
const statusline = "ctrl+p commands"

test.each([100, 44, 40])("Home keeps the built-in wordmark at %i columns when no plugin claims home.logo", async (width) => {
  await using setup = await createAppFixture({ width, height: 30 })
  await setup.ready
  const frame = await setup.waitForFrame((frame) => frame.includes(wordmark))
  expect(frame).toContain(wordmark)
  expect(frame).toContain("Ask anything…")
  if (width >= 44) expect(frame).toContain(statusline)
})

test.each([100, 44, 40])("a plugin claiming home.logo replaces the wordmark at %i columns", async (width) => {
  await using plugin = await copyPlugin("home-logo")
  await using setup = await createAppFixture({
    width,
    height: 30,
    config: { animations: false, plugins: [plugin.directory] },
  })
  await setup.ready
  const frame = await setup.waitForFrame((frame) => frame.includes("Plugin home wordmark"))
  expect(frame).toContain("Plugin home wordmark")
  expect(frame).not.toContain(wordmark)
  expect(frame).toContain("Ask anything…")
  if (width >= 44) expect(frame).toContain(statusline)
})
