import { describe, expect, test } from "bun:test"

function line(obj: unknown) {
  return JSON.stringify(obj) + "\n"
}

describe("acp server", () => {
  test("initialize and complete", async () => {
    const proc = Bun.spawn({
      cmd: ["bun", "run", "--conditions=development", "src/index.ts", "--acp"],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, OPENCODE: "1" },
    })

    const w = new TextEncoder()
    proc.stdin!.write(w.encode(line({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })))
    proc.stdin!.write(w.encode(line({ jsonrpc: "2.0", id: 2, method: "shutdown" })))
    proc.stdin!.end()

    const r = proc.stdout!.getReader()
    const d = new TextDecoder()
    let initOk = false
    while (true) {
      const { value, done } = await r.read()
      if (done) break
      const s = d.decode(value)
      for (const ln of s.split("\n")) {
        const t = ln.trim()
        if (!t) continue
        const msg = JSON.parse(t)
        if (msg.id === 1) initOk = !!msg.result?.capabilities?.text?.complete
      }
    }

    expect(initOk).toBe(true)
  })
})
