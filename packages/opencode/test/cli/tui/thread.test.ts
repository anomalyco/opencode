import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../../fixture/fixture"
import { resolveThreadDirectory, resolveThreadTargetDirectory } from "../../../src/cli/cmd/tui/thread"

describe("tui thread", () => {
  async function check(project?: string) {
    await using tmp = await tmpdir({ git: true })
    const link = path.join(path.dirname(tmp.path), path.basename(tmp.path) + "-link")
    const type = process.platform === "win32" ? "junction" : "dir"

    try {
      await fs.symlink(tmp.path, link, type)
      expect(resolveThreadDirectory(project, link, tmp.path)).toBe(tmp.path)
    } finally {
      await fs.rm(link, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  test("uses the real cwd when PWD points at a symlink", async () => {
    await check()
  })

  test("uses the real cwd after resolving a relative project from PWD", async () => {
    await check(".")
  })

  test("resumed sessions without a project use the stored session directory", async () => {
    expect(
      await resolveThreadTargetDirectory({
        sessionID: "ses_123",
        envPWD: "/tmp/launch-link",
        cwd: "/tmp/launch",
        loadSession: async () => ({ directory: "/tmp/session" }),
        exists: async () => true,
      }),
    ).toBe("/tmp/session")
  })

  test("explicit project takes precedence over stored session directory", async () => {
    expect(
      await resolveThreadTargetDirectory({
        project: "project",
        sessionID: "ses_123",
        envPWD: "/tmp/launch",
        cwd: "/tmp/other",
        loadSession: async () => ({ directory: "/tmp/session" }),
        exists: async () => true,
      }),
    ).toBe("/tmp/launch/project")
  })

  test("resumed sessions fail fast when stored session directory is missing", async () => {
    await expect(
      resolveThreadTargetDirectory({
        sessionID: "ses_123",
        envPWD: "/tmp/launch",
        cwd: "/tmp/launch",
        loadSession: async () => ({ directory: "/tmp/missing" }),
        exists: async () => false,
      }),
    ).rejects.toThrow("Session directory not found: /tmp/missing")
  })
})
