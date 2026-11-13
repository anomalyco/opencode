import { expect } from "bun:test"
import { Effect } from "effect"
import { it } from "../../core/test/lib/effect"
import { ServerHealth } from "../src/health"

const authorization = `Basic ${btoa("opencode:secret")}`

it.live(
  "answers while the main thread is blocked and reports for how long",
  () =>
    Effect.gen(function* () {
      const url = yield* ServerHealth.start("secret")
      expect((yield* Effect.promise(() => fetch(url))).status).toBe(401)

      // Another process asks halfway through the block: this thread cannot ask while it is blocked.
      const client = Bun.spawn(
        [
          process.execPath,
          "-e",
          `await Bun.sleep(1_500); const response = await fetch(${JSON.stringify(url)}, { headers: { authorization: ${JSON.stringify(authorization)} } }); console.log(await response.text())`,
        ],
        { stdout: "pipe", stderr: "inherit" },
      )
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3_000)
      const report = JSON.parse(yield* Effect.promise(() => new Response(client.stdout).text()))

      // Only an answer given during the block can see the main thread stopped for this long.
      expect(report).toMatchObject({ pid: process.pid, disk: false })
      expect(report.blocked).toBeGreaterThanOrEqual(1_000)
    }),
  { timeout: 15_000 },
)
