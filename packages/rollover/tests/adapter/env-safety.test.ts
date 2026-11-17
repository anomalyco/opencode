import { describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import path from "node:path"
import { checkEnv } from "../../scripts/check-env"

const FORK = path.resolve(import.meta.dirname, "../../../..")

describe("checkEnv", () => {
  test("fails when sandbox root is not under the rollover temp prefix", async () => {
    const r = await checkEnv({ sandboxRoot: path.join(homedir(), ".config"), forkRoot: FORK })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.failures.some((f) => f.includes("sandbox"))).toBe(true)
  })

  test("fails when sandbox root is the user home", async () => {
    const r = await checkEnv({ sandboxRoot: homedir(), forkRoot: FORK })
    expect(r.ok).toBe(false)
  })

  test("passes for a proper /tmp sandbox", async () => {
    const sandbox = await mkdtemp(path.join(tmpdir(), "opencode-rollover-test-"))
    const r = await checkEnv({ sandboxRoot: sandbox, forkRoot: FORK })
    expect(r.ok).toBe(true)
  })

  test("fails when forkRoot is not the fork (missing packages/cli)", async () => {
    const sandbox = await mkdtemp(path.join(tmpdir(), "opencode-rollover-test-"))
    const r = await checkEnv({ sandboxRoot: sandbox, forkRoot: sandbox })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.failures.some((f) => f.includes("fork"))).toBe(true)
  })

  test("flags a sandbox path that references the global desktop install", async () => {
    const sandbox = await mkdtemp(path.join(tmpdir(), "opencode-rollover-test-"))
    const r = await checkEnv({
      sandboxRoot: sandbox,
      forkRoot: FORK,
      // injected paths mimic a misconfigured env echoing the global CLI location
      extraPaths: [path.join(homedir(), "Library/Application Support/ai.opencode.desktop/cli")],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.failures.some((f) => f.includes("global"))).toBe(true)
  })
})
