import { test, expect, mock, beforeEach } from "bun:test"

let openCalledWith: string | undefined

mock.module("open", () => ({
  default: async (url: string) => {
    openCalledWith = url
    return {} // Return a mock subprocess
  },
}))

// Import modules after mocking
const { Browser, BrowserOpen } = await import("../../src/util/browser")
const { Bus } = await import("../../src/bus")
const { Instance } = await import("../../src/project/instance")
const { tmpdir } = await import("../fixture/fixture")

beforeEach(() => {
  openCalledWith = undefined
  delete process.env.OPENCODE_CALLER
})

test("publishes BrowserOpen event but does not call open when OPENCODE_CALLER=vscode", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      process.env.OPENCODE_CALLER = "vscode"

      const events: Array<{ url: string; callbackPort?: number }> = []
      const unsubscribe = Bus.subscribe(BrowserOpen, (evt) => {
        events.push(evt.properties)
      })

      await Browser.open("https://example.com")

      unsubscribe()

      expect(events.length).toBe(1)
      expect(events[0].url).toBe("https://example.com")
      expect(openCalledWith).toBeUndefined()
    },
  })
})

test("publishes BrowserOpen event and calls open when OPENCODE_CALLER is unset", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      delete process.env.OPENCODE_CALLER

      const events: Array<{ url: string; callbackPort?: number }> = []
      const unsubscribe = Bus.subscribe(BrowserOpen, (evt) => {
        events.push(evt.properties)
      })

      await Browser.open("https://example.com")

      unsubscribe()

      expect(events.length).toBe(1)
      expect(events[0].url).toBe("https://example.com")
      expect(openCalledWith).toBe("https://example.com")
    },
  })
})

test("event payload contains correct url", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const events: Array<{ url: string; callbackPort?: number }> = []
      const unsubscribe = Bus.subscribe(BrowserOpen, (evt) => {
        events.push(evt.properties)
      })

      await Browser.open("https://auth.example.com/login")

      unsubscribe()

      expect(events.length).toBe(1)
      expect(events[0].url).toBe("https://auth.example.com/login")
    },
  })
})

test("event payload contains callbackPort when provided", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const events: Array<{ url: string; callbackPort?: number }> = []
      const unsubscribe = Bus.subscribe(BrowserOpen, (evt) => {
        events.push(evt.properties)
      })

      await Browser.open("https://auth.example.com", { callbackPort: 19876 })

      unsubscribe()

      expect(events.length).toBe(1)
      expect(events[0].url).toBe("https://auth.example.com")
      expect(events[0].callbackPort).toBe(19876)
    },
  })
})

test("open is called with the correct URL in non-VS Code context", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      delete process.env.OPENCODE_CALLER

      await Browser.open("https://specific-url.com")

      expect(openCalledWith).toBe("https://specific-url.com")
    },
  })
})
