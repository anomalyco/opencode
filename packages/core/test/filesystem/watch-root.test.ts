import { describe, expect } from "bun:test"
import os from "os"
import path from "path"
import { isBroadWatchRoot } from "@opencode-ai/core/filesystem/watch-root"
import { testEffect } from "../lib/effect"

const it = testEffect()

describe("isBroadWatchRoot", () => {
  it("treats filesystem root as broad", () => {
    expect(isBroadWatchRoot("/")).toBe(true)
  })

  it("treats user home as broad", () => {
    expect(isBroadWatchRoot(os.homedir())).toBe(true)
    expect(isBroadWatchRoot("~")).toBe(false)
  })

  it("allows normal project directories", () => {
    expect(isBroadWatchRoot(path.join(os.homedir(), "Projects", "demo"))).toBe(false)
  })
})
