import { describe, expect, test } from "bun:test"

describe("Session execution owner", () => {
  test("SessionScreen renders the production execution owner", async () => {
    const source = await Bun.file(new URL("../session/screen.tsx", import.meta.url)).text()

    expect(source).toContain("<SessionExecutionOwner")
    expect(source).not.toContain("<SessionExecutionProvider")
  })
})
