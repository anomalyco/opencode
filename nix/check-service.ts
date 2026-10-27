import assert from "node:assert/strict"
import { Service, type Endpoint } from "@opencode/client/service"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const binary = process.env.OPENCODE_NIX_CLI
const version = process.env.OPENCODE_NIX_VERSION
const shell = Bun.which("sh")
assert.ok(binary)
assert.ok(version)
assert.ok(shell)

const settings = { disabled: true, port: 43123, password: "private", env: { NIX_UPGRADE: "preserved" } }
const hashed = "service-f6c433acac2a27cc06a0625896fe3e540a275ac9.json"
const environment = (root: string) => ({
  ...Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  ),
  HOME: root,
  XDG_CONFIG_HOME: path.join(root, "config"),
  XDG_DATA_HOME: path.join(root, "data"),
  XDG_STATE_HOME: path.join(root, "state"),
  XDG_CACHE_HOME: path.join(root, "cache"),
  OPENCODE_DB: path.join(root, "opencode.db"),
  // The SDK merges this map over its own environment; omission does not clear host overrides.
  OPENCODE_CONFIG_DIR: path.join(root, "config", "opencode"),
  OPENCODE_PTY_BIN: "",
  OPENCODE_CONFIG_CONTENT: "{}",
  OPENCODE_CONFIG_PROJECT_DISABLE: "1",
  OPENCODE_DISABLE_MODELS_FETCH: "1",
})

for (const sample of [
  { name: "named", sources: { "service-prod.json": settings } },
  { name: "hashed", sources: { [hashed]: settings } },
  {
    name: "named precedence",
    sources: { "service-prod.json": settings, [hashed]: { ...settings, port: 43124 } },
  },
  {
    name: "shared isolation",
    sources: { "service-prod.json": settings, "service.json": { ...settings, port: 43125 } },
  },
]) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-nix-settings-"))
  try {
    const directory = path.join(root, "config", "opencode")
    await fs.mkdir(directory, { recursive: true })
    await Promise.all(
      Object.entries(sample.sources).map(([name, data]) =>
        fs.writeFile(path.join(directory, name), JSON.stringify(data)),
      ),
    )
    const result: Bun.ReadableSyncSubprocess = Bun.spawnSync([binary, "service", "get"], {
      env: environment(root),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    })
    assert.equal(result.exitCode, 0, result.stderr.toString())
    assert.deepEqual(JSON.parse(result.stdout.toString()), {
      disabled: settings.disabled,
      port: settings.port,
      env: settings.env,
    })
    assert.deepEqual(await Bun.file(path.join(directory, "service-prod.json")).json(), settings)
    for (const [name, data] of Object.entries(sample.sources))
      assert.deepEqual(await Bun.file(path.join(directory, name)).json(), data)
    console.log(`Nix prod settings: ${sample.name}; existing state preserved`)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}

{
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-nix-shipped-pty-"))
  const file = path.join(root, "state", "opencode", "service-prod.json")
  let endpoint: Endpoint | undefined
  try {
    endpoint = await Service.ensure({
      file,
      version,
      command: [binary, "serve", "--service", "--port", "0"],
      env: environment(root),
    })
    const terminal = await startTerminal(endpoint, root)
    assert.ok(terminal.pid > 0)
    assert.equal((await api(endpoint, "/api/info")).version, version)
    console.log("Nix compiled PTY: the shipped helper starts a real shell and produces its sentinel")
  } finally {
    try {
      if (endpoint) await api(endpoint, "/api/experimental/persistent-pty/shutdown", "POST")
    } finally {
      try {
        await Service.stop({ file, pty: "clear" })
      } finally {
        await fs.rm(root, { recursive: true, force: true })
      }
    }
  }
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-nix-upgrade-"))
const env = environment(root)
const file = path.join(root, "state", "opencode", "service-prod.json")
const legacyVersion = "0.0.0-prod-1"
const previous = Bun.spawn(
  [
    process.execPath,
    "--define",
    'OPENCODE_CHANNEL:"prod"',
    "--define",
    `OPENCODE_VERSION:${JSON.stringify(legacyVersion)}`,
    "src/index.ts",
    "serve",
    "--service",
    "--port",
    "0",
  ],
  {
    cwd: path.resolve("packages/cli"),
    env: { ...env, OPENCODE_PTY_BIN: process.env.OPENCODE_NIX_PTY },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    signal: AbortSignal.timeout(60_000),
  },
)
const stderr = new Response(previous.stderr).text()
const reader = previous.stdout.getReader()
let active: Endpoint | undefined
try {
  let output = ""
  while (!/^server listening on /m.test(output)) {
    const part = await reader.read()
    if (part.done) throw new Error(`Prod daemon exited before readiness: ${await stderr}`)
    output += new TextDecoder().decode(part.value)
  }
  const old = await Service.discover({ file, version: legacyVersion })
  assert.ok(old)
  active = old
  const terminal = await startTerminal(old, root)

  const current = await Service.ensure({ file, version, command: [binary, "serve", "--service", "--port", "0"], env })
  active = current
  await previous.exited
  assert.equal((await api(current, "/api/info")).version, version)
  assert.notEqual((await api(current, "/api/info")).pid, previous.pid)
  assert.deepEqual(
    (await api(current, "/api/experimental/session/ses_nix_terminal_handoff/terminal")).data.map(
      (item: { id: string; pid: number }) => ({ id: item.id, pid: item.pid }),
    ),
    [{ id: terminal.id, pid: terminal.pid }],
  )
  assert.ok(
    (await api(current, `/api/experimental/persistent-pty/${terminal.id}/snapshot`)).data.text.includes(
      "nix-preserved",
    ),
  )
  assert.deepEqual(
    (await api(current, `/api/experimental/persistent-pty/${terminal.id}`, "PUT", { size: { cols: 101, rows: 29 } }))
      .data.size,
    { cols: 101, rows: 29 },
  )
  assert.equal(await Bun.file(file + ".pty-handoff").exists(), false)
  assert.equal(await Bun.file(path.join(root, "state", "opencode", "service.json")).exists(), false)
  console.log(
    "Nix prod upgrade: normal client lifecycle preserves the shell, output and size without namespace migration",
  )
} finally {
  reader.releaseLock()
  try {
    if (active) await api(active, "/api/experimental/persistent-pty/shutdown", "POST")
  } finally {
    try {
      await Service.stop({ file, pty: "clear" })
    } finally {
      previous.kill()
      await previous.exited
      await fs.rm(root, { recursive: true, force: true })
    }
  }
}

async function startTerminal(endpoint: Endpoint, root: string) {
  const terminal = (
    await api(endpoint, "/api/experimental/session/ses_nix_terminal_handoff/terminal", "POST", {
      command: shell,
      args: ["-c", 'printf "nix-preserved\\n"; while IFS= read -r line; do printf "%s\\n" "$line"; done'],
      cwd: root,
      title: "Nix packaging check",
      env: {},
      size: { cols: 80, rows: 24 },
    })
  ).data
  const deadline = Date.now() + 10_000
  while (
    !(await api(endpoint, `/api/experimental/persistent-pty/${terminal.id}/snapshot`)).data.text.includes(
      "nix-preserved",
    )
  ) {
    assert.ok(Date.now() < deadline, "Persistent terminal did not produce its sentinel")
    await Bun.sleep(10)
  }
  return terminal
}

async function api(endpoint: Endpoint, route: string, method = "GET", body?: object) {
  const response = await fetch(new URL(route, endpoint.url), {
    method,
    headers: { ...Service.headers(endpoint), "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`${method} ${route}: ${response.status} ${await response.text()}`)
  return response.status === 204 ? undefined : response.json()
}
