import { describe, expect, test } from "bun:test"
import { generate, migratedDescriptions } from "../script/config-schema.js"

describe("published config schema", () => {
  test("describes how the deprecated autoupdate field normalizes onto update", async () => {
    const schema = await generate()
    const autoupdate = schema.properties.autoupdate as { deprecated?: boolean; description?: string } | undefined

    expect(autoupdate?.deprecated).toBe(true)
    expect(autoupdate?.description).toBe(migratedDescriptions.get("autoupdate"))
    expect(autoupdate?.description).not.toContain("never installed automatically")
  })
})
