import { expect, test } from "bun:test"
import { Effect } from "effect"
import path from "node:path"
import { SandboxConfig } from "../src/services/sandbox-config"
import { tmpdir } from "./fixture/tmpdir"

test("reads and merges sandbox options from global JSONC files", async () => {
  await using root = await tmpdir()
  await Bun.write(path.join(root.path, "opencode.json"), JSON.stringify({ experimental: { sandbox: { enabled: true, readable_roots: ["/usr"] } } }))
  await Bun.write(path.join(root.path, "opencode.jsonc"), '{ // user preference\n "experimental": { "sandbox": { "approval": "never", "full_disk_read": true, }, }, }')
  expect(await Effect.runPromise(SandboxConfig.read(root.path))).toEqual({
    enabled: true,
    readable_roots: ["/usr"],
    approval: "never",
    full_disk_read: true,
  })
})

test("invalid global sandbox configuration fails startup", async () => {
  await using root = await tmpdir()
  for (const sandbox of [{ enabled: "invalid" }, { readable_roots: "not-an-array" }, { full_disk_reads: true }]) {
    await Bun.write(path.join(root.path, "opencode.json"), JSON.stringify({ experimental: { sandbox } }))
    await expect(Effect.runPromise(SandboxConfig.read(root.path))).rejects.toThrow("Unable to read sandbox configuration")
  }
})


test("malformed global configuration fails instead of silently disabling the sandbox", async () => {
  await using root = await tmpdir()
  await Bun.write(path.join(root.path, "opencode.jsonc"), '{ "experimental": { "sandbox": { "enabled": true }')
  await expect(Effect.runPromise(SandboxConfig.read(root.path))).rejects.toThrow("Invalid global configuration")
})
