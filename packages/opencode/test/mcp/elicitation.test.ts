import { test, expect } from "bun:test"
import { Elicitation } from "../../src/mcp/elicitation"
import { Instance } from "../../src/project/instance"
import { Bus } from "../../src/bus"
import { tmpdir } from "../fixture/fixture"
import type { ElicitRequest } from "@modelcontextprotocol/sdk/types.js"

// Helper to create a valid ElicitRequest
function createElicitRequest(message: string = "Test message"): ElicitRequest {
  return {
    method: "elicitation/create",
    params: {
      message,
      requestedSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            title: "Name",
            description: "Your name",
          },
        },
        required: ["name"],
      },
    },
  }
}

// handle tests

test("handle - returns pending promise", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const promise = Elicitation.handle("test-server", createElicitRequest())
      expect(promise).toBeInstanceOf(Promise)
    },
  })
})

test("handle - adds to pending list", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      Elicitation.handle("test-server", createElicitRequest("Test elicitation"))

      const pending = await Elicitation.list()
      expect(pending.length).toBe(1)
      expect(pending[0].message).toBe("Test elicitation")
      expect(pending[0].serverName).toBe("test-server")
    },
  })
})

test("handle - publishes Requested event", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      let eventReceived = false
      let receivedRequest: Elicitation.Request | undefined

      const unsub = Bus.subscribe(Elicitation.Event.Requested, (event) => {
        eventReceived = true
        receivedRequest = event.properties
      })

      Elicitation.handle("test-server", createElicitRequest("Event test"))
      await new Promise((resolve) => setTimeout(resolve, 50))

      unsub()

      expect(eventReceived).toBe(true)
      expect(receivedRequest?.message).toBe("Event test")
      expect(receivedRequest?.serverName).toBe("test-server")
    },
  })
})

test("handle - throws for URL mode (unsupported)", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const urlRequest: ElicitRequest = {
        method: "elicitation/create",
        params: {
          message: "Visit this URL",
          url: "https://example.com/auth",
        } as any,
      }

      await expect(Elicitation.handle("test-server", urlRequest)).rejects.toThrow(
        "Only form mode elicitations are supported",
      )
    },
  })
})

// reply tests

test("reply - resolves the pending handle with content", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const handlePromise = Elicitation.handle("test-server", createElicitRequest())

      const pending = await Elicitation.list()
      const id = pending[0].id

      await Elicitation.reply(id, { name: "Test User" })

      const result = await handlePromise
      expect(result.action).toBe("accept")
      expect(result.content).toEqual({ name: "Test User" })
    },
  })
})

test("reply - removes from pending list", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      Elicitation.handle("test-server", createElicitRequest())

      const pending = await Elicitation.list()
      expect(pending.length).toBe(1)

      await Elicitation.reply(pending[0].id, { name: "Test" })

      const pendingAfter = await Elicitation.list()
      expect(pendingAfter.length).toBe(0)
    },
  })
})

test("reply - publishes Completed event", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      let eventReceived = false
      let eventAction: string | undefined
      let eventContent: Record<string, unknown> | undefined

      const unsub = Bus.subscribe(Elicitation.Event.Completed, (event) => {
        eventReceived = true
        eventAction = event.properties.action
        eventContent = event.properties.content
      })

      Elicitation.handle("test-server", createElicitRequest())
      const pending = await Elicitation.list()

      await Elicitation.reply(pending[0].id, { name: "Test User" })
      await new Promise((resolve) => setTimeout(resolve, 50))

      unsub()

      expect(eventReceived).toBe(true)
      expect(eventAction).toBe("accept")
      expect(eventContent).toEqual({ name: "Test User" })
    },
  })
})

test("reply - does nothing for unknown id", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await Elicitation.reply("elicitation_unknown", { name: "Test" })
      // Should not throw
    },
  })
})

// reject tests

test("reject - resolves pending handle with action", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const handlePromise = Elicitation.handle("test-server", createElicitRequest())

      const pending = await Elicitation.list()
      await Elicitation.reject(pending[0].id, "decline")

      const result = await handlePromise
      expect(result.action).toBe("decline")
      expect(result.content).toBeUndefined()
    },
  })
})

test("reject - defaults to cancel action", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const handlePromise = Elicitation.handle("test-server", createElicitRequest())

      const pending = await Elicitation.list()
      await Elicitation.reject(pending[0].id)

      const result = await handlePromise
      expect(result.action).toBe("cancel")
    },
  })
})

test("reject - removes from pending list", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const handlePromise = Elicitation.handle("test-server", createElicitRequest())

      const pending = await Elicitation.list()
      expect(pending.length).toBe(1)

      await Elicitation.reject(pending[0].id)
      await handlePromise // Consume the promise

      const pendingAfter = await Elicitation.list()
      expect(pendingAfter.length).toBe(0)
    },
  })
})

test("reject - publishes Rejected event", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      let eventReceived = false
      let eventAction: string | undefined

      const unsub = Bus.subscribe(Elicitation.Event.Rejected, (event) => {
        eventReceived = true
        eventAction = event.properties.action
      })

      Elicitation.handle("test-server", createElicitRequest())
      const pending = await Elicitation.list()

      await Elicitation.reject(pending[0].id, "decline")
      await new Promise((resolve) => setTimeout(resolve, 50))

      unsub()

      expect(eventReceived).toBe(true)
      expect(eventAction).toBe("decline")
    },
  })
})

test("reject - does nothing for unknown id", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await Elicitation.reject("elicitation_unknown")
      // Should not throw
    },
  })
})

// list tests

test("list - returns all pending requests", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      Elicitation.handle("server1", createElicitRequest("Request 1"))
      Elicitation.handle("server2", createElicitRequest("Request 2"))

      const pending = await Elicitation.list()
      expect(pending.length).toBe(2)
    },
  })
})

test("list - returns empty when no pending", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const pending = await Elicitation.list()
      expect(pending.length).toBe(0)
    },
  })
})

// get tests

test("get - returns specific pending elicitation", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      Elicitation.handle("test-server", createElicitRequest("Get test"))

      const pending = await Elicitation.list()
      const result = await Elicitation.get(pending[0].id)

      expect(result).toBeDefined()
      expect(result?.message).toBe("Get test")
    },
  })
})

test("get - returns undefined for unknown id", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const result = await Elicitation.get("elicitation_unknown")
      expect(result).toBeUndefined()
    },
  })
})

// cancel tests

test("cancel - removes from pending and publishes Rejected event", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      let eventReceived = false

      const unsub = Bus.subscribe(Elicitation.Event.Rejected, () => {
        eventReceived = true
      })

      Elicitation.handle("test-server", createElicitRequest())
      const pending = await Elicitation.list()

      await Elicitation.cancel(pending[0].id)
      await new Promise((resolve) => setTimeout(resolve, 50))

      unsub()

      const pendingAfter = await Elicitation.list()
      expect(pendingAfter.length).toBe(0)
      expect(eventReceived).toBe(true)
    },
  })
})

test("cancel - does nothing for unknown id", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await Elicitation.cancel("elicitation_unknown")
      // Should not throw
    },
  })
})

// cancelAllForServer tests

test("cancelAllForServer - removes all pending for specific server", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      Elicitation.handle("server1", createElicitRequest("Request 1"))
      Elicitation.handle("server1", createElicitRequest("Request 2"))
      Elicitation.handle("server2", createElicitRequest("Request 3"))

      let pendingBefore = await Elicitation.list()
      expect(pendingBefore.length).toBe(3)

      await Elicitation.cancelAllForServer("server1")

      const pendingAfter = await Elicitation.list()
      expect(pendingAfter.length).toBe(1)
      expect(pendingAfter[0].serverName).toBe("server2")
    },
  })
})

// abort signal tests

test("handle - cleans up on abort signal", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const abortController = new AbortController()
      let rejectedEventReceived = false

      const unsub = Bus.subscribe(Elicitation.Event.Rejected, () => {
        rejectedEventReceived = true
      })

      Elicitation.handle("test-server", createElicitRequest(), abortController.signal)

      const pending = await Elicitation.list()
      expect(pending.length).toBe(1)

      abortController.abort()
      await new Promise((resolve) => setTimeout(resolve, 50))

      unsub()

      const pendingAfter = await Elicitation.list()
      expect(pendingAfter.length).toBe(0)
      expect(rejectedEventReceived).toBe(true)
    },
  })
})
