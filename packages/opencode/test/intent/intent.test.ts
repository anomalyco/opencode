import { expect, test } from "bun:test"
import path from "path"
import { Intent, type IntentInfo } from "../../src/intent"
import { Bus } from "../../src/bus"
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

test("intent - creates pending intent and resolves on response", async () => {
  await Instance.provide({
    directory: projectRoot,
    fn: async () => {
      const requestPromise = Intent.request({
        intent: {
          type: "confirm",
          title: "Test",
          message: "Are you sure?",
        },
        sessionID: "test-session",
        messageID: "test-message",
      })

      const pending = Intent.list("test-session")
      expect(pending.length).toBe(1)
      expect(pending[0].intent.type).toBe("confirm")

      Intent.respond({
        sessionID: "test-session",
        intentID: pending[0].id,
        response: { type: "submit" },
      })

      const response = await requestPromise
      expect(response.type).toBe("submit")

      expect(Intent.list("test-session").length).toBe(0)
    },
  })
})

test("intent - rejects on cancel response", async () => {
  await Instance.provide({
    directory: projectRoot,
    fn: async () => {
      const requestPromise = Intent.request({
        intent: {
          type: "confirm",
          title: "Test",
          message: "Are you sure?",
        },
        sessionID: "test-session-cancel",
        messageID: "test-message",
      })

      const pending = Intent.list("test-session-cancel")

      Intent.respond({
        sessionID: "test-session-cancel",
        intentID: pending[0].id,
        response: { type: "cancel" },
      })

      await expect(requestPromise).rejects.toThrow()
    },
  })
})

test("intent - form helper returns field values", async () => {
  await Instance.provide({
    directory: projectRoot,
    fn: async () => {
      const formPromise = Intent.form({
        title: "Settings",
        fields: [
          {
            type: "select",
            id: "db",
            label: "Database",
            options: [
              { value: "pg", label: "PostgreSQL" },
              { value: "mysql", label: "MySQL" },
            ],
          },
        ],
        sessionID: "test-session-form",
        messageID: "test-message",
      })

      const pending = Intent.list("test-session-form")

      Intent.respond({
        sessionID: "test-session-form",
        intentID: pending[0].id,
        response: { type: "submit", data: { db: "pg" } },
      })

      const result = await formPromise
      expect(result.db).toBe("pg")
    },
  })
})

test("intent - cancelAll cancels all pending intents for session", async () => {
  await Instance.provide({
    directory: projectRoot,
    fn: async () => {
      // Attach rejection handlers before cancelAll to prevent unhandled rejection
      const p1 = Intent.request({
        intent: { type: "confirm", title: "1", message: "1" },
        sessionID: "test-session-cancelall",
        messageID: "m1",
      }).catch((e) => e)
      const p2 = Intent.request({
        intent: { type: "confirm", title: "2", message: "2" },
        sessionID: "test-session-cancelall",
        messageID: "m2",
      }).catch((e) => e)

      expect(Intent.list("test-session-cancelall").length).toBe(2)

      Intent.cancelAll("test-session-cancelall")

      const [err1, err2] = await Promise.all([p1, p2])
      expect(err1).toBeInstanceOf(Error)
      expect(err2).toBeInstanceOf(Error)

      expect(Intent.list("test-session-cancelall").length).toBe(0)
    },
  })
})

test("intent - toast intent returns immediately (non-blocking)", async () => {
  await Instance.provide({
    directory: projectRoot,
    fn: async () => {
      let eventReceived = false
      const unsub = Bus.subscribe(Intent.Event.Updated, (event) => {
        if (event.properties.intent.type === "toast") {
          eventReceived = true
        }
      })

      const response = await Intent.toast({
        message: "Test notification",
        variant: "info",
        sessionID: "test-session-toast",
        messageID: "test-message",
      })

      unsub()

      expect(eventReceived).toBe(true)
      expect(Intent.list("test-session-toast").length).toBe(0)
    },
  })
})

test("intent - select helper returns selected value", async () => {
  await Instance.provide({
    directory: projectRoot,
    fn: async () => {
      const selectPromise = Intent.select({
        title: "Choose database",
        options: [
          { value: "pg", label: "PostgreSQL" },
          { value: "mysql", label: "MySQL" },
        ],
        sessionID: "test-session-select",
        messageID: "test-message",
      })

      const pending = Intent.list("test-session-select")

      Intent.respond({
        sessionID: "test-session-select",
        intentID: pending[0].id,
        response: { type: "submit", data: { selected: "pg" } },
      })

      const result = await selectPromise
      expect(result).toBe("pg")
    },
  })
})

test("intent - multiselect helper returns selected values", async () => {
  await Instance.provide({
    directory: projectRoot,
    fn: async () => {
      const multiselectPromise = Intent.multiselect({
        title: "Choose features",
        options: [
          { value: "auth", label: "Authentication" },
          { value: "api", label: "API" },
          { value: "db", label: "Database" },
        ],
        sessionID: "test-session-multiselect",
        messageID: "test-message",
      })

      const pending = Intent.list("test-session-multiselect")

      Intent.respond({
        sessionID: "test-session-multiselect",
        intentID: pending[0].id,
        response: { type: "submit", data: { selected: ["auth", "api"] } },
      })

      const result = await multiselectPromise
      expect(result).toEqual(["auth", "api"])
    },
  })
})

test("intent - emits intent.updated event when intent is created", async () => {
  await Instance.provide({
    directory: projectRoot,
    fn: async () => {
      let eventReceived = false
      let receivedInfo: IntentInfo | undefined

      const unsub = Bus.subscribe(Intent.Event.Updated, (event) => {
        eventReceived = true
        receivedInfo = event.properties
      })

      const requestPromise = Intent.request({
        intent: {
          type: "confirm",
          title: "Event Test",
          message: "Testing events",
        },
        sessionID: "test-session-event",
        messageID: "test-message",
      })

      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(eventReceived).toBe(true)
      expect(receivedInfo).toBeDefined()
      expect(receivedInfo?.intent.type).toBe("confirm")

      const pending = Intent.list("test-session-event")
      Intent.respond({
        sessionID: "test-session-event",
        intentID: pending[0].id,
        response: { type: "submit" },
      })

      await requestPromise
      unsub()
    },
  })
})
