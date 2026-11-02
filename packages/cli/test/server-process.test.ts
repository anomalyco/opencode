import { expect, test } from "bun:test"
import path from "node:path"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { isolatedEnv } from "./fixture/environment"

test("server startup loads its options schema and rejects invalid sandbox settings", async () => {
  await using root = await tmpdir("opencode-cli-server-options-")
  await Bun.write(path.join(root.path, "config", "opencode.jsonc"), '{ "experimental": { "sandbox": { "enabled": "invalid" } } }')
  const child = Bun.spawn([process.execPath, "src/index.ts", "serve", "--stdio", "--port", "0"], {
    cwd: path.join(import.meta.dir, ".."),
    env: isolatedEnv(root.path),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stderr, stdout, code] = await Promise.all([
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
    child.exited,
  ])
  // Exercise the actual CLI package's dependency resolution before any listener is opened.
  expect(stderr).toContain('Expected boolean')
  expect(stderr).toContain('["enabled"]')
  expect(stdout).toBe("")
  expect(code).toBe(1)
})

test.skipIf(process.platform !== "darwin")(
  "invalid sandbox roots abort real stdio-server startup without reporting readiness",
  async () => {
    await using root = await tmpdir("opencode-cli-server-sandbox-")
    await Bun.write(path.join(root.path, "config", "opencode.json"), JSON.stringify({ experimental: { sandbox: { enabled: true, readable_roots: ["relative-root"] } } }))
    const child = Bun.spawn([process.execPath, "src/index.ts", "serve", "--stdio", "--port", "0"], {
      cwd: path.join(import.meta.dir, ".."),
      env: isolatedEnv(root.path),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stderr, stdout, code] = await Promise.all([
      new Response(child.stderr).text(),
      new Response(child.stdout).text(),
      child.exited,
    ])
    expect(stderr).toContain("Invalid sandbox roots")
    expect(stdout).toBe("")
    expect(code).toBe(1)
  },
)
