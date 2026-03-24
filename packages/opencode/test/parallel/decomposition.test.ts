import { describe, expect, test } from "bun:test"
import { Decomposition } from "../../src/parallel/decomposition"
import { SubtaskID } from "../../src/parallel/schema"
import type { Subtask } from "../../src/parallel/schema"

function create(id: string, fileScope: string[], constraints?: string[]): Subtask {
  return {
    id: SubtaskID.make(id),
    title: `Subtask ${id}`,
    description: `Description ${id}`,
    fileScope,
    dependencies: [],
    constraints,
    kind: "structural",
  }
}

describe("Decomposition", () => {
  test("profiles package renames as structural", () => {
    const mode = Decomposition.profile("Rename Android package from com.old to com.new and update imports")

    expect(mode.kind).toBe("structural")
    expect(mode.simple).toBe(true)
  })

  test("keeps semantic tasks semantic", () => {
    const mode = Decomposition.profile("Add JWT auth endpoints and implement login behavior")

    expect(mode.kind).toBe("semantic")
    expect(mode.simple).toBe(false)
  })

  test("simplifies simple structural plans into one worker", () => {
    const out = Decomposition.simplify(
      [
        create("a", ["app/src/main/java"], ["Keep behavior unchanged"]),
        create("b", ["app/build.gradle.kts"], ["Do not change runtime logic"]),
      ],
      "Rename Android package from com.old to com.new",
      {
        kind: "structural",
        simple: true,
        reason: "mechanical rename",
      },
    )

    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe("structural")
    expect(out[0].fileScope).toEqual(["app/build.gradle.kts", "app/src/main/java"])
    expect(out[0].constraints).toEqual(["Do not change runtime logic", "Keep behavior unchanged"])
    expect(out[0].dependencies).toEqual([])
  })
})
