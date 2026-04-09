import { describe, test, expect } from "bun:test"
import { readFileSync } from "fs"
import { resolve } from "path"
import path from "path"

const bashSrc = readFileSync(resolve(import.meta.dir, "../../src/tool/bash.ts"), "utf-8")

describe("shellEnv PATH composition", () => {
  // Regression: plugin PATH entries via shell.env hook used to stomp the
  // system PATH entirely (via spread ...extra.env). Commands like `ls` and
  // `git` broke because /usr/bin was gone. The fix extracts plugin PATH
  // before spreading, then prepends it to process.env.PATH.

  test("extracts PATH from plugin env before spreading", () => {
    // The fix must extract PATH, delete it, then compose
    expect(bashSrc).toContain("const paths = env.PATH")
    expect(bashSrc).toContain("delete env.PATH")
  })

  test("prepends plugin PATH to system PATH with delimiter", () => {
    // Must use path.delimiter for cross-platform support (: on Unix, ; on Windows)
    expect(bashSrc).toContain("path.delimiter")
    // Must reference process.env.PATH to preserve system PATH
    expect(bashSrc).toContain("process.env.PATH")
  })

  test("does not stomp system PATH when plugin provides PATH", () => {
    // The old bug: ...extra.env would overwrite process.env.PATH
    // The fix: spread env (without PATH), then compose PATH separately
    const shellEnvMatch = bashSrc.match(/async function shellEnv[\s\S]*?^}/m)
    expect(shellEnvMatch).not.toBeNull()
    const body = shellEnvMatch![0]

    // The return object must NOT spread ...extra.env directly (the old bug).
    // It's fine in a copy (`{ ...extra.env }`) — the key is the return spreads
    // the sanitized `...env` (with PATH removed) instead.
    const returnMatch = body.match(/return \{[\s\S]*\}/)
    expect(returnMatch).not.toBeNull()
    expect(returnMatch![0]).not.toContain("...extra.env")

    // Must spread the sanitized env (PATH removed)
    expect(returnMatch![0]).toContain("...env")
    // Must compose PATH in a separate spread
    expect(body).toMatch(/paths && \{.*PATH:/)
  })

  test("handles empty plugin PATH (no PATH override)", () => {
    // When plugin doesn't set PATH, paths === "" which is falsy,
    // so the conditional spread is skipped and system PATH from
    // ...process.env is preserved.
    const shellEnvMatch = bashSrc.match(/async function shellEnv[\s\S]*?^}/m)
    expect(shellEnvMatch).not.toBeNull()
    const body = shellEnvMatch![0]

    // The conditional must use a truthy check on paths
    expect(body).toMatch(/paths && \{/)
  })

  // Verify the composition formula is correct
  test("composition formula: plugin PATH + delimiter + system PATH", () => {
    // The composed PATH must be: `${pluginPath}${delimiter}${systemPath}`
    // This ensures plugin binaries are found first, system commands still work
    expect(bashSrc).toMatch(/`\$\{paths\}\$\{path\.delimiter\}\$\{process\.env\.PATH \?\? ""\}`/)
  })
})
