import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { getInstallId } from "../src/install_id.ts"

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-telemetry-installid-"))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
})

describe("getInstallId", () => {
  test("first call generates a UUIDv4 and writes the file", async () => {
    const id = await getInstallId({ dir: tmpDir })
    expect(id).toMatch(UUID_V4_RE)

    const onDisk = await fs.readFile(path.join(tmpDir, "install_id"), "utf8")
    expect(onDisk.trim()).toBe(id)
  })

  test("written file has mode 0600 (POSIX only)", async () => {
    if (process.platform === "win32") {
      // chmod is best-effort on Windows; skip the assertion.
      return
    }
    await getInstallId({ dir: tmpDir })
    const stat = await fs.stat(path.join(tmpDir, "install_id"))
    // Mask the lower 9 perm bits.
    const mode = stat.mode & 0o777
    expect(mode).toBe(0o600)
  })

  test("second call returns the same UUID", async () => {
    const a = await getInstallId({ dir: tmpDir })
    const b = await getInstallId({ dir: tmpDir })
    expect(a).toBe(b)
  })

  test("corrupted file is regenerated as a new UUID", async () => {
    await fs.mkdir(tmpDir, { recursive: true })
    await fs.writeFile(path.join(tmpDir, "install_id"), "not-a-uuid-at-all")
    const id = await getInstallId({ dir: tmpDir })
    expect(id).toMatch(UUID_V4_RE)
    expect(id).not.toBe("not-a-uuid-at-all")

    const onDisk = await fs.readFile(path.join(tmpDir, "install_id"), "utf8")
    expect(onDisk.trim()).toBe(id)
  })

  test("creates parent directory if it does not exist", async () => {
    const nested = path.join(tmpDir, "deep", "nested", "dir")
    const id = await getInstallId({ dir: nested })
    expect(id).toMatch(UUID_V4_RE)
    const onDisk = await fs.readFile(path.join(nested, "install_id"), "utf8")
    expect(onDisk.trim()).toBe(id)
  })
})
