/** @jsxImportSource @opentui/solid */
// P-COMP fixtures for the model, agent, variant, usage, model usage, and Go upsell dialogs (E.16):
// crates/tui/tests/all/models.rs. Each dialog opens over the real TUI providers, LocalProvider included, against
// the routes in parity/fixtures/E.16/server.json and the model.json below, which the Rust test serves too.
import { testRender } from "@opentui/solid"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { JSX } from "solid-js"
import { DialogAgent } from "../../../tui/src/component/dialog-agent"
import { DialogGoUpsell } from "../../../tui/src/component/dialog-go-upsell"
import { DialogModel } from "../../../tui/src/component/dialog-model"
import { DialogVariant } from "../../../tui/src/component/dialog-variant"
import { DialogUsage, DialogUsageModel } from "../../../tui/src/component/usage"
import { ConfigProvider } from "../../../tui/src/config"
import { ArgsProvider } from "../../../tui/src/context/args"
import { ClientProvider } from "../../../tui/src/context/client"
import { DataProvider, useData } from "../../../tui/src/context/data"
import { Keymap } from "../../../tui/src/context/keymap"
import { LocalProvider, useLocal } from "../../../tui/src/context/local"
import { LocationProvider } from "../../../tui/src/context/location"
import { PermissionProvider } from "../../../tui/src/context/permission"
import { RouteProvider } from "../../../tui/src/context/route"
import { ThemeProvider } from "../../../tui/src/context/theme"
import { DialogProvider, useDialog } from "../../../tui/src/ui/dialog"
import { ToastProvider } from "../../../tui/src/ui/toast"
import { emptyThemeSource } from "../../../tui/test/fixture/fixture"
import { createApi, createEventStream, createFetch, directory, json } from "../../../tui/test/fixture/tui-client"
import { TestTuiContexts } from "../../../tui/test/fixture/tui-environment"
import { createTuiResolvedConfig } from "../../../tui/test/fixture/tui-runtime"
import { withNewDesigns } from "../lib/app"
import { readCells, writeFixture } from "../lib/cells"

const location = { directory }
// Noon UTC, far from today, so the reset reads as a date with a time in any time zone.
const resetsAt = Date.UTC(2030, 0, 15, 12, 0)

const model = (
  providerID: string,
  id: string,
  name: string,
  cost: number,
  extra: { variants?: string[]; context?: number; status?: string } = {},
) => ({
  id,
  modelID: id,
  providerID,
  name,
  status: extra.status ?? "active",
  enabled: true,
  capabilities: { input: ["text", "image"], output: ["text"], tools: true },
  cost: [{ input: cost, output: cost * 5, cache: { read: 0, write: 0 } }],
  limit: { context: extra.context ?? 200_000, output: 32_000 },
  time: { released: 0 },
  variants: (extra.variants ?? []).map((id) => ({ id })),
})

const provider = (id: string, name: string, integrationID?: string) => ({
  id,
  name,
  integrationID,
  activation: "auto",
  package: "@ai-sdk/test",
})

const agent = (id: string, description: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  description,
  mode: "primary",
  hidden: false,
  permissions: [],
  request: { settings: {}, headers: {}, body: {} },
  ...extra,
})

const budget = (id: string, extra: Record<string, unknown>) => ({
  id,
  limit: 50,
  spent: 40,
  scope: "combined",
  per: "set",
  coverage: "all",
  models: [],
  vendors: [],
  picked: false,
  shared: true,
  resetsAt,
  ...extra,
})

// The routes both sides serve, by path.
export const server = {
  "/api/model": [
    model("anthropic", "claude-sonnet", "Claude Sonnet", 3, { variants: ["low", "high"] }),
    model("anthropic", "claude-haiku", "Claude Haiku", 1),
    model("openai", "gpt-5", "GPT-5", 1.25),
    model("openai", "gpt-4", "GPT-4", 30, { status: "deprecated" }),
    model("openai", "gpt-5-mini", "GPT-5 mini", 0.25),
    model("opencode", "big-pickle", "Big Pickle", 0),
    model("opencode", "grok-code", "Grok Code", 2, { context: 2_000_000 }),
  ],
  "/api/provider": [
    provider("anthropic", "Anthropic"),
    provider("openai", "OpenAI"),
    provider("opencode", "OpenCode", "opencode"),
  ],
  "/api/agent": [
    agent("build", "The default agent", { model: { providerID: "anthropic", id: "claude-sonnet", variant: "high" } }),
    agent("plan", "Plans without editing"),
    agent("general", "A subagent", { mode: "subagent" }),
  ],
  "/api/integration": [
    {
      id: "opencode",
      name: "OpenCode Console",
      methods: [{ id: "device", type: "oauth", label: "Sign in with OpenCode" }],
      connections: [{ type: "credential", id: "cred_1", label: "Acme", method: "oauth" }],
    },
  ],
  "/api/experimental/usage/limits": {
    workspace: { id: "wrk_1", name: "Acme", usageURL: "https://opencode.ai/console/wrk_1/usage" },
    budgets: [
      budget("all", {}),
      budget("sonnet", {
        coverage: "models",
        per: "model",
        scope: "each",
        shared: false,
        limit: 10,
        spent: 0,
        models: [{ providerID: "anthropic", modelID: "claude-sonnet", name: "Claude Sonnet", spent: 9.5 }],
      }),
    ],
  },
} as const

export const preferences = {
  recent: [{ providerID: "anthropic", modelID: "claude-haiku" }],
  favorite: [{ providerID: "openai", modelID: "gpt-5" }],
  variant: {},
}

const out = (name: string) => new URL(`../fixtures/E.16/${name}`, import.meta.url).pathname
await Bun.write(out("server.json"), JSON.stringify({ routes: server, preferences }, null, 2) + "\n")

type Setup = Awaited<ReturnType<typeof testRender>>

async function capture(options: {
  fixture: string
  width: number
  height: number
  dialog: () => JSX.Element
  ready: (frame: string) => boolean
  act?: (setup: Setup) => Promise<void> | void
}) {
  const state = await mkdtemp(path.join(tmpdir(), "opencode-e16-"))
  await Bun.write(path.join(state, "model.json"), JSON.stringify(preferences))
  const calls = createFetch((url) => {
    const data = server[url.pathname as keyof typeof server]
    if (data) return json({ location, data })
    if (url.pathname === "/api/config") return json([])
  }, createEventStream())
  let local!: ReturnType<typeof useLocal>
  let data!: ReturnType<typeof useData>
  let dialog!: ReturnType<typeof useDialog>
  function Probe() {
    local = useLocal()
    data = useData()
    dialog = useDialog()
    return <box />
  }
  const setup = await testRender(
    () => (
      <TestTuiContexts paths={{ state }}>
        <ArgsProvider>
          <ConfigProvider
            config={createTuiResolvedConfig(withNewDesigns({ theme: { name: "opencode", mode: "dark" }, animations: false }))}
          >
            <Keymap.Provider>
              <ThemeProvider mode="dark" source={emptyThemeSource}>
                <ToastProvider>
                  <RouteProvider initialRoute={{ type: "home" }}>
                    <ClientProvider api={createApi(calls.fetch)}>
                      <DataProvider directory={directory}>
                        <LocationProvider>
                          <PermissionProvider>
                            <LocalProvider>
                              <DialogProvider>
                                <Probe />
                              </DialogProvider>
                            </LocalProvider>
                          </PermissionProvider>
                        </LocationProvider>
                      </DataProvider>
                    </ClientProvider>
                  </RouteProvider>
                </ToastProvider>
              </ThemeProvider>
            </Keymap.Provider>
          </ConfigProvider>
        </ArgsProvider>
      </TestTuiContexts>
    ),
    { width: options.width, height: options.height, kittyKeyboard: true },
  )
  try {
    const started = Date.now()
    while (!local?.model.ready) {
      if (Date.now() - started > 3_000) throw new Error("model.json never loaded")
      await Bun.sleep(10)
    }
    await data.location.sync()
    await data.location.usage.sync(data.location.default())
    dialog.replace(options.dialog)
    await settle(setup, options.ready)
    if (options.act) {
      await options.act(setup)
      await settle(setup, options.ready)
    }
    const fixture = readCells(setup.renderer.currentRenderBuffer)
    await writeFixture(out(`${options.fixture}.json`), fixture)
    console.log(`component: E.16/${options.fixture} ${fixture.width}x${fixture.height}`)
  } finally {
    setup.renderer.destroy()
    await rm(state, { recursive: true, force: true })
  }
}

async function settle(setup: Setup, ready: (frame: string) => boolean) {
  const deadline = Date.now() + 3_000
  let previous: string | undefined
  while (Date.now() < deadline) {
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    if (ready(frame) && frame === previous) return
    previous = frame
    await Bun.sleep(10)
  }
  throw new Error(`component: no settled ready frame within 3s; last frame:\n${previous}`)
}

const size = { width: 90, height: 34 }
// Tall enough for the whole model list: TS does not scroll to a current model below the first screen
// (parity/deviations/DLG13-model-scroll.md).
const tall = { width: 90, height: 60 }
await capture({ ...tall, fixture: "model", dialog: () => <DialogModel />, ready: (f) => f.includes("usage") })
await capture({
  ...tall,
  fixture: "model-filter",
  dialog: () => <DialogModel />,
  ready: (f) => f.includes("usage"),
  act: (setup) => setup.mockInput.typeText("gpt"),
})
await capture({ ...size, fixture: "agent", dialog: () => <DialogAgent />, ready: (f) => f.includes("plan") })
await capture({ ...size, fixture: "variant", dialog: () => <DialogVariant />, ready: (f) => f.includes("high") })
await capture({ ...size, fixture: "usage", dialog: () => <DialogUsage />, ready: (f) => f.includes("left") })
await capture({
  ...size,
  fixture: "usage-down",
  dialog: () => <DialogUsage />,
  ready: (f) => f.includes("left"),
  act: (setup) => setup.mockInput.pressArrow("down"),
})
await capture({
  ...size,
  fixture: "usage-model",
  dialog: () => <DialogUsageModel model={server["/api/model"][0] as never} />,
  ready: (f) => f.includes("remaining"),
})
// Below 22 rows the upsell is compact and draws no art.
await capture({
  width: 80,
  height: 20,
  fixture: "go-upsell",
  dialog: () => <DialogGoUpsell reset="3:00 PM" onSubscribe={() => {}} onDontShowAgain={() => {}} />,
  ready: (f) => f.includes("subscribe"),
})
