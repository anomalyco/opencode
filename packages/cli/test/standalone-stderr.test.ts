import { expect, test } from "bun:test"
import { Effect } from "effect"
import { Standalone } from "../src/services/standalone"

// The child exits immediately, so stdout EOF reaches the readiness wait within the default timeout.
test("shows the child stderr tail when the server exits before readiness", async () => {
  const error = await Effect.runPromise(
    Effect.scoped(
      Effect.flip(
        Standalone.start({
          command: [process.execPath, "-e", 'console.error("sqlite boot detail marker")'],
        }),
      ),
    ),
  )
  expect(error.message).toContain("Standalone server exited before reporting readiness")
  expect(error.message).toContain("sqlite boot detail marker")
})

test("keeps the bare readiness error when the child wrote no stderr", async () => {
  const error = await Effect.runPromise(
    Effect.scoped(
      Effect.flip(
        Standalone.start({
          command: [process.execPath, "-e", "process.exit(3)"],
        }),
      ),
    ),
  )
  expect(error.message).toBe("Standalone server exited before reporting readiness")
})

// A scope close interrupts both drain fibers; their finalizers run sequentially,
// so waiting on the stderr drain inside the stdout drain's finalizer deadlocks.
test("closing the scope while the child stays alive does not hang", async () => {
  const start = Date.now()
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const endpoint = yield* Standalone.start({
          command: [
            process.execPath,
            "-e",
            'console.log(JSON.stringify({url:"http://127.0.0.1:1"})); setInterval(() => {}, 1000)',
          ],
        })
        expect(endpoint.url).toBe("http://127.0.0.1:1")
      }),
    ),
  )
  expect(Date.now() - start).toBeLessThan(5000)
})
