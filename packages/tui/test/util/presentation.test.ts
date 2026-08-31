import { expect, test } from "bun:test"
import { sessionEpilogue } from "../../src/util/presentation"

test("formats session continuation summary", () => {
  const epilogue = sessionEpilogue({ title: "A session", sessionID: "ses_123" })
  expect(epilogue).toContain("A session")
  expect(epilogue).toContain("opencode2 -s ses_123")
})

test("uses the terminal foreground without painting shadows when the background is unknown", () => {
  const output = sessionEpilogue({ title: "Logo", sessionID: "ses_logo" })
  const mark = output.split("\n").slice(0, 4).join("\n")

  expect(mark).not.toMatch(/\x1b\[(?:38|48);/)
  expect(mark).not.toContain("\x1b[90m")
  expect(Bun.stripANSI(mark)).toBe(
    [
      "                                   ▄     ",
      "  █▀▀█ █▀▀█ █▀▀█ █▀▀▄ █▀▀▀ █▀▀█ █▀▀█ █▀▀█",
      "  █  █ █  █ █▀▀▀ █  █ █    █  █ █  █ █▀▀▀",
      "  ▀▀▀▀ █▀▀▀ ▀▀▀▀ ▀  ▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀",
    ].join("\n"),
  )
  expect(Bun.stripANSI(output)).toContain("Session   Logo")
  expect(Bun.stripANSI(output)).toContain("Continue  opencode2 -s ses_logo")
})
