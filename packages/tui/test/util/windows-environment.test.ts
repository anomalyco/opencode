import { describe, expect, test } from "bun:test"
import { mergeWindowsEnvironment } from "../../src/util/windows-environment"

describe("util.windows-environment", () => {
  test("appends registry PATH entries missing from the session", () => {
    const merged = mergeWindowsEnvironment(
      { Path: "C:\\Program Files\\Git\\usr\\bin;C:\\Windows\\system32", HOME: "C:\\Users\\dev" },
      {
        machine: { Path: "C:\\WINDOWS\\system32\\;C:\\Tools\\docker" },
        user: { PATH: "D:\\Tools\\gh\\bin;;C:\\tools\\DOCKER\\" },
      },
    )

    expect(merged.variables).toEqual({
      Path: "C:\\Program Files\\Git\\usr\\bin;C:\\Windows\\system32;C:\\Tools\\docker;D:\\Tools\\gh\\bin",
      HOME: "C:\\Users\\dev",
    })
    expect(merged.paths).toBe(2)
    expect(merged.added).toBe(0)
  })

  test("adds new variables without overwriting existing ones", () => {
    const merged = mergeWindowsEnvironment(
      { Path: "C:\\Windows", http_proxy: "http://terminal:8080" },
      {
        machine: { HTTP_PROXY: "http://machine:8080", NO_PROXY: "localhost", GH_HOST: "machine.example" },
        user: { GH_HOST: "user.example" },
      },
    )

    expect(merged.variables).toEqual({
      Path: "C:\\Windows",
      http_proxy: "http://terminal:8080",
      NO_PROXY: "localhost",
      GH_HOST: "user.example",
    })
    expect(merged.paths).toBe(0)
    expect(merged.added).toBe(2)
  })

  test("leaves an up to date environment unchanged", () => {
    const current = { PATH: "C:\\Windows;D:\\Tools\\gh\\bin", HOME: "C:\\Users\\dev" }
    const merged = mergeWindowsEnvironment(current, {
      machine: { Path: "C:\\Windows" },
      user: { Path: "d:\\tools\\gh\\bin\\", home: "C:\\Users\\other" },
    })

    expect(merged.variables).toEqual(current)
    expect(merged.paths).toBe(0)
    expect(merged.added).toBe(0)
  })
})
