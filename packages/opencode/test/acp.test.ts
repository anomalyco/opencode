import { describe, expect, test } from "bun:test"

function line(obj: unknown) {
  return JSON.stringify(obj) + "\n"
}

describe("acp server", () => {
  test("initialize and complete", async () => {
    const proc = Bun.spawn({
      cmd: ["bun", "run", "--conditions=development", "packages/opencode/src/index.ts", "--acp"],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "ignore",
      env: { ...process.env, OPENCODE: "1" },
    })

    const w = new TextEncoder()
    const writer = proc.stdin!.getWriter()
    await writer.write(w.encode(line({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })))
    await writer.write(w.encode(line({ jsonrpc: "2.0", id: 2, method: "text/complete", params: { text: "Hello" } })))
    await writer.write(w.encode(line({ jsonrpc: "2.0", id: 3, method: "shutdown" })))

    const r = proc.stdout!.getReader()
    const d = new TextDecoder()
    let initOk = false
    let gotText: string | undefined
    while (true) {
      const { value, done } = await r.read()
      if (done) break
      const s = d.decode(value)
      for (const ln of s.split("\n")) {
        const t = ln.trim()
        if (!t) continue
        const msg = JSON.parse(t)
        if (msg.id === 1) initOk = !!msg.result?.capabilities?.text?.complete
        if (msg.id === 2) gotText = msg.result?.text
      }
    }

    expect(initOk).toBe(true)
    expect(typeof gotText).toBe("string")
  })
})
