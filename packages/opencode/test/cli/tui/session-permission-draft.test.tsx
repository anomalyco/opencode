/** @jsxImportSource @opentui/solid */
import { afterEach, describe, expect, test } from "bun:test"
import { testRender, useRenderer, type JSX } from "@opentui/solid"
import type { Event, GlobalEvent, PermissionRequest, Provider } from "@opencode-ai/sdk/v2"
import { createEffect, onMount, type ParentProps } from "solid-js"
import { ArgsProvider } from "../../../src/cli/cmd/tui/context/args"
import { ExitProvider } from "../../../src/cli/cmd/tui/context/exit"
import { ProjectProvider } from "../../../src/cli/cmd/tui/context/project"
import { SDKProvider } from "../../../src/cli/cmd/tui/context/sdk"
import { SyncProvider } from "../../../src/cli/cmd/tui/context/sync"
import { ThemeProvider } from "../../../src/cli/cmd/tui/context/theme"
import { LocalProvider } from "../../../src/cli/cmd/tui/context/local"
import { KeybindProvider } from "../../../src/cli/cmd/tui/context/keybind"
import { KVProvider } from "../../../src/cli/cmd/tui/context/kv"
import { PromptStashProvider } from "../../../src/cli/cmd/tui/component/prompt/stash"
import { DialogProvider } from "../../../src/cli/cmd/tui/ui/dialog"
import { CommandProvider } from "../../../src/cli/cmd/tui/component/dialog-command"
import { FrecencyProvider } from "../../../src/cli/cmd/tui/component/prompt/frecency"
import { PromptHistoryProvider } from "../../../src/cli/cmd/tui/component/prompt/history"
import { PromptRefProvider, usePromptRef } from "../../../src/cli/cmd/tui/context/prompt"
import { ToastProvider } from "../../../src/cli/cmd/tui/ui/toast"
import { RouteProvider } from "../../../src/cli/cmd/tui/context/route"
import { TuiConfigProvider } from "../../../src/cli/cmd/tui/context/tui-config"
import { Session } from "../../../src/cli/cmd/tui/routes/session"
import { setupSlots } from "../../../src/cli/cmd/tui/plugin/slots"
import { createTuiPluginApi } from "../../fixture/tui-plugin"
import { tmpdir } from "../../fixture/fixture"

function json(data: unknown) {
  return new Response(JSON.stringify(data), {
    headers: {
      "content-type": "application/json",
    },
  })
}

async function wait(fn: () => boolean, timeout = 2000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

function createSource() {
  let fn: ((event: GlobalEvent) => void) | undefined

  return {
    source: {
      subscribe: async (handler: (event: GlobalEvent) => void) => {
        fn = handler
        return () => {
          if (fn === handler) fn = undefined
        }
      },
    },
    emit(payload: Event) {
      if (!fn) throw new Error("event source not ready")
      fn({
        directory: "/tmp/root",
        payload,
      })
    },
  }
}

function provider(): Provider {
  return {
    id: "anthropic",
    name: "Anthropic",
    source: "api",
    env: [],
    options: {},
    models: {
      sonnet: {
        id: "sonnet",
        providerID: "anthropic",
        api: {
          id: "sonnet",
          url: "https://example.com/sonnet",
          npm: "@ai-sdk/anthropic",
        },
        name: "Sonnet",
        capabilities: {
          temperature: true,
          reasoning: true,
          attachment: true,
          toolcall: true,
          input: {
            text: true,
            audio: false,
            image: true,
            video: false,
            pdf: true,
          },
          output: {
            text: true,
            audio: false,
            image: false,
            video: false,
            pdf: false,
          },
          interleaved: false,
        },
        cost: {
          input: 0,
          output: 0,
          cache: {
            read: 0,
            write: 0,
          },
        },
        limit: {
          context: 200_000,
          output: 8_192,
        },
        status: "active",
        options: {},
        headers: {},
        release_date: "2025-05-14",
      },
    },
  }
}

function createFetch() {
  const item = provider()
  return Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init)
      const url = new URL(req.url)

      if (url.pathname === "/config/providers") {
        return json({ providers: [item], default: { anthropic: "sonnet" } })
      }
      if (url.pathname === "/provider") {
        return json({ all: [item], default: { anthropic: "sonnet" }, connected: ["anthropic"] })
      }
      if (url.pathname === "/experimental/console") {
        return json({})
      }
      if (url.pathname === "/agent") {
        return json([
          {
            name: "build",
            mode: "primary",
            permission: { edit: "ask", bash: "ask", webfetch: "ask" },
          },
          {
            name: "plan",
            mode: "primary",
            permission: { edit: "ask", bash: "ask", webfetch: "ask" },
          },
        ])
      }
      if (url.pathname === "/config") {
        return json({ model: "anthropic/sonnet" })
      }
      if (url.pathname === "/project/current") {
        return json({ id: "proj_1" })
      }
      if (url.pathname === "/path") {
        return json({
          state: "/tmp/root/state",
          config: "/tmp/root/config",
          worktree: "/tmp/root",
          directory: "/tmp/root",
          home: "/tmp/root",
        })
      }
      if (url.pathname === "/session") {
        return json([
          {
            id: "ses_1",
            title: "Test session",
            time: { created: 1, updated: 1 },
          },
        ])
      }
      if (url.pathname === "/command") {
        return json([])
      }
      if (url.pathname === "/lsp") {
        return json([])
      }
      if (url.pathname === "/mcp") {
        return json({})
      }
      if (url.pathname === "/experimental/resource") {
        return json({})
      }
      if (url.pathname === "/formatter") {
        return json([])
      }
      if (url.pathname === "/session/status") {
        return json({})
      }
      if (url.pathname === "/provider/auth") {
        return json({})
      }
      if (url.pathname === "/vcs") {
        return json({ branch: "dev" })
      }
      if (url.pathname === "/experimental/workspace") {
        return json([])
      }
      if (
        url.pathname === "/session/ses_1" ||
        url.pathname === "/session/%7BsessionID%7D" ||
        url.pathname === "/session/{sessionID}"
      ) {
        return json({
          id: "ses_1",
          title: "Test session",
          time: { created: 1, updated: 1 },
        })
      }
      if (
        url.pathname === "/session/ses_1/message" ||
        url.pathname === "/session/%7BsessionID%7D/message" ||
        url.pathname === "/session/{sessionID}/message"
      ) {
        return json([])
      }
      if (
        url.pathname === "/session/ses_1/todo" ||
        url.pathname === "/session/%7BsessionID%7D/todo" ||
        url.pathname === "/session/{sessionID}/todo"
      ) {
        return json([])
      }
      if (
        url.pathname === "/session/ses_1/diff" ||
        url.pathname === "/session/%7BsessionID%7D/diff" ||
        url.pathname === "/session/{sessionID}/diff"
      ) {
        return json([])
      }

      throw new Error(`unexpected request: ${req.method} ${url.pathname}`)
    },
    { preconnect: fetch.preconnect.bind(fetch) },
  ) satisfies typeof fetch
}

function Slots(props: { children: JSX.Element }) {
  const renderer = useRenderer()

  onMount(() => {
    setupSlots(createTuiPluginApi({ renderer }))
  })

  return props.children
}

function Probe(props: { onReady: (ref: ReturnType<typeof usePromptRef>) => void }) {
  const ref = usePromptRef()

  createEffect(() => {
    if (!ref.current) return
    props.onReady(ref)
  })

  return <Session />
}

function Shell(props: ParentProps<{ source: ReturnType<typeof createSource> }>) {
  return (
    <Slots>
      <ArgsProvider continue={false}>
        <ExitProvider>
          <KVProvider>
            <ToastProvider>
              <RouteProvider>
                <TuiConfigProvider config={{}}>
                  <SDKProvider
                    url="http://test"
                    directory="/tmp/root"
                    fetch={createFetch()}
                    events={props.source.source}
                  >
                    <ProjectProvider>
                      <SyncProvider>
                        <ThemeProvider mode="dark">
                          <LocalProvider>
                            <KeybindProvider>
                              <PromptStashProvider>
                                <DialogProvider>
                                  <CommandProvider>
                                    <FrecencyProvider>
                                      <PromptHistoryProvider>
                                        <PromptRefProvider>{props.children}</PromptRefProvider>
                                      </PromptHistoryProvider>
                                    </FrecencyProvider>
                                  </CommandProvider>
                                </DialogProvider>
                              </PromptStashProvider>
                            </KeybindProvider>
                          </LocalProvider>
                        </ThemeProvider>
                      </SyncProvider>
                    </ProjectProvider>
                  </SDKProvider>
                </TuiConfigProvider>
              </RouteProvider>
            </ToastProvider>
          </KVProvider>
        </ExitProvider>
      </ArgsProvider>
    </Slots>
  )
}

async function mount(source: ReturnType<typeof createSource>) {
  let prompt!: ReturnType<typeof usePromptRef>

  const app = await testRender(() => (
    <Shell source={source}>
      <Probe
        onReady={(ref) => {
          prompt = ref
        }}
      />
    </Shell>
  ))

  await wait(() => Boolean(prompt?.current))
  return { app, prompt }
}

describe("session permission draft", () => {
  let home: string | undefined
  let route: string | undefined

  afterEach(() => {
    if (home === undefined) delete process.env.OPENCODE_TEST_HOME
    else process.env.OPENCODE_TEST_HOME = home

    if (route === undefined) delete process.env.OPENCODE_ROUTE
    else process.env.OPENCODE_ROUTE = route
  })

  test("restores prompt draft after permission prompt unmounts the session prompt", async () => {
    await using tmp = await tmpdir()
    home = process.env.OPENCODE_TEST_HOME
    route = process.env.OPENCODE_ROUTE
    process.env.OPENCODE_TEST_HOME = tmp.path
    process.env.OPENCODE_ROUTE = JSON.stringify({
      type: "session",
      sessionID: "ses_1",
    })
    const DRAFT_INPUT = "draft before permission prompt"

    const source = createSource()
    const { app, prompt } = await mount(source)

    try {
      prompt.current!.set({
        input: DRAFT_INPUT,
        mode: "shell",
        parts: [],
      })

      const request: PermissionRequest = {
        id: "perm_1",
        sessionID: "ses_1",
        permission: "bash",
        patterns: [],
        metadata: {},
        always: ["*"],
      }

      source.emit({
        type: "permission.asked",
        properties: request,
      })

      await wait(() => prompt.current === undefined)

      source.emit({
        type: "permission.replied",
        properties: {
          sessionID: "ses_1",
          requestID: "perm_1",
          reply: "once",
        },
      })

      await wait(() => Boolean(prompt.current))
      await wait(() => prompt.current?.current.input === DRAFT_INPUT)

      expect(prompt.current?.current).toEqual({
        input: DRAFT_INPUT,
        mode: "shell",
        parts: [],
      })
    } finally {
      app.renderer.destroy()
    }
  })
})
