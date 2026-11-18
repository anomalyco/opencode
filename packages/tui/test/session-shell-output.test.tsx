import { expect, test } from "bun:test"
import { TextRenderable, type Renderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect, FileSystem } from "effect"
import { Global } from "@opencode/util/global"
import type { SessionMessageInfo } from "@opencode/client"
import { createEventStream, createFetch, directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"

const session = {
  id: "ses_shell_output",
  title: "Shell output",
  projectID: "proj_test",
  location: { directory },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
}
const messages = [
  { type: "user", id: "user-1", text: "Run it", time: { created: 0 } },
  {
    type: "assistant",
    id: "assistant-1",
    agent: "build",
    model: { providerID: "fixture", id: "fixture" },
    finish: "stop",
    time: { created: 1, completed: 3 },
    content: [
      {
        type: "tool",
        id: "call-background",
        name: "shell",
        time: { created: 1, completed: 2 },
        state: {
          input: { command: "render-frames" },
          status: "completed",
          content: [],
          metadata: { shellID: "sh_background", status: "running" },
        },
      },
      { type: "text", text: "Started it" },
    ],
  },
] as SessionMessageInfo[]

test("an expanded background shell keeps its 1 MiB tail on a whole character", async () => {
  await using state = await tmpdir()
  // Two 1 MiB byte pages decode to 1 MiB + 1 code units, so the retained tail would start on the emoji's second half.
  const rest = ("x".repeat(1023) + "\n").repeat(1023) + "x".repeat(1023)
  const bytes = Buffer.from(`😀${rest}`)
  const setup = await createTestRenderer({ width: 100, height: 40, kittyKeyboard: true })
  await setup.renderer.setupTerminal()
  setup.renderer.start()
  const calls = createFetch((url) => {
    if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
    if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
    if (url.pathname === `/api/session/${session.id}/message`) return json({ data: messages.toReversed(), cursor: {} })
    if (url.pathname === `/api/session/${session.id}/inbox` || url.pathname === `/api/session/${session.id}/permission`)
      return json({ data: [] })
    if (url.pathname === "/api/shell/sh_background/output") {
      const cursor = Number(url.searchParams.get("cursor"))
      const end = Math.min(bytes.length, cursor + Number(url.searchParams.get("limit")))
      return json({ data: { output: bytes.subarray(cursor, end).toString(), cursor: end, size: bytes.length } })
    }
  }, createEventStream())
  const server = Bun.serve({ port: 0, idleTimeout: 0, fetch: (request) => calls.fetch(request) })
  const { run } = await import("../src/app")
  const task = Effect.runPromise(
    run({
      app: { name: "test", version: "test", channel: "test" },
      server: { endpoint: { url: server.url.toString() } },
      config: {
        get: async () => ({ animations: false, tabs: { enabled: false }, session: { verbosity: "high" } }),
        update: async () => ({}),
      },
      packages: { prepare: async () => ({ directory: "" }) },
      args: { sessionID: session.id },
      terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: () => {} }),
      log: () => {},
    }).pipe(Effect.provide(Global.layerWith({ state: state.path })), Effect.provide(FileSystem.layerNoop({}))),
  )
  try {
    await setup.waitForFrame((frame) => frame.includes("Started it"))
    const row = setup
      .captureCharFrame()
      .split("\n")
      .findIndex((line) => line.includes("$ render-frames"))
    await setup.mockMouse.click(10, row)
    const output = await waitForText(setup.renderer.root, (text) => text.startsWith("[earlier output omitted]"))
    expect(output).toBe(`[earlier output omitted]\n${rest}`)
  } finally {
    setup.renderer.destroy()
    await task
    await server.stop()
  }
})

async function waitForText(root: Renderable, matches: (text: string) => boolean) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const found = texts(root).find(matches)
    if (found !== undefined) return found
    await Bun.sleep(10)
  }
  throw new Error("Timed out waiting for shell output")
}

function texts(node: Renderable): string[] {
  return [
    ...(node instanceof TextRenderable ? [node.plainText] : []),
    ...node.getChildren().flatMap((child) => texts(child as Renderable)),
  ]
}
