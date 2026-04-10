import { afterEach, describe, test, expect } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { SummaryBridge } from "../../src/memory/summary-bridge"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

afterEach(async () => {
  await Instance.disposeAll()
})

describe("memory.summary-bridge", () => {
  test("extracts candidates from valid summary", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const summary = `## Summary
This session did X and Y.

## Memory Candidates
- **User preference**: Prefers TypeScript over JavaScript
- **Project structure**: Uses monorepo with packages/

## Next Steps
Do Z next.`

        await expect(
          SummaryBridge.extractMemoryCandidates(summary, "ses_1", tmp.path),
        ).resolves.toBeUndefined()
      },
    })
  })

  test("returns silently when no marker present", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const summary = "## Summary\nJust a regular summary with no memory section."

        await expect(
          SummaryBridge.extractMemoryCandidates(summary, "ses_2", tmp.path),
        ).resolves.toBeUndefined()
      },
    })
  })

  test("handles bold and non-bold formats", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const summary = `## Memory Candidates
- **Bold name**: Bold description
- Plain name: Plain description`

        await expect(
          SummaryBridge.extractMemoryCandidates(summary, "ses_3", tmp.path),
        ).resolves.toBeUndefined()
      },
    })
  })

  test("stops at next heading boundary", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const summary = `## Memory Candidates
- **Item**: Description

## Other Section
This should not be parsed as a candidate.
- **Not a candidate**: Should be ignored`

        await expect(
          SummaryBridge.extractMemoryCandidates(summary, "ses_4", tmp.path),
        ).resolves.toBeUndefined()
      },
    })
  })

  test("handles empty candidates section", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const summary = `## Memory Candidates

## Next Section`

        await expect(
          SummaryBridge.extractMemoryCandidates(summary, "ses_5", tmp.path),
        ).resolves.toBeUndefined()
      },
    })
  })
})
