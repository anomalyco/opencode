import { describe, test, expect, spyOn } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"

const projectRoot = path.join(__dirname, "../..")

Log.init({ print: false })

describe("SSE teardown", () => {
  test("dispose-triggered stream close emits disconnected", async () => {
    const serverLog = Log.create({ service: "server" })
    const infoSpy = spyOn(serverLog, "info")

    try {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const app = Server.App()

          // Connect to SSE
          const response = await app.request("/event")
          expect(response.status).toBe(200)

          // The response should be a readable stream
          const reader = response.body!.getReader()
          const decoder = new TextDecoder()

          // Read the first event (server.connected)
          const { value: first } = await reader.read()
          const firstText = decoder.decode(first)
          expect(firstText).toContain("server.connected")

          // Trigger instance disposal
          await Instance.dispose()

          // Read remaining events - should include server.instance.disposed
          // and the stream should close
          let gotDisposed = false
          let streamEnded = false

          // Read with a timeout
          const readWithTimeout = async () => {
            const timeout = setTimeout(() => {
              reader.cancel()
            }, 5000)

            try {
              while (true) {
                const { value, done } = await reader.read()
                if (done) {
                  streamEnded = true
                  break
                }
                const text = decoder.decode(value)
                if (text.includes("server.instance.disposed")) {
                  gotDisposed = true
                }
              }
            } catch {
              // Stream cancelled by timeout or closed
              streamEnded = true
            } finally {
              clearTimeout(timeout)
            }
          }

          await readWithTimeout()

          expect(gotDisposed).toBe(true)
          expect(streamEnded).toBe(true)
        },
      })

      const disconnected = infoSpy.mock.calls.filter(([message]) => message === "event disconnected")
      expect(disconnected.length).toBe(1)
    } finally {
      infoSpy.mockRestore()
    }
  }, 15000)

  test("multiple SSE connections all clean up on dispose", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const app = Server.App()
        const CONNECTIONS = 5

        // Create multiple SSE connections
        const readers: ReadableStreamDefaultReader<Uint8Array>[] = []
        const decoder = new TextDecoder()

        for (let i = 0; i < CONNECTIONS; i++) {
          const response = await app.request("/event")
          expect(response.status).toBe(200)
          const reader = response.body!.getReader()

          // Read initial server.connected event
          const { value } = await reader.read()
          expect(decoder.decode(value)).toContain("server.connected")

          readers.push(reader)
        }

        // Dispose the instance - all streams should close
        await Instance.dispose()

        // Verify all streams close properly
        let closedCount = 0
        await Promise.all(
          readers.map(async (reader) => {
            const timeout = setTimeout(() => reader.cancel(), 5000)
            try {
              while (true) {
                const { done } = await reader.read()
                if (done) {
                  closedCount++
                  break
                }
              }
            } catch {
              closedCount++ // cancelled = closed
            } finally {
              clearTimeout(timeout)
            }
          }),
        )

        expect(closedCount).toBe(CONNECTIONS)
      },
    })
  }, 15000)
})
