import { describe, expect, test } from "bun:test"
import path from "path"
import { File } from "../../src/file"
import { Session } from "../../src/session"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("file.search external directories", () => {
  test("does not include external files without sessionID", async () => {
    await using outside = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "external-only.txt"), "outside")
      },
    })
    await using project = await tmpdir({ git: true })

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const result = await File.search({
          query: "external-only",
          type: "file",
          limit: 20,
        })

        expect(result.some((item) => item.includes("external-only.txt"))).toBe(false)
      },
    })
  })

  test("includes external files with sessionID permission", async () => {
    await using outside = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "external-match.txt"), "outside")
      },
    })
    await using project = await tmpdir({ git: true })

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const session = await Session.create({})
        await Session.addWorkspaceDirectory({
          sessionID: session.id,
          path: outside.path,
        })

        const result = await File.search({
          query: "external-match",
          type: "file",
          sessionID: session.id,
          limit: 20,
        })

        expect(result.some((item) => item.includes("external-match.txt"))).toBe(true)
      },
    })
  })

  test("ignores broad external_directory patterns", async () => {
    await using outside = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "broad-pattern.txt"), "outside")
      },
    })
    await using project = await tmpdir({ git: true })

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const session = await Session.create({})
        await Session.setPermission({
          sessionID: session.id,
          permission: [{ permission: "external_directory", pattern: "*", action: "allow" }],
        })

        const result = await File.search({
          query: "broad-pattern",
          type: "file",
          sessionID: session.id,
          limit: 20,
        })

        expect(result.some((item) => item.includes("broad-pattern.txt"))).toBe(false)
      },
    })
  })
})
