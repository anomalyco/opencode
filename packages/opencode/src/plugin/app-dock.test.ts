import { expect, test } from "bun:test"
import type { Hooks, PluginInput, ToolContext } from "@opencode-ai/plugin"
import { AppDockPlugin, createAppDockHooks } from "./app-dock"

const context = { ask: async () => {} } as unknown as ToolContext
const input = {} as PluginInput

type FakePort = {
  postMessage(message: unknown): void
  on(event: string, listener: (event: { data: unknown }) => void): void
}

function fakePort(): { port: FakePort; sent: unknown[]; deliver: (payload: unknown) => void } {
  const sent: unknown[] = []
  const listeners: Array<(event: { data: unknown }) => void> = []
  return {
    sent,
    port: {
      postMessage(message: unknown) {
        sent.push(message)
      },
      on(_event: string, listener: (event: { data: unknown }) => void) {
        listeners.push(listener)
      },
    },
    deliver(payload: unknown) {
      for (const listener of listeners) listener({ data: payload })
    },
  }
}

const toolNames = [
  "dock_list",
  "dock_activate",
  "dock_read",
  "dock_wait",
  "dock_screenshot",
  "dock_scroll",
  "dock_keyboard",
  "dock_evaluate",
  "dock_storage",
  "dock_network",
  "dock_click",
  "dock_type",
  "dock_navigate",
  "dock_go",
  "dock_open",
  "dock_close",
]

test("AppDockPlugin registers no tools without parentPort", async () => {
    const hooks = await AppDockPlugin(input)
    expect(hooks.tool ?? {}).toEqual({})
})

test("AppDockPlugin registers dock_* tools when parentPort present", async () => {
    const { port } = fakePort()
    const hooks = createAppDockHooks(port) as Required<Hooks>
    expect(Object.keys(hooks.tool).sort()).toEqual([...toolNames].sort())
})

test("AppDockPlugin executes posts dock.rpc envelope and resolves matching result", async () => {
    const { port, sent, deliver } = fakePort()
    const hooks = createAppDockHooks(port) as Required<Hooks>
    const promise = hooks.tool.dock_list.execute({}, context)
    await new Promise((resolve) => setTimeout(resolve, 0))
    const envelope = sent[0] as { type: string; id: string; op: string; args: Record<string, unknown> }
    expect(envelope.type).toBe("dock.rpc")
    expect(envelope.op).toBe("list")
    expect(typeof envelope.id).toBe("string")
    expect(envelope.id.length).toBeGreaterThan(0)
    deliver({ type: "dock.rpc.result", id: envelope.id, ok: true, value: { count: 2 } })
    await expect(promise).resolves.toBe('{\n  "count": 2\n}')
})

test("AppDockPlugin asks scoped dock permission before sending RPC", async () => {
    const { port, sent, deliver } = fakePort()
    const requests: unknown[] = []
    const hooks = createAppDockHooks(port) as Required<Hooks>
    const promise = hooks.tool.dock_evaluate.execute(
      { script: "document.title" },
      { ...context, ask: async (request) => void requests.push(request) },
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(requests).toEqual([
      { permission: "dock", patterns: ["evaluate"], always: ["evaluate"], metadata: { operation: "evaluate" } },
    ])
    const envelope = sent[0] as { id: string; op: string }
    expect(envelope.op).toBe("evaluate")
    deliver({ type: "dock.rpc.result", id: envelope.id, ok: true, value: "ok" })
    await expect(promise).resolves.toBe('"ok"')
})

test("AppDockPlugin ignores results for other request ids", async () => {
    const { port, sent, deliver } = fakePort()
    const hooks = createAppDockHooks(port) as Required<Hooks>
    const promise = hooks.tool.dock_list.execute({}, context)
    await new Promise((resolve) => setTimeout(resolve, 0))
    const envelope = sent[0] as { id: string }
    deliver({ type: "dock.rpc.result", id: "other", ok: true, value: 1 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    deliver({ type: "dock.rpc.result", id: envelope.id, ok: true, value: 2 })
    await expect(promise).resolves.toBe("2")
})

test("AppDockPlugin rejects with error message from result", async () => {
    const { port, sent, deliver } = fakePort()
    const hooks = createAppDockHooks(port) as Required<Hooks>
    const promise = hooks.tool.dock_click.execute({ ref: 7 }, context)
    await new Promise((resolve) => setTimeout(resolve, 0))
    const envelope = sent[0] as { id: string; op: string; args: { ref: number } }
    expect(envelope.op).toBe("click")
    expect(envelope.args.ref).toBe(7)
    deliver({ type: "dock.rpc.result", id: envelope.id, ok: false, error: { message: "Element ref 7 is gone" } })
    await expect(promise).resolves.toBe("Element ref 7 is gone")
})

test("AppDockPlugin passes typed args through envelope", async () => {
    const { port, sent, deliver } = fakePort()
    const hooks = createAppDockHooks(port) as Required<Hooks>
    const promise = hooks.tool.dock_read.execute({ budget: 25, maxText: 400 }, context)
    await new Promise((resolve) => setTimeout(resolve, 0))
    const envelope = sent[0] as { id: string; op: string; args: { budget: number; maxText: number } }
    expect(envelope.op).toBe("read")
    expect(envelope.args).toEqual({ budget: 25, maxText: 400 })
    const go = hooks.tool.dock_go.execute({ command: "back" }, context)
    await new Promise((resolve) => setTimeout(resolve, 0))
    const goEnvelope = sent[1] as { id: string; op: string; args: { command: string } }
    expect(goEnvelope.op).toBe("go")
    expect(goEnvelope.args.command).toBe("back")
    deliver({ type: "dock.rpc.result", id: envelope.id, ok: true, value: "done" })
    deliver({ type: "dock.rpc.result", id: goEnvelope.id, ok: true, value: "gone" })
    await expect(promise).resolves.toBe('"done"')
    await expect(go).resolves.toBe('"gone"')
})

test("AppDockPlugin routes coordinate clicks and scoped closes without destructive defaults", async () => {
    const { port, sent, deliver } = fakePort()
    const hooks = createAppDockHooks(port) as Required<Hooks>

    const click = hooks.tool.dock_click.execute({ x: 12, y: 34 }, context)
    await new Promise((resolve) => setTimeout(resolve, 0))
    const clickEnvelope = sent[0] as { id: string; op: string; args: Record<string, unknown> }
    expect(clickEnvelope).toMatchObject({ op: "clickAt", args: { x: 12, y: 34 } })
    deliver({ type: "dock.rpc.result", id: clickEnvelope.id, ok: true, value: { ok: true } })
    await expect(click).resolves.toBe("{\n  \"ok\": true\n}")

    const close = hooks.tool.dock_close.execute({ tabID: "tab-1" }, context)
    await new Promise((resolve) => setTimeout(resolve, 0))
    const closeEnvelope = sent[1] as { id: string; op: string; args: Record<string, unknown> }
    expect(closeEnvelope).toMatchObject({ op: "close", args: { tabID: "tab-1" } })
    deliver({ type: "dock.rpc.result", id: closeEnvelope.id, ok: true, value: [] })
    await expect(close).resolves.toBe("[]")
})
