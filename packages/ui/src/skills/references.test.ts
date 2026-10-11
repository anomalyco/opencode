import { describe, expect, test } from "bun:test"
import { generateSkillReferences } from "./references"

const root = import.meta.dir + "/../.."

describe("skill references", () => {
  test("committed reference files match generated output", async () => {
    const references = await generateSkillReferences(root)
    const committed = await Promise.all(references.map((reference) => Bun.file(`${root}/${reference.path}`).text()))

    // Run `bun script/generate-skill-references.ts` from packages/ui when this fails.
    expect(committed).toEqual(references.map((reference) => reference.content))
  })
})
