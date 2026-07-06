import { expect, test } from "bun:test"
import path from "node:path"

test("standalone server exits when its owner is killed", async () => {
  const owner = Bun.spawn([process.execPath, path.join(import.meta.dir, "fixture/standalone-owner.ts")], {
    cwd: path.join(import.meta.dir, ".."),
    env: { ...process.env, OPENCODE_SERVER_USERNAME: "custom" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const line = await Promise.race([readLine(owner.stdout), Bun.sleep(10_000).then(() => undefined)])
  const [rawPID, url, status] = line?.split(" ") ?? []
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
    if (running(pid)) process.kill(pid, "SIGKILL")
  }
})

async function readLine(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  const chunks: string[] = []
  while (true) {
    const result = await reader.read()
    if (result.done) break
    chunks.push(decoder.decode(result.value, { stream: true }))
    const output = chunks.join("")
    const newline = output.indexOf("\n")
    if (newline !== -1) {
      reader.releaseLock()
      return output.slice(0, newline)
    }
  }
  reader.releaseLock()
  return chunks.join("") + decoder.decode()
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
