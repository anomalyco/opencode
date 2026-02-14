import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Pty } from "../../src/pty"
import { tmpdir } from "../fixture/fixture"

describe("pty", () => {
  test("does not leak output when websocket objects are reused", async () => {
    await using dir = await tmpdir({ git: true })

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        const a = await Pty.create({ command: "cat", title: "a" })
        const b = await Pty.create({ command: "cat", title: "b" })
        try {
          const outA: string[] = []
          const outB: string[] = []

          const ws = {
            readyState: 1,
            send: (data: unknown) => {
              outA.push(typeof data === "string" ? data : Buffer.from(data as Uint8Array).toString("utf8"))
            },
            close: () => {
              // no-op (simulate abrupt drop)
            },
          }

          // Connect "a" first with ws.
          Pty.connect(a.id, ws as any)

          // Now "reuse" the same ws object for another connection.
          ws.send = (data: unknown) => {
            outB.push(typeof data === "string" ? data : Buffer.from(data as Uint8Array).toString("utf8"))
          }
          Pty.connect(b.id, ws as any)

          // Clear connect metadata writes.
          outA.length = 0
          outB.length = 0

          // Output from a must never show up in b.
          Pty.write(a.id, "AAA\n")
          await Bun.sleep(100)

          expect(outB.join("")).not.toContain("AAA")
        } finally {
          await Pty.remove(a.id)
          await Pty.remove(b.id)
        }
      },
    })
  })
})
