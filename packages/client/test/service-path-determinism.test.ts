import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnServiceContender } from "../src/service-contender"
import { getDeterministicPath, resetDeterministicPathCache } from "../src/deterministic-env"

describe("service PATH determinism across reconnect election #38897", () => {
  test("spawnServiceContender PATH is deterministic regardless of client PATH", async () => {
    const originalPath = process.env.PATH ?? ""
    const dirWithCurl = await mkdtemp(join(tmpdir(), "opencode-path-with-"))
    const dirWithoutCurl = await mkdtemp(join(tmpdir(), "opencode-path-without-"))

    // Create a fake curl in dirWithCurl
    const fakeCurl = join(dirWithCurl, "curl")
    await writeFile(fakeCurl, "#!/bin/sh\necho fake-curl-found\n", { mode: 0o755 })

    const pathWith = `${dirWithCurl}:${originalPath}`
    const pathWithout = dirWithoutCurl // intentionally without curl and without original

    // Reset cache to ensure we probe fresh
    resetDeterministicPathCache()

    // First contender with PATH containing curl
    process.env.PATH = pathWith
    const file1 = join(tmpdir(), `opencode-path-test1-${Date.now()}`)
    const c1 = spawnServiceContender("sh", ["-c", `echo "$PATH" > "${file1}"`], {})
    // Wait for file to be written
    for (let i = 0; i < 50; i++) {
      if (await Bun.file(file1).exists()) break
      await Bun.sleep(10)
    }
    c1.release()
    c1.child.kill("SIGTERM")
    await Bun.sleep(10)
    const path1 = (await Bun.file(file1).text()).trim()

    // Second contender with PATH without curl
    process.env.PATH = pathWithout
    // Do not reset cache - should still use same deterministic PATH
    const file2 = join(tmpdir(), `opencode-path-test2-${Date.now()}`)
    const c2 = spawnServiceContender("sh", ["-c", `echo "$PATH" > "${file2}"`], {})
    for (let i = 0; i < 50; i++) {
      if (await Bun.file(file2).exists()) break
      await Bun.sleep(10)
    }
    c2.release()
    c2.child.kill("SIGTERM")
    await Bun.sleep(10)
    const path2 = (await Bun.file(file2).text()).trim()

    // Restore original PATH
    process.env.PATH = originalPath
    resetDeterministicPathCache()

    // Deterministic: both contenders should have same PATH, equal to login shell's PATH
    // (or fallback to original if probe unavailable). They must NOT reflect the client's
    // differing PATH values.
    expect(path1).toBe(path2)
    const deterministic = getDeterministicPath()
    if (deterministic !== undefined) {
      expect(path1).toBe(deterministic)
    }

    // Cleanup
    await rm(dirWithCurl, { recursive: true, force: true })
    await rm(dirWithoutCurl, { recursive: true, force: true })
    await rm(file1, { force: true })
    await rm(file2, { force: true })
  })

  test("repeated elections with different client PATHs do not flip curl resolution", async () => {
    const originalPath = process.env.PATH ?? ""
    const dirWithCurl = await mkdtemp(join(tmpdir(), "opencode-election-with-"))
    const dirWithoutCurl = await mkdtemp(join(tmpdir(), "opencode-election-without-"))

    // Use a unique fake command that is NOT in the system's PATH, so its presence
    // depends solely on whether the fake dir is in the service's PATH.
    const fakeName = `opencode-fake-cmd-${Date.now()}`
    const fakeCurl = join(dirWithCurl, fakeName)
    await writeFile(fakeCurl, "#!/bin/sh\nexit 0\n", { mode: 0o755 })

    const pathWith = `${dirWithCurl}:${originalPath}`
    const pathWithout = originalPath // without the fake curl dir

    resetDeterministicPathCache()
    const deterministic = getDeterministicPath()
    // Deterministic PATH should not contain the fake dir, so fake command always missing
    const expectedFound = deterministic !== undefined ? deterministic.includes(dirWithCurl) : false

    const results: boolean[] = []
    for (let i = 0; i < 10; i++) {
      // Simulate two concurrent clients with different PATHs racing to spawn
      // We do it sequentially but with alternating client PATHs to prove determinism
      process.env.PATH = i % 2 === 0 ? pathWith : pathWithout
      const outFile = join(tmpdir(), `opencode-election-${i}-${Date.now()}`)
      // Use spawnServiceContender directly to simulate contender spawn with current process.env
      const contender = spawnServiceContender("sh", ["-c", `if command -v ${fakeName} >/dev/null 2>&1; then echo found > "${outFile}"; else echo missing > "${outFile}"; fi`], {})
      for (let j = 0; j < 50; j++) {
        if (await Bun.file(outFile).exists()) break
        await Bun.sleep(10)
      }
      contender.release()
      contender.child.kill("SIGTERM")
      await Bun.sleep(10)
      const result = (await Bun.file(outFile).text()).trim()
      results.push(result === "found")
      await rm(outFile, { force: true })
    }

    process.env.PATH = originalPath
    resetDeterministicPathCache()

    const found = results.filter(Boolean).length
    const missing = results.length - found
    // Before fix: found 5 missing 5 (or 10/10 flipping). After fix: must be all found or all missing, never mixed
    expect(found === 0 || found === 10).toBe(true)
    expect(missing === 0 || missing === 10).toBe(true)
    // And it should match the deterministic expectation
    if (expectedFound) {
      expect(found).toBe(10)
    } else {
      expect(found).toBe(0)
    }

    await rm(dirWithCurl, { recursive: true, force: true })
    await rm(dirWithoutCurl, { recursive: true, force: true })
  })

  test("explicit env.PATH from caller is still respected (for tests)", async () => {
    const file = join(tmpdir(), `opencode-explicit-path-${Date.now()}`)
    const explicit = "/tmp/explicit-path-test:/usr/bin:/bin"
    const contender = spawnServiceContender("sh", ["-c", `echo "$PATH" > "${file}"`], { PATH: explicit })
    for (let i = 0; i < 50; i++) {
      if (await Bun.file(file).exists()) break
      await Bun.sleep(10)
    }
    contender.release()
    contender.child.kill("SIGTERM")
    await Bun.sleep(10)
    const path = (await Bun.file(file).text()).trim()
    expect(path).toBe(explicit)
    await rm(file, { force: true })
  })
})
