import { afterEach, describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"

afterEach(async () => {
  await Instance.disposeAll()
})

describe("ayaz source regressions", () => {
  test("keeps git_read permission enabled in the primitive definition", async () => {
    const text = await Bun.file(new URL("../../src/agent/primitive/ayaz.ts", import.meta.url)).text()
    expect(text).toContain('git_read: "allow"')
  })

})
