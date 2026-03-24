import { describe, expect, test } from "bun:test"
import { syncProject } from "./directory-layout-sync"

describe("directory layout project registration", () => {
  test("registers a resolved directory", () => {
    const opened: string[] = []

    syncProject("/repo", (directory) => {
      opened.push(directory)
    })

    expect(opened).toEqual(["/repo"])
  })

  test("skips missing directories", () => {
    const opened: string[] = []

    syncProject(undefined, (directory) => {
      opened.push(directory)
    })

    expect(opened).toEqual([])
  })
})
