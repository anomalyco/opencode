import { describe, expect, test } from "bun:test"
import path from "node:path"
import { isolatedEnv } from "./fixture/environment"
import { tmpdir } from "./fixture/tmpdir"

// Bun's spawn pipes are larger than an OS pipe and hide truncation, so output goes through a real
// pipe built by `sh`. https://github.com/anomalyco/opencode/issues/55525
async function sh(root: string, command: string) {
  const child = Bun.spawn(["sh", "-c", command], {
    env: { ...isolatedEnv(root), BUN: process.execPath, CLI: path.join(import.meta.dir, "../src/index.ts") },
    stdout: "pipe",
    stderr: "ignore",
  })
  const stdout = await new Response(child.stdout).text()
  return { stdout, exitCode: await child.exited }
}

describe.skipIf(process.platform === "win32")("cli output", () => {
  test("delivers output larger than a pipe buffer to a slow reader before exit", async () => {
    await using directory = await tmpdir()
    const file = await sh(directory.path, `"$BUN" "$CLI" --completions fish > "$HOME/fish" && cat "$HOME/fish"`)
    const piped = await sh(directory.path, `"$BUN" "$CLI" --completions fish | (sleep 2; cat)`)

    expect(Buffer.byteLength(file.stdout)).toBeGreaterThan(65536)
    expect(piped).toEqual({ stdout: file.stdout, exitCode: 0 })
  }, 60_000)

  test("prints short output and exits", async () => {
    await using directory = await tmpdir()
    const result = await sh(directory.path, `"$BUN" "$CLI" --version | cat`)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toStartWith("opencode ")
  }, 60_000)
})
