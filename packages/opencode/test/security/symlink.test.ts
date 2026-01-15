import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import os from "os"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { File } from "../../src/file"

describe("security", () => {
  test("prevents reading files outside project via symlink", async () => {
    // Create a "secret" file outside the project
    const secretDir = path.join(os.tmpdir(), "secret-" + Math.random().toString(36).slice(2))
    await fs.mkdir(secretDir, { recursive: true })
    const secretFile = path.join(secretDir, "passwd")
    await Bun.write(secretFile, "secret-data")

    try {
      await using tmp = await tmpdir({
        init: async (dir) => {
          // Create a symlink to the secret file
          await fs.symlink(secretFile, path.join(dir, "link-to-secret"))
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          // Try to read the symlink
          // This should FAIL (throw error) if security check works
          // We expect "Access denied: path escapes project directory"
          try {
             await File.read("link-to-secret")
             // If we get here, it failed to throw
             throw new Error("Security check failed: File.read succeeded but should have failed")
          } catch (err: any) {
             expect(err.message).toContain("Access denied")
          }
        },
      })
    } finally {
      // Clean up secret dir
      await fs.rm(secretDir, { recursive: true, force: true })
    }
  })
})
