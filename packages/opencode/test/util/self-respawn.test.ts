import { describe, expect, test } from "bun:test"
import { selfDisplayName, selfRespawnArgv } from "../../src/util/self-respawn"

describe("selfRespawnArgv", () => {
  test("compiled binary mode returns [binaryPath] only", () => {
    expect(selfRespawnArgv(["/usr/local/bin/opencode", "pr", "123"])).toEqual(["/usr/local/bin/opencode"])
  })

  test("compiled binary mode works for renamed / aliased binaries", () => {
    // Symlink, canary build, downstream rename — selfRespawnArgv should
    // honour whatever process.argv[0] resolves to at invocation time.
    expect(selfRespawnArgv(["/usr/local/bin/opencode-canary", "pr", "123"])).toEqual([
      "/usr/local/bin/opencode-canary",
    ])
    expect(selfRespawnArgv(["/Users/x/.local/bin/oc", "pr", "123"])).toEqual(["/Users/x/.local/bin/oc"])
  })

  test("bun-run mode returns [bunPath, scriptPath]", () => {
    expect(selfRespawnArgv(["/Users/x/.bun/bin/bun", "/repo/src/index.ts", "pr", "123"])).toEqual([
      "/Users/x/.bun/bin/bun",
      "/repo/src/index.ts",
    ])
  })

  test("bun-run mode handles bun-debug / bun-canary distros", () => {
    expect(selfRespawnArgv(["/Users/x/.bun/bin/bun-debug", "/repo/src/index.ts"])).toEqual([
      "/Users/x/.bun/bin/bun-debug",
      "/repo/src/index.ts",
    ])
  })

  test("bun-run mode handles bun.exe on Windows", () => {
    expect(selfRespawnArgv(["C:\\Tools\\bun.exe", "C:\\repo\\src\\index.ts"])).toEqual([
      "C:\\Tools\\bun.exe",
      "C:\\repo\\src\\index.ts",
    ])
  })

  test("does not match binaries that merely contain 'bun'", () => {
    // Defensive: a hypothetical `tribune` binary should not be treated as Bun.
    expect(selfRespawnArgv(["/usr/local/bin/tribune", "pr", "123"])).toEqual(["/usr/local/bin/tribune"])
  })

  test("throws when argv[0] is missing", () => {
    expect(() => selfRespawnArgv([])).toThrow(/argv\[0\] is missing/)
  })

  test("throws when bun runtime detected but argv[1] is missing", () => {
    expect(() => selfRespawnArgv(["/usr/local/bin/bun"])).toThrow(/argv\[1\].*missing/)
  })
})

describe("selfDisplayName", () => {
  test("returns binary basename for compiled binaries", () => {
    expect(selfDisplayName(["/usr/local/bin/opencode"])).toBe("opencode")
    expect(selfDisplayName(["/usr/local/bin/opencode-canary"])).toBe("opencode-canary")
  })

  test("returns 'bun' under bun-run mode", () => {
    expect(selfDisplayName(["/Users/x/.bun/bin/bun", "/repo/src/index.ts"])).toBe("bun")
  })

  test("returns 'bun.exe' under bun-run mode on Windows", () => {
    expect(selfDisplayName(["C:\\Tools\\bun.exe"])).toBe("bun.exe")
  })

  test("falls back to 'opencode' when argv[0] is missing", () => {
    expect(selfDisplayName([])).toBe("opencode")
  })
})
