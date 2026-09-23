import { describe, expect, test } from "bun:test"
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
        open(socket) {
          socket.terminate()
        },
        data() {},
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
