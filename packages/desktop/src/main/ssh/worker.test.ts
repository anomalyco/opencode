import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { createServer } from "node:net"
import os from "node:os"
import path from "node:path"
import { buildDesktop, headless } from "../../../test/ssh/desktop"

const directory = await mkdtemp(path.join(os.tmpdir(), "opencode askpass test "))
const command: string[] = []
beforeAll(async () => {
  command.push(...(await buildDesktop(directory)))
}, 30_000)
afterAll(() => rm(directory, { recursive: true, force: true }))

test.skipIf(headless).each([
  {
    name: "passphrase",
    response: JSON.stringify({ value: 'passphrase"with spaces' }),
    stdout: 'passphrase"with spaces\n',
    code: 0,
  },
  { name: "empty response", response: JSON.stringify({ value: "" }), stdout: "\n", code: 0 },
  { name: "cancellation", response: JSON.stringify({ value: null }), stdout: "", code: 1 },
  { name: "invalid response", response: "not json", stdout: "", code: 1 },
])(
  "the desktop askpass entrypoint handles $name without application output",
  async (fixture) => {
    const requests: string[] = []
    const server = createServer((socket) => {
      socket.once("data", (data: Buffer) => {
        requests.push(data.toString())
        socket.end(fixture.response)
      })
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("missing listener")
    try {
      const child = Bun.spawn([...command, "Enter passphrase:"], {
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: undefined,
          ELECTRON_NO_ATTACH_CONSOLE: "true",
          OPENCODE_SSH_ASKPASS_PORT: String(address.port),
          OPENCODE_SSH_ASKPASS_TOKEN: "fixture",
          SSH_ASKPASS_PROMPT: "confirm",
        },
        stdout: "pipe",
        stderr: "pipe",
        timeout: 10_000,
      })
      expect(await new Response(child.stdout).text()).toBe(fixture.stdout)
      expect(await child.exited).toBe(fixture.code)
      expect(requests.map((request) => JSON.parse(request))).toEqual([
        { token: "fixture", text: "Enter passphrase:", confirm: true },
      ])
      expect(await new Response(child.stderr).text()).toBe("")
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  },
  30_000,
)
