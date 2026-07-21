import { afterEach, describe, expect, test } from "bun:test"
import path from "node:path"

type Message = { readonly id?: number; readonly result?: unknown; readonly error?: unknown }
const children: Bun.Subprocess[] = []

afterEach(async () => {
  await Promise.all(
    children.splice(0).map(async (child) => {
      child.kill("SIGKILL")
      await child.exited
    }),
  )
})

describe("acp command", () => {
  test("is registered", async () => {
    const result = await cli(["--help"])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("acp        Start an Agent Client Protocol server")
  })

  test("initializes over ndjson and exits on stdin eof", async () => {
    const child = spawn()
    const stderr = new Response(child.stderr).text()
    await child.stdin.write(
      new TextEncoder().encode(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: 1,
            clientCapabilities: {},
            clientInfo: { name: "test", version: "1.0.0" },
          },
        }) + "\n",
      ),
    )
    await child.stdin.flush()
    const response = await readMessage(child.stdout)
    expect(response.id).toBe(1)
    expect(response.error).toBeUndefined()
    expect(response.result).toMatchObject({
      protocolVersion: 1,
      agentCapabilities: { loadSession: true },
      agentInfo: { name: "OpenCode" },
    })

    await child.stdin.end()
    const exitCode = await child.exited
    const errorOutput = await stderr
    if (exitCode !== 0) throw new Error(`ACP exited with ${exitCode}: ${errorOutput}`)
    children.splice(children.indexOf(child), 1)
  }, 30_000)
})

function spawn() {
  const child = Bun.spawn([process.execPath, "run", "src/index.ts", "acp"], {
    cwd: path.join(import.meta.dir, "../.."),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
  children.push(child)
  return child
}

async function readMessage(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let output = ""
  while (true) {
    const result = await Promise.race([
      reader.read(),
      Bun.sleep(20_000).then(() => {
        throw new Error("timed out waiting for ACP response")
      }),
    ])
    if (result.done) throw new Error(`ACP exited before responding: ${output}`)
    output += decoder.decode(result.value, { stream: true })
    const newline = output.indexOf("\n")
    if (newline === -1) continue
    reader.releaseLock()
    const message: unknown = JSON.parse(output.slice(0, newline))
    if (!isMessage(message)) throw new Error(`invalid ACP response: ${output.slice(0, newline)}`)
    return message
  }
}

function isMessage(value: unknown): value is Message {
  return typeof value === "object" && value !== null
}

async function cli(args: string[]) {
  const child = Bun.spawn([process.execPath, "run", "src/index.ts", ...args], {
    cwd: path.join(import.meta.dir, "../.."),
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout, stderr, exitCode }
}
