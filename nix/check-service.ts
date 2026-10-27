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
const transpiler = path.join(process.env.XDG_CACHE_HOME ?? os.tmpdir(), "opencode-nix-service-transpiler")
const environment = (root: string) => ({
  ...process.env,
  HOME: root,
  XDG_CONFIG_HOME: path.join(root, "config"),
  XDG_DATA_HOME: path.join(root, "data"),
  XDG_STATE_HOME: path.join(root, "state"),
  XDG_CACHE_HOME: path.join(root, "cache"),
  OPENCODE_DB: path.join(root, "opencode.db"),
  BUN_RUNTIME_TRANSPILER_CACHE_PATH: transpiler,
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

async function start(env = process.env, flags = ["--port", "0"], legacy = false) {
  const command = legacy
    ? [
        process.execPath,
        "--define",
        'OPENCODE_CHANNEL:"prod"',
        "--define",
        `OPENCODE_VERSION:${JSON.stringify(version)}`,
        path.resolve("packages/cli/src/index.ts"),
      ]
    : [binary]
  const child = Bun.spawn([...command, "serve", "--service", ...flags], {
    cwd: legacy ? path.resolve("packages/cli") : undefined,
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

const published = await start()
try {
  const endpoint = await Service.discover({ version })
  assert.equal(endpoint?.url, published.url)
  assert.equal(endpoint?.auth?.type, "basic")
  console.log("Released CLI is discoverable through the Desktop client's default registration")
} finally {
  published.child.kill()
  await published.child.exited
}

const hostname = process.platform === "linux" ? "127.0.0.2" : "localhost"
for (const sample of [
  { name: "unconfigured listener", config: {}, flags: [], reuse: true },
  { name: "matching saved port", config: {}, flags: [], reuse: true, match: true },
  { name: "saved port", config: { port: 43123 }, flags: [], reuse: false },
  { name: "saved hostname and port", config: { hostname, port: 43124 }, flags: [], reuse: false },
  { name: "saved hostname", config: { hostname }, flags: [], reuse: false },
  { name: "explicit port", config: {}, flags: ["--port", "0"], reuse: false },
  { name: "explicit hostname", config: {}, flags: ["--hostname", hostname, "--port", "0"], reuse: false },
]) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-nix-listener-"))
  const env = environment(root)
  const lease = path.join(root, "state", "opencode", "service.json")
  // A real prod daemon watches its own lease; moving a latest daemon's lease cannot model this upgrade.
  const old = await start(env, ["--port", "0"], true)
  const config: { hostname?: string; port?: number } = sample.match
    ? { port: Number(new URL(old.url).port) }
    : sample.config
  try {
    await Bun.write(path.join(root, "config", "opencode", "service.json"), JSON.stringify(config))
    const status = Bun.spawnSync([binary, "service", "status"], { env, stdout: "pipe", stderr: "pipe" })
    assert.equal(status.exitCode, 0, status.stderr.toString())
    assert.equal(status.stdout.toString().trim(), old.url)

    if (sample.reuse) {
      const contender = Bun.spawn([binary, "serve", "--service", ...sample.flags], {
        env,
        stdin: "ignore",
        stdout: "ignore",
        stderr: "pipe",
        signal: AbortSignal.timeout(60_000),
      })
      const stderr = new Response(contender.stderr).text()
      assert.equal(await contender.exited, 0, await stderr)
      assert.equal(old.child.exitCode, null)
      assert.equal((await Bun.file(lease).json()).pid, old.child.pid)
    }
    if (!sample.reuse) {
      const successor = await start(env, sample.flags)
      try {
        assert.notEqual(old.child.exitCode, null, "Successor became ready before its predecessor exited")
        assert.equal(successor.child.exitCode, null)
        assert.equal((await Bun.file(lease).json()).pid, successor.child.pid)
        const endpoint = await Service.discover({ file: lease, version })
        assert.ok(endpoint)
        const address = new URL(endpoint.url)
        if (config.port !== undefined) assert.equal(Number(address.port), config.port)
        if (config.hostname !== undefined) address.hostname = config.hostname
        if (sample.flags.includes("--hostname")) address.hostname = hostname
        const info = await fetch(new URL("/api/info", address), {
          headers: Service.headers(endpoint),
          signal: AbortSignal.timeout(5_000),
        }).then((response) => response.json())
        assert.equal(info.pid, successor.child.pid)
        assert.equal(await Bun.file(lease + ".pty-handoff").exists(), false)
      } finally {
        successor.child.kill()
        await successor.child.exited
      }
    }
    console.log(
      `Nix listener: ${sample.name}; ${sample.reuse ? "incumbent retained" : "single-owner replacement verified"}`,
    )
  } finally {
    old.child.kill()
    await old.child.exited
    await fs.rm(root, { recursive: true, force: true })
  }
}
await fs.rm(transpiler, { recursive: true, force: true })
