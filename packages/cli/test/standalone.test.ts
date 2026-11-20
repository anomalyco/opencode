import { expect, test } from "bun:test"
import path from "node:path"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { isolatedEnv } from "./fixture/environment"

test("standalone server exits when its owner is killed", async () => {
  // Windows can hold the server's files briefly after it exits; the fixture retries removal on EBUSY.
  await using root = await tmpdir("opencode-cli-standalone-")
  const owner = Bun.spawn([process.execPath, path.join(import.meta.dir, "fixture/standalone-owner.ts")], {
    cwd: path.join(import.meta.dir, ".."),
    env: isolatedEnv(root.path, { OPENCODE_SERVER_USERNAME: "custom" }),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const line = await Promise.race([
    readLine(owner.stdout, "STANDALONE_READY "),
    Bun.sleep(10_000).then(() => undefined),
  ])
  const [, rawPID, url, status] = line?.split(" ") ?? []
  const pid = Number(rawPID)

  try {
    expect(pid).toBeGreaterThan(0)
    expect(url).toStartWith("http://127.0.0.1:")
    expect(status).toBe("200")
    expect(running(pid)).toBe(true)

    owner.kill("SIGKILL")
    await owner.exited

    expect(await waitForExit(pid)).toBe(true)
  } finally {
    owner.kill("SIGKILL")
    await owner.exited
    if (running(pid)) process.kill(pid, "SIGKILL")
  }
})

test("standalone reconnect reuses live children, replaces exited children, and honors explicit restart", async () => {
  await using root = await tmpdir("opencode-cli-standalone-recovery-")
  const owner = Bun.spawn([process.execPath, path.join(import.meta.dir, "fixture/standalone-recovery-owner.ts")], {
    cwd: path.join(import.meta.dir, ".."),
    env: isolatedEnv(root.path),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const line = await Promise.race([
    readLine(owner.stdout, "STANDALONE_RECOVERED "),
    Bun.sleep(30_000).then(() => undefined),
  ])
  const [, previous, live, replacement, reused, restarted, status] = line?.split(" ") ?? []
  const oldPID = Number(previous)
  const nextPID = Number(replacement)
  const pid = Number(restarted)

  try {
    expect(oldPID).toBeGreaterThan(0)
    expect(Number(live)).toBe(oldPID)
    expect(nextPID).toBeGreaterThan(0)
    expect(nextPID).not.toBe(oldPID)
    expect(Number(reused)).toBe(nextPID)
    expect(pid).toBeGreaterThan(0)
    expect(pid).not.toBe(nextPID)
    expect(status).toBe("200")
    expect(running(oldPID)).toBe(false)
    expect(running(nextPID)).toBe(false)
    expect(running(pid)).toBe(true)

    owner.kill("SIGKILL")
    await owner.exited
    expect(await waitForExit(pid)).toBe(true)
  } finally {
    owner.kill("SIGKILL")
    await owner.exited
    if (running(pid)) process.kill(pid, "SIGKILL")
  }
})

async function readLine(stream: ReadableStream<Uint8Array>, prefix: string) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  const chunks: string[] = []
  while (true) {
    const result = await reader.read()
    if (result.done) break
    chunks.push(decoder.decode(result.value, { stream: true }))
    const output = chunks.join("")
    const line = output.split("\n").find((line) => line.startsWith(prefix))
    if (line) {
      reader.releaseLock()
      return line
    }
  }
  reader.releaseLock()
  return (chunks.join("") + decoder.decode()).split("\n").find((line) => line.startsWith(prefix))
}

async function waitForExit(pid: number, attempts = 100): Promise<boolean> {
  if (!running(pid)) return true
  if (attempts === 0) return false
  await Bun.sleep(50)
  return waitForExit(pid, attempts - 1)
}

function running(pid: number) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
