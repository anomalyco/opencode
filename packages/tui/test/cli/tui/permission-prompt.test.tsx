/** @jsxImportSource @opentui/solid */
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import type { GlobalEvent, PermissionRequest, ToolPart } from "@opencode-ai/sdk/v2"
import { expect, test } from "bun:test"
import { onCleanup, onMount } from "solid-js"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createEventSource, createFetch, directory } from "../../fixture/tui-sdk"
import { tmpdir } from "../../fixture/fixture"
import { ArgsProvider } from "../../../src/context/args"
import { ExitProvider } from "../../../src/context/exit"
import { KVProvider } from "../../../src/context/kv"
import { LocationProvider } from "../../../src/context/location"
import { PermissionProvider } from "../../../src/context/permission"
import { ProjectProvider } from "../../../src/context/project"
import { SDKProvider } from "../../../src/context/sdk"
import { SyncProvider, useSync } from "../../../src/context/sync"
import { ThemeProvider } from "../../../src/context/theme"
import { TuiConfigProvider } from "../../../src/config"
import { OpencodeKeymapProvider, registerOpencodeKeymap } from "../../../src/keymap"
import { PermissionPrompt } from "../../../src/routes/session/permission"

const sessionID = "ses_permission_test"
const messageID = "msg_permission_test"
const partID = "prt_permission_test"
const callID = "call_permission_test"

function global(payload: GlobalEvent["payload"]): GlobalEvent {
  return { directory: "/tmp/other", project: "proj_test", payload }
}

function toolPart(input: Record<string, unknown>): ToolPart {
  return {
    id: partID,
    sessionID,
    messageID,
    type: "tool",
    callID,
    tool: "bash",
    state: { status: "running", input, time: { start: 0 } },
  }
}

function bashRequest(command: string): PermissionRequest {
  return {
    id: "perm_permission_test",
    sessionID,
    permission: "bash",
    patterns: [],
    metadata: {},
    always: [],
    tool: { messageID, callID },
  }
}

async function wait(fn: () => boolean, timeout = 2000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

async function mountPrompt(request: PermissionRequest, options?: { width?: number; height?: number; state?: string }) {
  const calls = createFetch()
  const events = createEventSource()
  let sync!: ReturnType<typeof useSync>
  let done!: () => void
  const ready = new Promise<void>((resolve) => {
    done = resolve
  })

  function Probe() {
    sync = useSync()
    onMount(done)
    return <box />
  }

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const resolvedConfig = createTuiResolvedConfig({ leader_timeout: 1000 })
    const off = registerOpencodeKeymap(keymap, renderer, resolvedConfig)
    onCleanup(off)

    return (
      <TestTuiContexts paths={options?.state ? { state: options.state } : undefined}>
        <ArgsProvider>
          <KVProvider>
            <SDKProvider url="http://test" directory={directory} fetch={calls.fetch} events={events.source}>
              <PermissionProvider>
                <ProjectProvider>
                  <ExitProvider exit={() => {}}>
                    <SyncProvider>
                      <Probe />
                      <OpencodeKeymapProvider keymap={keymap}>
                        <TuiConfigProvider config={resolvedConfig}>
                          <ThemeProvider mode="dark">
                            <LocationProvider location={{ directory, workspaceID: "ws_test" }}>
                              <PermissionPrompt request={request} directory={directory} />
                            </LocationProvider>
                          </ThemeProvider>
                        </TuiConfigProvider>
                      </OpencodeKeymapProvider>
                    </SyncProvider>
                  </ExitProvider>
                </ProjectProvider>
              </PermissionProvider>
            </SDKProvider>
          </KVProvider>
        </ArgsProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />, {
    width: options?.width ?? 60,
    height: options?.height ?? 12,
  })
  await ready
  return {
    app,
    sync,
    emit: events.emit,
    async cleanup() {
      app.renderer.destroy()
    },
  }
}

test("long shell command keeps permission buttons visible", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const command = "echo " + "longword ".repeat(400) + "UNIQUE_TAIL_MARKER"
  const prompt = await mountPrompt(bashRequest(command), { height: 12, state: tmp.path })

  try {
    prompt.emit(global({ id: "evt_part", type: "message.part.updated", properties: { sessionID, time: 1, part: toolPart({ command }) } }))
    await wait(() => {
      const part = prompt.sync.data.part[messageID]?.[0]
      return part?.type === "tool" && part.state.status === "running"
    })
    await wait(() => prompt.app.captureCharFrame().includes("Allow once"))
    const frame = prompt.app.captureCharFrame()

    expect(frame).toContain("Allow always")
    expect(frame).toContain("Reject")
    expect(frame).toContain("$ echo")
    expect(frame).toContain("▀")
    expect(frame).not.toContain("UNIQUE_TAIL_MARKER")
  } finally {
    await prompt.cleanup()
  }
})

test("short shell command renders fully with buttons visible", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const command = "echo hello"
  const prompt = await mountPrompt(bashRequest(command), { height: 12, state: tmp.path })

  try {
    prompt.emit(global({ id: "evt_part", type: "message.part.updated", properties: { sessionID, time: 1, part: toolPart({ command }) } }))
    await wait(() => {
      const part = prompt.sync.data.part[messageID]?.[0]
      return part?.type === "tool" && part.state.status === "running"
    })
    await wait(() => prompt.app.captureCharFrame().includes("Allow once"))
    const frame = prompt.app.captureCharFrame()

    expect(frame).toContain("$ echo hello")
    expect(frame).toContain("Allow always")
    expect(frame).toContain("Reject")
    expect(frame).not.toContain("▀")
  } finally {
    await prompt.cleanup()
  }
})
