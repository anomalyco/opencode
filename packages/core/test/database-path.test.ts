import { describe, expect, test } from "bun:test"
import path from "path"
import { Database } from "@opencode-ai/core/database/database"

const data = path.join("home", "data", "opencode")

describe("database path", () => {
  test("isolates the opencode2 preview from the stable database", () => {
    for (const executable of [path.join("usr", "local", "bin", "opencode2"), path.join("tmp", "opencode2.exe")]) {
      expect(Database.defaultPath({ data, channel: "latest", executable })).toBe(path.join(data, "opencode2.db"))
    }
  })

  test("keeps stable release channels on the production database", () => {
    for (const channel of ["latest", "beta", "prod"]) {
      expect(Database.defaultPath({ data, channel, executable: "/usr/local/bin/opencode" })).toBe(
        path.join(data, "opencode.db"),
      )
    }
  })

  test("keeps named preview channels isolated", () => {
    expect(Database.defaultPath({ data, channel: "feature/test", executable: "/usr/local/bin/opencode" })).toBe(
      path.join(data, "opencode-feature-test.db"),
    )
  })

  test("allows an explicit opt-in to the shared database", () => {
    expect(
      Database.defaultPath({
        data,
        channel: "latest",
        executable: "/usr/local/bin/opencode2",
        disableChannelDb: "true",
      }),
    ).toBe(path.join(data, "opencode.db"))
  })
})
