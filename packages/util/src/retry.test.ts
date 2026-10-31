import { describe, expect, jest, test } from "bun:test"
import { retry } from "./retry.js"

describe("client retry", () => {
  test("retries transient failures up to the configured attempt count", async () => {
    const failures: string[] = []
    const value = await retry(
      async () => {
        failures.push("attempt")
        if (failures.length < 3) throw new Error("Failed to fetch")
        return "ready"
      },
      { delay: 0 },
    )

    expect(value).toBe("ready")
    expect(failures).toHaveLength(3)
  })

  test("retries a real network failure wrapped as the cause of a transport error", async () => {
    const server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        // Reset only once the request has arrived. Resetting on accept races the client's request
        // write, and on Windows a lost race surfaces as a write or connect failure instead of a
        // connection reset.
        data(socket) {
          socket.terminate()
        },
      },
    })
    const failures: unknown[] = []
    try {
      await expect(
        retry(
          () =>
            fetch(`http://127.0.0.1:${server.port}/api/project`).catch((cause) => {
              failures.push(cause)
              throw new Error("Transport", { cause })
            }),
          { delay: 0 },
        ),
      ).rejects.toThrow("Transport")
    } finally {
      server.stop(true)
    }
    expect(failures).toHaveLength(3)
    expect(failures.every((cause) => cause instanceof TypeError)).toBe(true)
  })

  test("does not retry a transport error whose cause is not transient", async () => {
    const failures: string[] = []
    await expect(
      retry(async () => {
        failures.push("attempt")
        throw new Error("Transport", { cause: new Error("invalid response") })
      }),
    ).rejects.toThrow("Transport")
    expect(failures).toHaveLength(1)
  })

  test("does not retry other failures", async () => {
    const failures: string[] = []
    await expect(
      retry(async () => {
        failures.push("attempt")
        throw new Error("invalid response")
      }),
    ).rejects.toThrow("invalid response")
    expect(failures).toHaveLength(1)
  })

  test("uses a caller-owned retry condition", async () => {
    const failures: string[] = []
    await expect(
      retry(
        async () => {
          failures.push("attempt")
          throw new Error("retry me")
        },
        { attempts: 2, delay: 0, retryIf: () => true },
      ),
    ).rejects.toThrow("retry me")
    expect(failures).toHaveLength(2)
  })
})

test("does not start an operation with an aborted signal", async () => {
  const controller = new AbortController()
  const reason = new Error("cancelled")
  controller.abort(reason)
  let calls = 0
  await expect(retry(async () => ++calls, { signal: controller.signal })).rejects.toBe(reason)
  expect(calls).toBe(0)
})

test("cancels backoff and removes its timer", async () => {
  jest.useFakeTimers()
  const controller = new AbortController()
  const reason = new Error("cancelled")
  let calls = 0
  try {
    const task = retry(
      async () => {
        calls++
        throw new Error("Failed to fetch")
      },
      { signal: controller.signal },
    )
    const failure = task.catch((error) => error)
    await Promise.resolve()
    await Promise.resolve()
    expect(jest.getTimerCount()).toBe(1)
    controller.abort(reason)
    expect(await failure).toBe(reason)
    expect(jest.getTimerCount()).toBe(0)
    jest.runAllTimers()
    expect(calls).toBe(1)
  } finally {
    controller.abort(reason)
    jest.useRealTimers()
  }
})

test("does not publish an in-flight result after cancellation", async () => {
  const controller = new AbortController()
  const result = Promise.withResolvers<string>()
  const task = retry(() => result.promise, { signal: controller.signal })
  const reason = new Error("cancelled")
  controller.abort(reason)
  result.resolve("stale")
  await expect(task).rejects.toBe(reason)
})

test("exhausts five attempts after four delays without a final sleep", async () => {
  jest.useFakeTimers()
  const error = new Error("Failed to fetch")
  const attempts: number[] = []
  try {
    const task = retry(
      async () => {
        attempts.push(Date.now())
        throw error
      },
      { attempts: 5 },
    )
    const failure = task.catch((error) => error)
    await Promise.resolve()
    await Promise.resolve()
    for (const delay of [500, 1000, 2000, 4000]) {
      jest.advanceTimersByTime(delay)
      await Promise.resolve()
      await Promise.resolve()
    }
    expect(await failure).toBe(error)
    expect(attempts.map((time) => time - attempts[0])).toEqual([0, 500, 1500, 3500, 7500])
    expect(jest.getTimerCount()).toBe(0)
  } finally {
    jest.useRealTimers()
  }
})
