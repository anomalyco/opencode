import { describe, expect, it } from "bun:test"
import { ancestorDirectories } from "@opencode/core/config/plugin/instruction"

describe("ancestorDirectories", () => {
  it("walks from start down to stop when stop is an ancestor", () => {
    expect(ancestorDirectories("/projects/app/src", "/projects/app")).toEqual([
      "/projects/app/src",
      "/projects/app",
    ])
  })

  it("returns start alone when it equals stop", () => {
    expect(ancestorDirectories("/projects/app", "/projects/app")).toEqual(["/projects/app"])
  })

  it("terminates at the filesystem root when stop is never reached", () => {
    // Regression: the recursive form only stopped on `start === stop`, so a stop that
    // never string-matches (path form drift) walked past the root forever and
    // overflowed the stack, blocking instruction initialization (#50296).
    expect(ancestorDirectories("/a/b", "/elsewhere")).toEqual(["/a/b", "/a", "/"])
  })

  it("stops immediately at the filesystem root", () => {
    expect(ancestorDirectories("/", "/elsewhere")).toEqual(["/"])
  })
})
