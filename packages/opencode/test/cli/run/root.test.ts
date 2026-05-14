import { expect, spyOn, test } from "bun:test"
import { mkdtemp, rm } from "fs/promises"
import os from "os"
import path from "path"
import { resolveRunRoot } from "@/cli/cmd/run"
import { Filesystem } from "@/util/filesystem"

test("run root uses process cwd instead of stale PWD", async () => {
  const stale = await mkdtemp(path.join(os.tmpdir(), "opencode-run-stale-"))
  const target = await mkdtemp(path.join(os.tmpdir(), "opencode-run-target-"))
  const originalPwd = process.env.PWD
  const cwd = spyOn(process, "cwd").mockImplementation(() => target)

  try {
    process.env.PWD = stale

    expect(resolveRunRoot()).toBe(Filesystem.resolve(target))
  } finally {
    cwd.mockRestore()
    if (originalPwd === undefined) {
      delete process.env.PWD
    } else {
      process.env.PWD = originalPwd
    }
    await rm(stale, { recursive: true, force: true })
    await rm(target, { recursive: true, force: true })
  }
})
