// Known gap: Npm.outdated() only consults registry.npmjs.org. For packages
// installed from GitHub Packages or other scoped registries, this check is
// silently wrong — it will always report "not outdated." Tracked as follow-up.

import { describe, expect, test, spyOn } from "bun:test"
import { Npm } from "../../src/npm"

describe("Npm.outdated", () => {
  test('does not throw on "latest" specifiers', async () => {
    const meta = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ "dist-tags": { latest: "1.3.13" } })),
    )

    try {
      expect(await Npm.outdated("@opencode-ai/plugin", "latest")).toBe(false)
    } finally {
      meta.mockRestore()
    }
  })
})
