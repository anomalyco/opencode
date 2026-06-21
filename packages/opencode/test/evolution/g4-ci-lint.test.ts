import { describe, expect, test } from "bun:test"
import { $ } from "bun"

describe("G4 — CI Error Registry Lint", () => {
  test("lint:error-registry exits with code 0", async () => {
    const result = await $`bun run lint:error-registry`.quiet().nothrow()
    expect(result.exitCode).toBe(0)
  }, 15000)

  test("lint:error-registry outputs success message", async () => {
    const result = await $`bun run lint:error-registry`.quiet().nothrow()
    const text = result.stdout.toString()
    expect(text).toContain("All")
    expect(text).toContain("registered")
  }, 15000)
})
