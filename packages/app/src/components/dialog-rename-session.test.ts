import { describe, expect, test } from "bun:test"

describe("DialogRenameSession", () => {
  test("does not depend on session SDK context", async () => {
    const source = await Bun.file(new URL("./dialog-rename-session.tsx", import.meta.url)).text()

    expect(source).not.toContain("@/context/sdk")
    expect(source).not.toContain("useSDK()")
    expect(source).toContain("directory: string")
  })
})
