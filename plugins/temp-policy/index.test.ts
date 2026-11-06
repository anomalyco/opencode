import { describe, expect, test } from "bun:test"
import os from "node:os"
import path from "node:path"
import { contains, isGenericTempResource } from "./index"

const temp = path.resolve(os.tmpdir())
const managed = path.join(temp, "opencode")

describe("temp policy", () => {
  test("recognizes paths within a directory boundary", () => {
    expect(contains(temp, temp)).toBe(true)
    expect(contains(temp, path.join(temp, "child"))).toBe(true)
    expect(contains(temp, path.resolve(temp, "..", "other"))).toBe(false)
  })

  test("blocks generic temp resources but permits the managed directory", () => {
    expect(isGenericTempResource(path.join(temp, "*"))).toBe(true)
    expect(isGenericTempResource(path.join(temp, "other", "*"))).toBe(true)
    expect(isGenericTempResource(path.join(managed, "*"))).toBe(false)
    expect(isGenericTempResource(path.join(managed, "child", "*"))).toBe(false)
  })
})
