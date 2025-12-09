import { describe, test } from "bun:test"
import { EventLoop } from "../../src/util/eventloop"

describe("util.eventloop", () => {
  test("wait resolves after active handles complete", async () => {
    // Create an active timer handle
    const timerPromise = new Promise<void>((resolve) => {
      setTimeout(resolve, 10)
    })

    // Start waiting for the event loop to become idle
    const waitPromise = EventLoop.wait()

    // Let the timer finish, then ensure wait also completes
    await timerPromise
    await waitPromise
  })
})


