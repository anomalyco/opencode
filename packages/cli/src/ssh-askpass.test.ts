import { expect, test } from "bun:test"
import { createServer } from "node:net"
import path from "node:path"

test("the executable askpass branch returns only the response, without CLI output", async () => {
  const requests: string[] = []
  const server = createServer((socket) => {
    socket.once("data", (data: Buffer) => {
      requests.push(data.toString())
      socket.end(JSON.stringify({ value: 'passphrase"with spaces' }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("missing listener")
  try {
    const child = Bun.spawn([process.execPath, path.join(import.meta.dir, "index.ts"), "Enter passphrase:"], {
      env: {
        ...process.env,
        OPENCODE_SSH_ASKPASS_PORT: String(address.port),
        OPENCODE_SSH_ASKPASS_TOKEN: "fixture",
        SSH_ASKPASS_PROMPT: "confirm",
      },
      stdout: "pipe",
      stderr: "pipe",
    })
    expect(await new Response(child.stdout).text()).toBe('passphrase"with spaces\n')
    expect(await child.exited).toBe(0)
    expect(requests.map((request) => JSON.parse(request))).toEqual([
      { token: "fixture", text: "Enter passphrase:", pid: process.pid, confirm: true },
    ])
    expect(await new Response(child.stderr).text()).toBe("")
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}, 30_000)

test("a response split inside a multi-byte character is written intact", async () => {
  const response = Buffer.from(JSON.stringify({ value: "pässwörd" }))
  // Split between the two bytes of "ä" so the helper reads them separately.
  const split = response.indexOf(0xc3) + 1
  const server = createServer((socket) => {
    socket.setNoDelay(true)
    socket.once("data", () => {
      socket.write(response.subarray(0, split))
      setTimeout(() => socket.end(response.subarray(split)), 50)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("missing listener")
  try {
    const child = Bun.spawn([process.execPath, path.join(import.meta.dir, "index.ts"), "Enter passphrase:"], {
      env: { ...process.env, OPENCODE_SSH_ASKPASS_PORT: String(address.port), OPENCODE_SSH_ASKPASS_TOKEN: "fixture" },
      stdout: "pipe",
      stderr: "pipe",
    })
    expect(await new Response(child.stdout).text()).toBe("pässwörd\n")
    expect(await child.exited).toBe(0)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}, 30_000)
