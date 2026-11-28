import { expect, test } from "bun:test"
import { Effect } from "effect"
import path from "node:path"
import { SandboxConfig } from "../src/services/sandbox-config"
import { tmpdir } from "./fixture/tmpdir"

test("reads and merges sandbox options from global JSONC files", async () => {
  await using root = await tmpdir()
  await Bun.write(
    path.join(root.path, "opencode.json"),
    JSON.stringify({ experimental: { sandbox: { enabled: true, readable_roots: ["/usr"] } } }),
  )
  await Bun.write(
    path.join(root.path, "opencode.jsonc"),
    '{ // user preference\n "experimental": { "sandbox": { "full_disk_read": true, "allow_git_writes": true, "linux": { "binary": "/opt/bwrap" }, }, }, }',
  )
  expect(await Effect.runPromise(SandboxConfig.read(root.path))).toEqual({
    enabled: true,
    readable_roots: ["/usr"],
    full_disk_read: true,
    allow_git_writes: true,
    linux: { binary: "/opt/bwrap" },
  })
})

test("invalid sandbox settings matter only when the effective configuration enables the sandbox", async () => {
  await using root = await tmpdir()
  const json = path.join(root.path, "opencode.json")
  const jsonc = path.join(root.path, "opencode.jsonc")
  for (const sandbox of [{ readable_roots: "not-an-array" }, { full_disk_reads: true }, { linux: { binary: 123 } }]) {
    await Bun.write(json, JSON.stringify({ experimental: { sandbox } }))
    expect(await Effect.runPromise(SandboxConfig.read(root.path))).toEqual({})
    await Bun.write(jsonc, JSON.stringify({ experimental: { sandbox: { enabled: true } } }))
    await expect(Effect.runPromise(SandboxConfig.read(root.path))).rejects.toThrow(
      "Invalid enabled shell sandbox configuration",
    )
    await Bun.write(jsonc, JSON.stringify({ experimental: { sandbox: { enabled: false } } }))
  }
})

test("an invalid override cannot silently turn off the sandbox", async () => {
  await using root = await tmpdir()
  await Bun.write(path.join(root.path, "opencode.json"), '{"experimental":{"sandbox":{"enabled":true}}}')
  await Bun.write(path.join(root.path, "opencode.jsonc"), '{"experimental":{"sandbox":{"enabled":"false"}}}')
  await expect(Effect.runPromise(SandboxConfig.read(root.path))).rejects.toThrow(
    "Invalid enabled shell sandbox configuration",
  )
})

test("ignores malformed global configuration when it does not enable sandboxing", async () => {
  await using root = await tmpdir()
  await Bun.write(path.join(root.path, "opencode.jsonc"), '{ "theme": ')
  expect(await Effect.runPromise(SandboxConfig.read(root.path))).toEqual({})
})

test("malformed global configuration fails instead of silently disabling the sandbox", async () => {
  await using root = await tmpdir()
  await Bun.write(path.join(root.path, "opencode.jsonc"), '{ "experimental": { "sandbox": { "enabled": true }')
  await expect(Effect.runPromise(SandboxConfig.read(root.path))).rejects.toThrow("Invalid global configuration")
})
