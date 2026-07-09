import { describe, expect, test } from "bun:test"

describe("DialogManageModelsV2 layout", () => {
  test("keeps provider groups separated in the scroll panel", async () => {
    const source = await Bun.file(new URL("./dialog-manage-models.tsx", import.meta.url)).text()

    expect(source).toMatch(/class="[^"]*settings-v2-panel[^"]*settings-v2-models[^"]*gap-6[^"]*"/)
  })
})
