import assert from "node:assert/strict"
import { Service } from "@opencode/client/service"

const binary = process.env.OPENCODE_NIX_CLI
const version = process.env.OPENCODE_NIX_VERSION
assert.ok(binary)
assert.ok(version)

const child = Bun.spawn([binary, "serve", "--service", "--port", "0"], {
  stdin: "ignore",
  stdout: "pipe",
  stderr: "pipe",
  signal: AbortSignal.timeout(60_000),
})
const stderr = new Response(child.stderr).text()
const stdout = child.stdout.getReader()
const decoder = new TextDecoder()

try {
  let url: string | undefined
  let buffer = ""
  while (!url) {
    const chunk = await stdout.read()
    if (chunk.done) throw new Error(`CLI exited before announcing its listener: ${await stderr}`)
    buffer += decoder.decode(chunk.value, { stream: true })
    url = /^server listening on ([^\r\n]+)\r?\n/m.exec(buffer)?.[1]
  }

  const endpoint = await Service.discover({ version })
  assert.equal(endpoint?.url, url)
  assert.equal(endpoint?.auth?.type, "basic")
  console.log("Released CLI is discoverable through the Desktop client's default registration")
} finally {
  stdout.releaseLock()
  child.kill()
  await child.exited
}
