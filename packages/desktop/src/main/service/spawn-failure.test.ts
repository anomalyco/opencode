import { describe, expect, test } from "bun:test"
import { SpawnFailure } from "./spawn-failure"

describe("SpawnFailure.is", () => {
  test("matches an executable the operating system refused to run", () => {
    expect(SpawnFailure.is(new Error("Failed to start server", { cause: new Error("spawn UNKNOWN") }))).toBe(true)
  })

  test("ignores a server that started and exited", () => {
    expect(SpawnFailure.is(new Error("Server process exited with code 1"))).toBe(false)
  })

  test("ignores a failure without a spawn error", () => {
    expect(SpawnFailure.is(new Error("Failed to start server"))).toBe(false)
    expect(SpawnFailure.is("Failed to start server")).toBe(false)
  })
})
