import assert from "node:assert/strict"
import { Service } from "@opencode/client/service"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const binary = process.env.OPENCODE_NIX_CLI
const version = process.env.OPENCODE_NIX_VERSION
assert.ok(binary)
assert.ok(version)

const settings = { disabled: true, port: 43123, password: "private", env: { NIX_UPGRADE: "preserved" } }
const hashed = "service-f6c433acac2a27cc06a0625896fe3e540a275ac9.json"
const environment = (root: string) => ({
  ...process.env,
  HOME: root,
  XDG_CONFIG_HOME: path.join(root, "config"),
  XDG_DATA_HOME: path.join(root, "data"),
  XDG_STATE_HOME: path.join(root, "state"),
  XDG_CACHE_HOME: path.join(root, "cache"),
  OPENCODE_CONFIG_DIR: undefined,
})
const get = (env: ReturnType<typeof environment>) => {
  const result = Bun.spawnSync([binary, "service", "get"], {
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  assert.equal(result.exitCode, 0, result.stderr.toString())
  return JSON.parse(result.stdout.toString())
}
for (const sample of [
  { name: "hashed", sources: { [hashed]: settings }, expected: settings },
  {
    name: "named precedence",
    sources: { "service-prod.json": settings, [hashed]: { ...settings, port: 43124 } },
    expected: settings,
  },
  {
    name: "invalid named fallback",
    sources: { "service-prod.json": { port: 70000 }, [hashed]: settings },
    expected: settings,
  },
  {
    name: "shared precedence",
    sources: { "service.json": { ...settings, port: 43125 }, "service-prod.json": settings, [hashed]: settings },
    expected: { ...settings, port: 43125 },
  },
  {
    name: "legacy remote",
    sources: { [hashed]: { ...settings, remote: true } },
    expected: { ...settings, remote: {} },
  },
]) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-nix-settings-"))
  const env = environment(root)
  const shared = path.join(root, "config", "opencode", "service.json")
  try {
    for (const entry of Object.entries(sample.sources)) {
      await Bun.write(path.join(root, "config", "opencode", entry[0]), JSON.stringify(entry[1]))
    }
    const expected = Object.fromEntries(Object.entries(sample.expected).filter((entry) => entry[0] !== "password"))
    assert.deepEqual(get(env), expected)
    const stored = await Bun.file(shared).json()
    assert.equal(stored.password, sample.expected.password)
    for (const entry of Object.entries(sample.sources)) {
      assert.deepEqual(await Bun.file(path.join(root, "config", "opencode", entry[0])).json(), entry[1])
    }
    await Bun.write(path.join(root, "config", "opencode", hashed), JSON.stringify({ port: 43126 }))
    assert.deepEqual(get(env), expected)
    assert.deepEqual(await Bun.file(shared).json(), stored)
    console.log(`Nix prod settings: ${sample.name}; source preservation and idempotence verified`)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
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
const env = environment(upgrade)
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
    assert.equal(
      (await Bun.file(path.join(upgrade, "state", "opencode", "service.json")).json()).pid,
      explicit.child.pid,
    )
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

const hostname = process.platform === "linux" ? "127.0.0.2" : "localhost"
for (const sample of [
  { name: "saved port", config: { port: 43123 }, source: "service-prod.json", reuse: false },
  { name: "saved hostname and port", config: { hostname, port: 43124 }, source: hashed, reuse: false },
  { name: "saved hostname", config: { hostname }, source: "service-prod.json", reuse: false },
  { name: "matching saved port", config: {}, source: "service-prod.json", reuse: true },
]) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-nix-listener-"))
  const env = environment(root)
  const lease = path.join(root, "state", "opencode", "service.json")
  const old = await start(env)
  const controller = new AbortController()
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)])
  let oldExited = false
  void old.child.exited.then(() => {
    oldExited = true
  })
  const config: { hostname?: string; port?: number } = sample.reuse
    ? { port: Number(new URL(old.url).port) }
    : sample.config
  try {
    await fs.rename(lease, path.join(root, "state", "opencode", sample.source))
    await Bun.write(path.join(root, "config", "opencode", "service.json"), JSON.stringify(config))
    const ready = (async () => {
      while (!signal.aborted) {
        const endpoint = await Service.discover({ file: lease, version })
        if (endpoint && (sample.reuse || endpoint.url !== old.url)) {
          if (!sample.reuse) assert.ok(oldExited, "Successor became ready before its predecessor exited")
          return endpoint
        }
        await Bun.sleep(10)
      }
      throw signal.reason
    })()
    const contender = Bun.spawn([binary, "serve", "--service"], {
      env,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "pipe",
      signal,
    })
    const stderr = new Response(contender.stderr).text()
    try {
      const result = await Promise.all([ready, contender.exited])
      assert.equal(result[1], 0, await stderr)
      const current = await Bun.file(lease).json()
      assert.equal(current.pid === old.child.pid, sample.reuse)
      const address = new URL(result[0].url)
      if (config.port !== undefined) assert.equal(Number(address.port), config.port)
      if (config.hostname !== undefined) address.hostname = config.hostname
      const info = await fetch(new URL("/api/info", address), {
        headers: Service.headers(result[0]),
        signal: AbortSignal.timeout(5_000),
      }).then((response) => response.json())
      assert.equal(info.pid, current.pid)
      console.log(
        `Nix listener: ${sample.name}; ${sample.reuse ? "incumbent retained" : "single-owner replacement verified"}`,
      )
    } finally {
      controller.abort()
      contender.kill()
      await contender.exited
    }
  } finally {
    controller.abort()
    // Reap the reused child while stop waits for its PID to disappear.
    const stopped = Bun.spawn([binary, "service", "stop"], {
      env,
      stdout: "ignore",
      stderr: "pipe",
      signal: AbortSignal.timeout(30_000),
    })
    const stderr = new Response(stopped.stderr).text()
    const exit = await stopped.exited
    old.child.kill()
    await old.child.exited
    await fs.rm(root, { recursive: true, force: true })
    assert.equal(exit, 0, await stderr)
  }
}
