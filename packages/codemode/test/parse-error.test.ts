import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { CodeMode } from "../src/index.js"

const error = async (code: string) => {
  const result = await Effect.runPromise(CodeMode.execute({ code, tools: {} }))
  if (result.ok) throw new Error(`expected failure, got value ${JSON.stringify(result.value)}`)
  return result.error
}

describe("CodeMode parse errors", () => {
  test("includes the offending line and supported syntax hint", async () => {
    const failure = await error(`const fs = ... ; // not available in Code Mode\nreturn null;`)
    expect(failure.kind).toBe("ParseError")
    expect(failure.message).toContain("Offending line:")
    expect(failure.message).toContain("Code Mode accepts JavaScript")
  })

  test("explains that imports are unavailable", async () => {
    const failure = await error(`import fs from "node:fs"; return null;`)
    expect(failure.kind).toBe("ParseError")
    expect(failure.message).toContain("import/export and TypeScript-only syntax are unavailable.")
  })
})
