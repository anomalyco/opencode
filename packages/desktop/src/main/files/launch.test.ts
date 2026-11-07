import { expect, test } from "bun:test"
import { createServer } from "node:net"
import { fileURLToPath } from "node:url"
import { launchDetached } from "./launch"

test("external apps preserve arguments and survive their launcher exiting", async () => {
  const received = Promise.withResolvers<string>()

  const server = createServer((socket) => {
    socket.once("data", (data) => received.resolve(data.toString()))
    socket.unref()
  })

  server.listen(0, "127.0.0.1")
  await new Promise<void>((resolve) => server.once("listening", resolve))

  const address = server.address()

  // SAFETY: node:net returns a string for pipes and AddressInfo for TCP listeners.
  // oxlint-disable-next-line anti-slop/no-runtime-typeof
  if (!address || typeof address === "string") throw new Error("Expected TCP address")

  const target = 'project with spaces & symbols %PATH% ! ^ (日本語) "quoted"'

  const child = `
    const { connect } = require("node:net")
    const socket = connect(${address.port}, "127.0.0.1", () => {
      socket.write(process.pid + "\\n" + JSON.stringify(process.argv.slice(1)))
    })
    setInterval(() => {}, 1000)
  `

  const parent = Bun.spawn(
    [
      process.execPath,
      "-e",
      `import { launchDetached } from ${JSON.stringify(fileURLToPath(new URL("./launch.ts", import.meta.url)))};
       await launchDetached(process.execPath, ${JSON.stringify(["-e", child, target])})`,
    ],
    { stdout: "pipe", stderr: "pipe" },
  )

  const message = (await received.promise).split("\n")
  const pid = Number(message[0])

  try {
    expect(await parent.exited).toBe(0)
    expect(await new Response(parent.stderr).text()).toBe("")
    expect(message[1]).toBe(JSON.stringify([target]))
    expect(process.kill(pid, 0)).toBe(true)
  } finally {
    process.kill(pid)
    parent.kill()
    server.close()
  }
})

test("missing external applications reject at launch", async () => {
  const missing = `opencode-missing-editor-${crypto.randomUUID()}`

  await expect(launchDetached(missing, ["project with spaces"])).rejects.toThrow(missing)
})
