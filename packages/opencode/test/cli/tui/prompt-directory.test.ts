import { describe, expect, test } from "bun:test"
import path from "path"
import { directoryPath } from "../../../src/cli/cmd/tui/component/prompt/directory"

describe("prompt directory path formatting", () => {
  test("keeps root query suggestions absolute", () => {
    const cwd = path.join(path.sep, "Users", "dev", "project")
    const target = path.join(path.sep, "usr")

    const result = directoryPath(target, cwd, "/")

    expect(result).toBe(path.normalize(target))
    expect(result.includes("..")).toBe(false)
  })

  test("keeps explicit absolute query suggestions absolute", () => {
    const cwd = path.join(path.sep, "Users", "dev", "project")
    const target = path.join(path.sep, "usr", "local")

    const result = directoryPath(target, cwd, path.join(path.sep, "usr"))

    expect(result).toBe(path.normalize(target))
  })

  test("keeps relative query suggestions relative", () => {
    const cwd = path.join(path.sep, "Users", "dev", "project")
    const target = path.join(cwd, "packages")

    const result = directoryPath(target, cwd, "pack")

    expect(result).toBe("packages")
  })

  test("keeps home query suggestions tilde-based", () => {
    const prior = process.env.HOME
    const home = path.join(path.sep, "Users", "dev")
    process.env.HOME = home

    try {
      const cwd = path.join(home, "project")
      const target = path.join(home, "workspace")

      const result = directoryPath(target, cwd, "~/")

      expect(result).toBe("~/workspace")
    } finally {
      process.env.HOME = prior
    }
  })
})
