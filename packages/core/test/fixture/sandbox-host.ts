import fs from "node:fs/promises"
import path from "node:path"
import { SandboxBackend } from "../../src/sandbox/backend"
import { tmpdir } from "./tmpdir"

export function hasPosixSandboxFixtures() {
  switch (process.platform) {
    case "darwin":
    case "linux":
      return true
    default:
      return false
  }
}

export async function sandboxHost(root: string) {
  const host = {
    directory: path.join(root, "workspace"),
    scratch: path.join(root, "scratch"),
    home: path.join(root, "home"),
    config: path.join(root, "config"),
    data: path.join(root, "data"),
    state: path.join(root, "state"),
  }
  await Promise.all(Object.values(host).map((directory) => fs.mkdir(directory)))
  return host
}

async function detectSandbox() {
  try {
    const backend = await SandboxBackend.select(process.platform, {})
    await using temporary = await tmpdir("opencode-sandbox-probe-")
    const host = await sandboxHost(temporary.path)
    const policy = await backend.policy(host, {})
    const launch = await backend.probe(policy)
    const result = Bun.spawnSync([launch.command, ...launch.args], {
      cwd: host.directory,
      env: launch.env,
      timeout: 5_000,
    })
    if (result.exitCode !== 0) throw new Error(result.stderr.toString().trim() || `probe exited ${result.exitCode}`)
    return backend
  } catch (error) {
    if (process.env.OPENCODE_SANDBOX_TEST_REQUIRED === "1") throw error
    console.warn(`Native sandbox tests unavailable: ${error}`)
  }
}

let detection: ReturnType<typeof detectSandbox> | undefined
export function nativeSandbox() {
  return (detection ??= detectSandbox())
}
