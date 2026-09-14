import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { isolatedEnv } from "./fixture/environment"

test("standalone server exits when its owner is killed", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-cli-standalone-"))
  const owner = Bun.spawn([process.execPath, path.join(import.meta.dir, "fixture/standalone-owner.ts")], {
    cwd: path.join(import.meta.dir, ".."),
    env: isolatedEnv(root, { OPENCODE_SERVER_USERNAME: "custom" }),
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
    await fs.rm(root, { recursive: true, force: true })
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
