/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { TextAttributes } from "@opentui/core"
import { testRender, useRenderer } from "@opentui/solid"
import type { PermissionRequest } from "@opencode-ai/sdk/v2"
import { onCleanup } from "solid-js"
import { PermissionPrompt } from "./permission"
import { ArgsProvider } from "../../context/args"
import { KVProvider } from "../../context/kv"
import { ProjectProvider } from "../../context/project"
import { SDKProvider } from "../../context/sdk"
import { SyncProvider } from "../../context/sync"
import { PermissionProvider } from "../../context/permission"
import { ExitProvider } from "../../context/exit"
import { LocationProvider } from "../../context/location"
import { ThemeProvider } from "../../context/theme"
import { TuiConfigProvider } from "../../config"
import { OpencodeKeymapProvider, registerOpencodeKeymap } from "../../keymap"
import { createFetch, eventSource, json } from "../../../test/fixture/tui-sdk"
import { TestTuiContexts } from "../../../test/fixture/tui-environment"
import { createTuiResolvedConfig } from "../../../test/fixture/tui-runtime"
import { tmpdir } from "../../../test/fixture/fixture"
import { wait } from "../../../test/cli/cmd/tui/sync-fixture"

async function mount(permission: string, description: unknown) {
  const tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const replies: unknown[] = []
  const calls = createFetch()
  const fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      if (input instanceof Request && new URL(input.url).pathname.endsWith("/reply")) {
        replies.push(await input.json())
        return json(true)
      }
      return calls.fetch(input, init)
    },
    { preconnect: () => {} },
  )
  const request = {
    id: "permission-test",
    sessionID: "session-test",
    permission,
    patterns: ["../config/*"],
    always: ["../config/*"],
    metadata: { description },
  } as PermissionRequest

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const config = createTuiResolvedConfig()
    onCleanup(registerOpencodeKeymap(keymap, renderer, config))
    return (
      <TestTuiContexts paths={{ state: tmp.path }}>
        <LocationProvider>
          <OpencodeKeymapProvider keymap={keymap}>
            <TuiConfigProvider config={config}>
              <ArgsProvider>
                <KVProvider>
                  <ThemeProvider mode="dark" source={{ discover: async () => ({}) }}>
                    <SDKProvider url="http://test" events={eventSource()} fetch={fetch}>
                      <PermissionProvider>
                        <ProjectProvider>
                          <ExitProvider exit={() => {}}>
                            <SyncProvider>
                              <PermissionPrompt request={request} />
                            </SyncProvider>
                          </ExitProvider>
                        </ProjectProvider>
                      </PermissionProvider>
                    </SDKProvider>
                  </ThemeProvider>
                </KVProvider>
              </ArgsProvider>
            </TuiConfigProvider>
          </OpencodeKeymapProvider>
        </LocationProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />, { width: 100, height: 25, kittyKeyboard: true })
  await wait(() => app.renderer.root.getChildren().length > 0)
  await app.renderOnce()
  return {
    ...app,
    replies,
    async [Symbol.asyncDispose]() {
      app.renderer.destroy()
      await tmp[Symbol.asyncDispose]()
    },
  }
}

test.each([
  ["read", "Read"],
  ["external_directory", "Access external directory"],
  ["bash", "Shell command"],
])("%s prompt renders the reason before its scope", async (permission, scope) => {
  await using app = await mount(permission, "  Inspect external config  ")
  const lines = app
    .captureCharFrame()
    .split("\n")
    .map((line) => line.trim())
  const reason = lines.findIndex((line) => line.includes("Reason: Inspect external config"))
  expect(reason).toBeGreaterThan(-1)
  expect(lines[reason + 1]).toBe("┃")
  expect(lines[reason + 2]).toContain(scope)
  const spans = app.captureSpans().lines[reason].spans
  expect(
    spans.find((span) => span.text.includes("Reason:"))!.attributes & (TextAttributes.BOLD | TextAttributes.ITALIC),
  ).toBe(0)
  expect(spans.find((span) => span.text.includes("Inspect external config"))!.attributes & TextAttributes.ITALIC).toBe(
    TextAttributes.ITALIC,
  )
})

test.each([
  ["read", undefined],
  ["read", "  "],
  ["bash", false],
  ["external_directory", 42],
  ["task", "Task hint"],
  ["skill", "Skill hint"],
  ["background", "Process hint"],
])("%s prompt hides invalid or unrelated reason %j", async (permission, description) => {
  await using app = await mount(permission as string, description)
  expect(app.captureCharFrame()).toContain("Permission required")
  expect(app.captureCharFrame()).not.toContain("Reason:")
})

test("permission controls allow once, cancel always, confirm always, and reject", async () => {
  await using app = await mount("external_directory", "Inspect external config")
  app.mockInput.pressEnter()
  await wait(() => app.replies.length === 1)
  expect(app.replies[0]).toEqual({ reply: "once" })

  app.mockInput.pressArrow("right")
  app.mockInput.pressEnter()
  await app.renderOnce()
  expect(app.captureCharFrame()).toContain("Always allow")
  expect(app.captureCharFrame()).not.toContain("Reason:")
  app.mockInput.pressEscape()
  await app.renderOnce()
  expect(app.captureCharFrame()).toContain("Reason: Inspect external config")
  expect(app.replies).toHaveLength(1)

  app.mockInput.pressArrow("right")
  app.mockInput.pressEnter()
  await app.renderOnce()
  app.mockInput.pressEnter()
  await wait(() => app.replies.length === 2)
  expect(app.replies[1]).toEqual({ reply: "always" })
  app.mockInput.pressEscape()
  await wait(() => app.replies.length === 3)
  expect(app.replies[2]).toEqual({ reply: "reject" })
})
