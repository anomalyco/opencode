import { expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { disabledReason } from "./installation"

test("a Flatpak installation with a native update feed leaves updates to Flatpak", async () => {
  const resources = await mkdtemp(join(tmpdir(), "opencode-update-"))
  try {
    expect(disabledReason(resources, undefined)).toBe("app-update.yml is missing")
    await writeFile(join(resources, "app-update.yml"), "provider: generic\n")
    expect(disabledReason(resources, undefined)).toBeUndefined()
    expect(disabledReason(resources, "ai.opencode.opencode")).toBe("updates are managed by Flatpak")
  } finally {
    await rm(resources, { recursive: true, force: true })
  }
})
