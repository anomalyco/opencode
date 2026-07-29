import { Browser, BrowserDriver, type BrowserDriverContext, type ChromiumPort } from "@opencode-ai/client/node"
import { describe, expect, test } from "bun:test"

type Port = ChromiumPort<{ readonly name: string }>
type Command = Parameters<Port["send"]>[0]
type Listener = Parameters<Port["subscribe"]>[0]

describe("Chromium browser driver", () => {
  test("snapshots accessibility refs and invalidates them with the document generation", async () => {
    const port = new FakePort()
    const instance = await BrowserDriver.chromium(() => port)({
      proxy: { url: "http://127.0.0.1:1", host: "127.0.0.1", port: 1, credentials: { username: "u", password: "p" } },
      signal: new AbortController().signal,
    } satisfies BrowserDriverContext)
    const execute = (command: Browser.Command) => instance.execute(command, { signal: new AbortController().signal })

    const snapshot = await execute({ type: "snapshot", generation: 0 })
    expect(snapshot).toMatchObject({
      type: "snapshot",
      content: expect.stringContaining('e1 [button] "Save" disabled=false'),
    })
    expect(port.expression).toContain("while (visited++ < 500)")
    expect(port.expression).not.toContain("textContent")
    await execute({ type: "click", ref: Browser.Ref.make("e1"), generation: 0 })

    port.emit()
    expect(instance.resource.state().generation).toBe(1)
    expect(port.commands.some((command) => command.method === "Runtime.releaseObject")).toBe(true)
    await expect(execute({ type: "click", ref: Browser.Ref.make("e1"), generation: 1 })).rejects.toMatchObject({
      code: "stale_ref",
    })
    await instance.resource.dispose()
  })
})

class FakePort implements Port {
  readonly resource = { name: "chromium" }
  readonly listeners = new Set<Listener>()
  readonly commands: Command[] = []
  current = { url: "https://example.com/", title: "Example", loading: false, canGoBack: false, canGoForward: false }
  expression = ""

  state() {
    return this.current
  }
  subscribe(listener: Listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  navigate() {}
  back() {}
  forward() {}
  reload() {}
  stop() {}
  send(command: Command) {
    this.commands.push(command)
    if (command.method === "Runtime.evaluate") {
      this.expression = command.params.expression
      return Promise.resolve({ result: { objectId: "snapshot" } })
    }
    if (command.method !== "Runtime.callFunctionOn") return Promise.resolve({})
    if (command.params.functionDeclaration === "function() { return this.result }") {
      return Promise.resolve({
        result: {
          value: {
            nodes: [{ token: "e1", role: "button", name: "Save", value: "", depth: 1, disabled: false }],
            nextRef: 1,
          },
        },
      })
    }
    return Promise.resolve({ result: { value: { x: 25, y: 40 } } })
  }
  viewport() {
    return { width: 800, height: 600 }
  }
  screenshot() {
    return Promise.resolve({ data: new Uint8Array(), width: 800, height: 600 })
  }
  dispose() {}
  emit() {
    this.current = { ...this.current, url: "https://next.example/" }
    this.listeners.forEach((listener) => listener({ state: this.current, mainDocumentChanged: true }))
  }
}
