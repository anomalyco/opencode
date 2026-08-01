import { describe, expect, test } from "bun:test"
import { loadEditProjectDialog } from "./layout"

describe("legacy layout edit project dialog", () => {
  test("loads the V2 edit project dialog", async () => {
    const dialog = await loadEditProjectDialog()
    expect(dialog.name).toBe("DialogEditProjectV2")
  })
})
