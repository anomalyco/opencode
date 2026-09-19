import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { isolatedEnv } from "./fixture/environment"

// sst-dev.opencode-v2 waits for this exact prefix and never sends credentials.
const LISTENING = "opencode server listening"

test("foreground serve prints the VS Code listening marker and stays unauthenticated", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-cli-serve-startup-"))
  const env = isolatedEnv(root, { OPENCODE_PASSWORD: undefined, OPENCODE_SERVER_PASSWORD: undefined })
  const proc = Bun.spawn([process.execPath, path.join(import.meta.dir, "../src/index.ts"), "serve", "--port", "0"], {
    cwd: path.join(import.meta.dir, ".."),
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })

  try {
    const line = await readListening(proc.stdout)
    expect(line.startsWith(LISTENING)).toBe(true)
    const match = line.match(/on\s+(https?:\/\/[^\s]+)/)
    expect(match?.[1]).toBeDefined()

    const url = match![1]!
    const response = await fetch(new URL("/api/info", url))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ pid: expect.any(Number) })
  } finally {
    proc.kill("SIGTERM")
    await proc.exited
    await fs.rm(root, { recursive: true, force: true })
  }
}, 30_000)

test("empty OPENCODE_SERVER_PASSWORD disables auth", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-cli-serve-empty-password-"))
  const proc = Bun.spawn([process.execPath, path.join(import.meta.dir, "../src/index.ts"), "serve", "--port", "0"], {
    cwd: path.join(import.meta.dir, ".."),
    env: isolatedEnv(root, { OPENCODE_PASSWORD: "", OPENCODE_SERVER_PASSWORD: "" }),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })

  try {
    const line = await readListening(proc.stdout)
    const url = line.match(/on\s+(https?:\/\/[^\s]+)/)?.[1]
    expect(url).toBeDefined()
    expect((await fetch(new URL("/api/info", url!))).status).toBe(200)
  } finally {
    proc.kill("SIGTERM")
    await proc.exited
    await fs.rm(root, { recursive: true, force: true })
  }
}, 30_000)

test("configured OPENCODE_SERVER_PASSWORD still requires basic auth", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-cli-serve-password-"))
  const proc = Bun.spawn([process.execPath, path.join(import.meta.dir, "../src/index.ts"), "serve", "--port", "0"], {
    cwd: path.join(import.meta.dir, ".."),
    env: isolatedEnv(root, { OPENCODE_SERVER_PASSWORD: "secret" }),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })

  try {
    const line = await readListening(proc.stdout)
    const url = line.match(/on\s+(https?:\/\/[^\s]+)/)?.[1]
    expect(url).toBeDefined()
    expect((await fetch(new URL("/api/info", url!))).status).toBe(401)
    expect(
      (
        await fetch(new URL("/api/info", url!), {
          headers: { authorization: `Basic ${btoa("opencode:secret")}` },
        })
      ).status,
    ).toBe(200)
  } finally {
    proc.kill("SIGTERM")
    await proc.exited
    await fs.rm(root, { recursive: true, force: true })
  }
}, 30_000)

async function readListening(stream: ReadableStream<Uint8Array>, timeoutMs = 15_000) {
  const line = await Promise.race([
    readLine(stream, LISTENING),
    Bun.sleep(timeoutMs).then(() => undefined),
  ])
  if (!line) throw new Error(`Timed out waiting for "${LISTENING}"`)
  return line
}

async function readLine(stream: ReadableStream<Uint8Array>, prefix: string) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  const chunks: string[] = []
  while (true) {
    const result = await reader.read()
    if (result.done) break
    chunks.push(decoder.decode(result.value, { stream: true }))
    const line = chunks.join("").split("\n").find((line) => line.startsWith(prefix))
    if (line) {
      reader.releaseLock()
      return line
    }
  }
  reader.releaseLock()
  return (chunks.join("") + decoder.decode()).split("\n").find((line) => line.startsWith(prefix))
}
