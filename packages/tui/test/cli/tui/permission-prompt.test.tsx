/** @jsxImportSource @opentui/solid */
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import type { PermissionRequest } from "@opencode-ai/sdk/v2"
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { onCleanup } from "solid-js"
import { TuiConfigProvider } from "../../../src/config"
import { ArgsProvider } from "../../../src/context/args"
import { ExitProvider } from "../../../src/context/exit"
import { KVProvider } from "../../../src/context/kv"
import { LocationProvider } from "../../../src/context/location"
import { ProjectProvider } from "../../../src/context/project"
import { SDKProvider } from "../../../src/context/sdk"
import { SyncProvider } from "../../../src/context/sync"
import { ThemeProvider } from "../../../src/context/theme"
import { OpencodeKeymapProvider, registerOpencodeKeymap } from "../../../src/keymap"
import { PermissionPrompt } from "../../../src/routes/session/permission"
import { tmpdir } from "../../fixture/fixture"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createFetch, eventSource } from "../../fixture/tui-sdk"

async function wait(fn: () => boolean, timeout = 2000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

async function mount(input: { root: string; onReply: (reply: string) => void }) {
  const state = path.join(input.root, "state")
  await mkdir(state, { recursive: true })
  await Bun.write(path.join(state, "kv.json"), "{}")
  const request = {
    id: "perm_test",
    sessionID: "ses_test",
    permission: "bash",
    patterns: ["*"],
    metadata: {},
    always: ["*"],
  } satisfies PermissionRequest

  const fallback = createFetch().fetch
  const fetch = (async (raw, init) => {
    const url = new URL(raw instanceof Request ? raw.url : String(raw))
    if (url.pathname === "/project/proj_test/directories") {
      return new Response(JSON.stringify([]), { headers: { "content-type": "application/json" } })
    }
    if (url.pathname === "/permission/perm_test/reply") {
      const body = raw instanceof Request ? await raw.json() : JSON.parse(String(init?.body ?? "{}"))
      const reply = typeof body === "object" && body && "reply" in body ? body.reply : undefined
      if (typeof reply !== "string") throw new Error("missing permission reply")
      input.onReply(reply)
      return new Response(JSON.stringify({}), { headers: { "content-type": "application/json" } })
    }
    return fallback(raw, init)
  }) as typeof globalThis.fetch

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const config = createTuiResolvedConfig()
    const off = registerOpencodeKeymap(keymap, renderer, config)
    onCleanup(off)

    return (
      <TestTuiContexts directory={input.root} paths={{ home: input.root, state, worktree: input.root }}>
        <OpencodeKeymapProvider keymap={keymap}>
          <TuiConfigProvider config={config}>
            <ArgsProvider>
              <ExitProvider exit={() => {}}>
                <KVProvider>
                  <ThemeProvider mode="dark" source={{ discover: async () => ({}) }}>
                    <SDKProvider url="http://test" directory={input.root} fetch={fetch} events={eventSource()}>
                      <ProjectProvider>
                        <LocationProvider>
                          <SyncProvider>
                            <PermissionPrompt request={request} directory={input.root} />
                          </SyncProvider>
                        </LocationProvider>
                      </ProjectProvider>
                    </SDKProvider>
                  </ThemeProvider>
                </KVProvider>
              </ExitProvider>
            </ArgsProvider>
          </TuiConfigProvider>
        </OpencodeKeymapProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />, { kittyKeyboard: true })
  return {
    app,
    async cleanup() {
      app.renderer.destroy()
    },
  }
}

async function captureReply(
  key: string,
  confirm?: (input: Awaited<ReturnType<typeof mount>>, replies: string[]) => void | Promise<void>,
) {
  await using tmp = await tmpdir()
  const replies: string[] = []
  const prompt = await mount({ root: tmp.path, onReply: (reply) => replies.push(reply) })

  try {
    await Bun.sleep(10)
    prompt.app.mockInput.pressKey(key)
    await confirm?.(prompt, replies)

    await wait(() => replies.length === 1)
    return replies[0]
  } finally {
    await prompt.cleanup()
  }
}

test("permission prompt number keys choose matching permission responses", async () => {
  expect(await captureReply("1")).toBe("once")
  expect(
    await captureReply("2", async (prompt, replies) => {
      await Bun.sleep(20)
      expect(replies).toEqual([])
      prompt.app.mockInput.pressEnter()
    }),
  ).toBe("always")
  expect(await captureReply("3")).toBe("reject")
})
