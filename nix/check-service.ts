import assert from "node:assert/strict"
import { Service } from "@opencode/client/service"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const binary = process.env.OPENCODE_NIX_CLI
const version = process.env.OPENCODE_NIX_VERSION
assert.ok(binary)
assert.ok(version)

const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-nix-upgrade-"))
const legacy = path.join(root, "config", "opencode", "service-prod.json")
const shared = path.join(root, "config", "opencode", "service.json")
const settings = { disabled: true, port: 43123, password: "private", env: { NIX_UPGRADE: "preserved" } }
const get = () => {
  const result = Bun.spawnSync([binary, "service", "get"], {
    env: {
      ...process.env,
      HOME: root,
      XDG_CONFIG_HOME: path.join(root, "config"),
      XDG_DATA_HOME: path.join(root, "data"),
      XDG_STATE_HOME: path.join(root, "state"),
      XDG_CACHE_HOME: path.join(root, "cache"),
      OPENCODE_CONFIG_DIR: undefined,
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  assert.equal(result.exitCode, 0, result.stderr.toString())
  return JSON.parse(result.stdout.toString())
}
try {
  await Bun.write(legacy, JSON.stringify(settings))
  assert.deepEqual(get(), { disabled: true, port: 43123, env: settings.env })
  assert.deepEqual(await Bun.file(shared).json(), settings)

  await Bun.write(legacy, JSON.stringify({ disabled: false, port: 43124 }))
  get()
  assert.deepEqual(await Bun.file(shared).json(), settings)

  await Bun.write(shared, JSON.stringify({ disabled: false, port: 43125 }))
  assert.deepEqual(get(), { disabled: false, port: 43125 })
  console.log("Nix prod settings migrate once; existing shared settings take precedence")
} finally {
  await fs.rm(root, { recursive: true, force: true })
}

async function start(env = process.env) {
  const child = Bun.spawn([binary, "serve", "--service", "--port", "0"], {
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    signal: AbortSignal.timeout(60_000),
  })
  const stderr = new Response(child.stderr).text()
  const stdout = child.stdout.getReader()
  const decoder = new TextDecoder()
  let url: string | undefined
  let buffer = ""
  try {
    while (!url) {
      const chunk = await stdout.read()
      if (chunk.done) throw new Error(`CLI exited before announcing its listener: ${await stderr}`)
      buffer += decoder.decode(chunk.value, { stream: true })
      url = /^server listening on ([^\r\n]+)\r?\n/m.exec(buffer)?.[1]
    }
    return { child, url }
  } finally {
    stdout.releaseLock()
    if (!url) {
      child.kill()
      await child.exited
    }
  }
}

const donor = await start()
const upgrade = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-nix-incumbent-"))
const env = {
  ...process.env,
  HOME: upgrade,
  XDG_CONFIG_HOME: path.join(upgrade, "config"),
  XDG_STATE_HOME: path.join(upgrade, "state"),
  XDG_DATA_HOME: path.join(upgrade, "data"),
  XDG_CACHE_HOME: path.join(upgrade, "cache"),
  OPENCODE_CONFIG_DIR: undefined,
}
try {
  const endpoint = await Service.discover({ version })
  assert.equal(endpoint?.url, donor.url)
  assert.equal(endpoint?.auth?.type, "basic")
  console.log("Released CLI is discoverable through the Desktop client's default registration")

  // Stage a real daemon's lease at the historical path; keep its original lease intact.
  const registration = await Bun.file(
    path.join(process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state"), "opencode", "service.json"),
  ).json()
  await Bun.write(path.join(upgrade, "state", "opencode", "service-prod.json"), JSON.stringify(registration))
  const status = Bun.spawnSync([binary, "service", "status"], { env, stdout: "pipe", stderr: "pipe" })
  assert.equal(status.exitCode, 0, status.stderr.toString())
  assert.equal(status.stdout.toString().trim(), donor.url)

  const contender = Bun.spawn([binary, "serve", "--service"], {
    env,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
    signal: AbortSignal.timeout(60_000),
  })
  const stderr = new Response(contender.stderr).text()
  try {
    assert.equal(await contender.exited, 0, await stderr)
    assert.equal((await Bun.file(path.join(upgrade, "state", "opencode", "service.json")).json()).pid, registration.pid)
    assert.ok(endpoint)
    const info = await fetch(`${donor.url}/api/info`, {
      headers: Service.headers(endpoint),
      signal: AbortSignal.timeout(5_000),
    }).then((response) => response.json())
    assert.equal(info.pid, registration.pid)
  } finally {
    contender.kill()
    await contender.exited
  }
  console.log("Migrated prod discovery reuses its live incumbent even after a prior status lookup")

  const explicit = await start(env)
  try {
    assert.notEqual(explicit.url, donor.url)
    assert.equal((await Bun.file(path.join(upgrade, "state", "opencode", "service.json")).json()).pid, explicit.child.pid)
  } finally {
    explicit.child.kill()
    await explicit.child.exited
  }
  console.log("Explicit port selection still starts the requested listener")
} finally {
  donor.child.kill()
  await donor.child.exited
  await fs.rm(upgrade, { recursive: true, force: true })
}
