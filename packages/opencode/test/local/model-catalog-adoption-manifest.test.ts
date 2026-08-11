import { join } from "node:path"
import { Schema } from "effect"
import { describe, expect, test } from "bun:test"
import { ADOPTION_MANIFEST, AdoptionEntry } from "../../src/local/model-catalog/adoption-manifest"

const decodeEntry = Schema.decodeUnknownSync(AdoptionEntry)
const packageRoot = join(import.meta.dir, "../..")

describe("adoption manifest", () => {
  test("every entry conforms to the schema", () => {
    for (const entry of ADOPTION_MANIFEST) expect(() => decodeEntry(entry)).not.toThrow()
  })

  test("MIT-licensed sources carry attribution; private sources carry none", () => {
    for (const entry of ADOPTION_MANIFEST) {
      if (entry.license === "MIT") expect(entry.attribution).not.toBeNull()
      if (entry.license === null) expect(entry.sourceProject).toBe("skein")
    }
  })

  test("destination modules and test files actually exist on disk", async () => {
    for (const entry of ADOPTION_MANIFEST) {
      expect(await Bun.file(join(packageRoot, entry.destinationModule)).exists()).toBe(true)
      for (const testFile of entry.tests) expect(await Bun.file(join(packageRoot, testFile)).exists()).toBe(true)
    }
  })

  test("pinned commits are full 40-character SHAs", () => {
    for (const entry of ADOPTION_MANIFEST) expect(entry.sourceCommit).toMatch(/^[0-9a-f]{40}$/)
  })
})
