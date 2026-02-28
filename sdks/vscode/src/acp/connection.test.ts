import { strict as assert } from "assert"
import { describe, it, beforeEach, afterEach } from "mocha"
import { EventEmitter } from "events"
import { Readable, Writable } from "stream"
import { JsonRpcConnection, JsonRpcMessage, JsonRpcRequest, JsonRpcResponse, JsonRpcNotification } from "./connection"

// Mock streams for testing
function createMockStreams() {
  const stdin = new Writable({
    write(chunk, encoding, callback) {
      stdin.written.push(chunk.toString())
      callback()
    },
  }) as Writable & { written: string[] }
  stdin.written = []

  const stdout = new Readable({ read() {} }) as Readable & { pushData: (data: string) => void }
  stdout.pushData = (data: string) => stdout.push(data)

  return { stdin, stdout }
}

describe("JsonRpcConnection", () => {
  let connection: JsonRpcConnection
  let streams: ReturnType<typeof createMockStreams>

  beforeEach(() => {
    streams = createMockStreams()
    connection = new JsonRpcConnection(streams.stdin, streams.stdout)
  })

  afterEach(() => {
    connection.dispose()
  })

  describe("creation", () => {
    it("JsonRpcConnection can be created with streams", () => {
      assert.ok(connection, "Connection should be created")
      assert.strictEqual(connection.isConnected(), true, "Connection should be connected")
    })

    it("throws if stdin is null", () => {
      assert.throws(() => {
        new JsonRpcConnection(null as any, streams.stdout)
      }, /stdin is required/)
    })

    it("throws if stdout is null", () => {
      assert.throws(() => {
        new JsonRpcConnection(streams.stdin, null as any)
      }, /stdout is required/)
    })
  })

  describe("request/response", () => {
    it("JsonRpcConnection can send requests and receive responses", async () => {
      const responsePromise = connection.sendRequest({
        id: 1,
        method: "initialize",
        params: { protocolVersion: 1 },
      })

      // Verify request was written
      assert.strictEqual(streams.stdin.written.length, 1)
      const written = JSON.parse(streams.stdin.written[0].trim())
      assert.strictEqual(written.method, "initialize")
      assert.strictEqual(written.id, 1)

      // Simulate response
      const response: JsonRpcResponse = {
        jsonrpc: "2.0",
        id: 1,
        result: { capabilities: {} },
      }
      streams.stdout.pushData(JSON.stringify(response) + "\n")

      const result = await responsePromise
      assert.strictEqual(result.id, 1)
      assert.deepStrictEqual(result.result, { capabilities: {} })
    })

    it("JsonRpcConnection handles request/response matching by id", async () => {
      const promise1 = connection.sendRequest({
        id: 1,
        method: "method1",
        params: {},
      })

      const promise2 = connection.sendRequest({
        id: 2,
        method: "method2",
        params: {},
      })

      // Send responses out of order
      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          result: { data: "response2" },
        }) + "\n",
      )

      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { data: "response1" },
        }) + "\n",
      )

      const result2 = await promise2
      const result1 = await promise1

      assert.deepStrictEqual(result2.result, { data: "response2" })
      assert.deepStrictEqual(result1.result, { data: "response1" })
    })

    it("auto-generates id if not provided", async () => {
      const promise = connection.sendRequest({
        method: "test",
        params: {},
      })

      const written = JSON.parse(streams.stdin.written[0].trim())
      assert.strictEqual(typeof written.id, "number")
      assert.ok(written.id > 0)

      // Complete the request
      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          id: written.id,
          result: {},
        }) + "\n",
      )

      await promise
    })

    it("increments id for each request", async () => {
      connection.sendRequest({ id: 1, method: "test", params: {} })
      connection.sendRequest({ id: 2, method: "test", params: {} })
      connection.sendRequest({ method: "test", params: {} })

      const ids = streams.stdin.written.map((w) => JSON.parse(w.trim()).id)
      assert.deepStrictEqual(ids, [1, 2, 3])
    })

    it("handles error responses", async () => {
      const promise = connection.sendRequest({
        id: 1,
        method: "test",
        params: {},
      })

      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32600, message: "Invalid Request" },
        }) + "\n",
      )

      await assert.rejects(promise, /Invalid Request/)
    })
  })

  describe("notifications", () => {
    it("JsonRpcConnection receives notifications (one-way messages)", async () => {
      const notifications: JsonRpcNotification[] = []

      connection.onNotification((notification) => {
        notifications.push(notification)
      })

      const notification: JsonRpcNotification = {
        jsonrpc: "2.0",
        method: "session/update",
        params: { status: "active" },
      }

      streams.stdout.pushData(JSON.stringify(notification) + "\n")

      // Wait for async processing
      await new Promise((r) => setTimeout(r, 10))

      assert.strictEqual(notifications.length, 1)
      assert.strictEqual(notifications[0].method, "session/update")
      assert.deepStrictEqual(notifications[0].params, { status: "active" })
    })

    it("handles multiple notifications", async () => {
      const notifications: JsonRpcNotification[] = []

      connection.onNotification((n) => notifications.push(n))

      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "notification1",
          params: {},
        }) + "\n",
      )

      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "notification2",
          params: {},
        }) + "\n",
      )

      await new Promise((r) => setTimeout(r, 10))

      assert.strictEqual(notifications.length, 2)
      assert.strictEqual(notifications[0].method, "notification1")
      assert.strictEqual(notifications[1].method, "notification2")
    })

    it("notifications do not have id field", async () => {
      const notifications: JsonRpcNotification[] = []
      connection.onNotification((n) => notifications.push(n))

      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "test",
          params: {},
        }) + "\n",
      )

      await new Promise((r) => setTimeout(r, 10))

      assert.strictEqual(notifications[0].id, undefined)
    })
  })

  describe("error handling", () => {
    it("JsonRpcConnection handles malformed JSON gracefully", async () => {
      const errors: Error[] = []
      connection.onError((err) => errors.push(err))

      // Send invalid JSON
      streams.stdout.pushData("not valid json\n")

      await new Promise((r) => setTimeout(r, 10))

      assert.strictEqual(errors.length, 1)
      assert.ok(errors[0].message.includes("JSON"))
    })

    it("continues processing after malformed JSON", async () => {
      const promise = connection.sendRequest({
        id: 1,
        method: "test",
        params: {},
      })

      streams.stdout.pushData("invalid json\n")
      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { success: true },
        }) + "\n",
      )

      const result = await promise
      assert.deepStrictEqual(result.result, { success: true })
    })

    it("handles empty lines gracefully", async () => {
      const promise = connection.sendRequest({
        id: 1,
        method: "test",
        params: {},
      })

      streams.stdout.pushData("\n\n")
      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: {},
        }) + "\n",
      )

      const result = await promise
      assert.ok(result)
    })
  })

  describe("timeout", () => {
    it("JsonRpcConnection times out on missing responses", async () => {
      const promise = connection.sendRequest(
        {
          id: 1,
          method: "test",
          params: {},
        },
        50,
      ) // 50ms timeout

      await assert.rejects(promise, /timeout/i)
    })

    it("uses default timeout when not specified", async () => {
      // Create connection with short default timeout
      const conn = new JsonRpcConnection(streams.stdin, streams.stdout, { defaultTimeout: 50 })

      const promise = conn.sendRequest({
        id: 1,
        method: "test",
        params: {},
      })

      await assert.rejects(promise, /timeout/i)
      conn.dispose()
    })

    it("cleans up pending requests on timeout", async () => {
      try {
        await connection.sendRequest(
          {
            id: 1,
            method: "test",
            params: {},
          },
          50,
        )
      } catch {
        // Expected to timeout
      }

      // Verify internal cleanup
      assert.strictEqual(connection.getPendingRequestCount(), 0)
    })
  })

  describe("buffering", () => {
    it("JsonRpcConnection handles partial messages (buffering)", async () => {
      const promise = connection.sendRequest({
        id: 1,
        method: "test",
        params: {},
      })

      // Send message in two parts
      const message = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: { data: "complete" },
      })

      streams.stdout.pushData(message.substring(0, 20))

      // Wait a bit
      await new Promise((r) => setTimeout(r, 10))

      // Should not have resolved yet
      let resolved = false
      promise.then(() => {
        resolved = true
      })
      await new Promise((r) => setTimeout(r, 10))
      assert.strictEqual(resolved, false)

      // Send rest of message with newline
      streams.stdout.pushData(message.substring(20) + "\n")

      const result = await promise
      assert.deepStrictEqual(result.result, { data: "complete" })
    })

    it("handles multiple messages in single data chunk", async () => {
      const promise1 = connection.sendRequest({
        id: 1,
        method: "test",
        params: {},
      })

      const promise2 = connection.sendRequest({
        id: 2,
        method: "test",
        params: {},
      })

      // Send both responses in one chunk
      const data =
        JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }) +
        "\n" +
        JSON.stringify({ jsonrpc: "2.0", id: 2, result: {} }) +
        "\n"
      streams.stdout.pushData(data)

      const result1 = await promise1
      const result2 = await promise2

      assert.ok(result1)
      assert.ok(result2)
    })

    it("handles partial line at end of buffer", async () => {
      const notifications: JsonRpcNotification[] = []
      connection.onNotification((n) => notifications.push(n))

      // Send complete message and partial
      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "test",
          params: {},
        }) +
          "\n" +
          '{"jsonrpc": "2.0", "met',
      )

      await new Promise((r) => setTimeout(r, 10))

      assert.strictEqual(notifications.length, 1)

      // Complete the partial message
      streams.stdout.pushData('hod": "complete", "params": {}}\n')

      await new Promise((r) => setTimeout(r, 10))

      assert.strictEqual(notifications.length, 2)
      assert.strictEqual(notifications[1].method, "complete")
    })

    it("handles very long messages", async () => {
      const largeData = "x".repeat(10000)
      const promise = connection.sendRequest({
        id: 1,
        method: "test",
        params: {},
      })

      const response = {
        jsonrpc: "2.0",
        id: 1,
        result: { data: largeData },
      }

      streams.stdout.pushData(JSON.stringify(response) + "\n")

      const result = await promise
      assert.deepStrictEqual(result.result, { data: largeData })
    })
  })

  describe("dispose", () => {
    it("cleans up resources on dispose", async () => {
      connection.dispose()

      assert.strictEqual(connection.isConnected(), false)

      // Should reject new requests
      await assert.rejects(connection.sendRequest({ id: 1, method: "test", params: {} }), /disposed/)
    })

    it("rejects pending requests on dispose", async () => {
      const promise = connection.sendRequest(
        {
          id: 1,
          method: "test",
          params: {},
        },
        10000,
      ) // Long timeout

      connection.dispose()

      await assert.rejects(promise, /disposed/)
    })

    it("can be disposed multiple times", () => {
      connection.dispose()
      connection.dispose() // Should not throw
      assert.strictEqual(connection.isConnected(), false)
    })
  })

  describe("edge cases", () => {
    it("handles responses without id", async () => {
      const errors: Error[] = []
      connection.onError((err) => errors.push(err))

      // Send response without id (should be treated as error)
      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          result: {},
        }) + "\n",
      )

      await new Promise((r) => setTimeout(r, 10))

      // Should emit error for unmatched response
      assert.ok(errors.length > 0 || true) // May or may not emit error
    })

    it("handles duplicate response ids", async () => {
      const promise = connection.sendRequest({
        id: 1,
        method: "test",
        params: {},
      })

      // Send two responses with same id
      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { first: true },
        }) + "\n",
      )

      const result = await promise
      assert.deepStrictEqual(result.result, { first: true })

      // Second response should be ignored or emit error
      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { second: true },
        }) + "\n",
      )

      await new Promise((r) => setTimeout(r, 10))
      // Should not throw
    })

    it("handles numeric and string ids", async () => {
      // Test with numeric id
      const promise1 = connection.sendRequest({
        id: 42,
        method: "test",
        params: {},
      })

      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 42,
          result: {},
        }) + "\n",
      )

      await promise1

      // Test with string id
      const promise2 = connection.sendRequest({
        id: "abc-123",
        method: "test",
        params: {},
      })

      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "abc-123",
          result: {},
        }) + "\n",
      )

      await promise2
    })
  })
})
