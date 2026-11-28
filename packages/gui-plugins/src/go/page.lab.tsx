import type { UsageLimitsGo, UsageLimitsGoConnection } from "@opencode/client/promise"
import { usePlugin } from "@opencode/plugin/gui"
import { PluginContext } from "@opencode/plugin/gui/host"
import { createSignal, Show } from "solid-js"
import { SettingsPanel } from "../../../stories/mocks/gui-plugins/settings-page"
import GoPage, { type GoServer } from "./page"

const hour = 3_600_000

const usage = (weekly: { percent: number; limited: boolean }): UsageLimitsGo => ({
  rolling: { percent: 42, limited: false, resetsAt: Date.now() + 3 * hour + 20 * 60_000 },
  weekly: { ...weekly, resetsAt: Date.now() + 52 * hour },
  monthly: { percent: 18.4, limited: false, resetsAt: Date.now() + 19 * 24 * hour },
})

const account = {
  connection: "account",
  workspace: { id: "wrk_story", name: "Acme", goURL: "https://opencode.ai/console/wrk_story/go" },
} as const satisfies UsageLimitsGoConnection

const key = { connection: "key" } as const satisfies UsageLimitsGoConnection

type Fixture = {
  readonly go: UsageLimitsGoConnection | null
  /** `pending` never answers; `fails-once` fails the first load and answers the next. */
  readonly load?: "pending" | "fails-once"
}

// Subscribe, Manage and Connect leave the page, so the story names what they asked for instead.
function GoStory(props: { fixture: Fixture }) {
  const [go, setGo] = createSignal<UsageLimitsGoConnection | null>()
  const [action, setAction] = createSignal<string>()
  const failures = { left: props.fixture.load === "fails-once" ? 1 : 0 }

  const sync = async () => {
    if (props.fixture.load === "pending") return new Promise<void>(() => undefined)

    if (failures.left-- > 0) throw new Error("offline")
    setGo(props.fixture.go)
  }

  const server: GoServer = {
    id: "story",
    data: { location: { usage: { go: { info: go, sync, invalidate: () => undefined } } } },
  }

  const context = Object.create(usePlugin(), {
    system: { value: { openExternal: (url: string) => setAction(`Opened ${url}`) } },
    layout: {
      value: {
        connect: (input: { integration: string; method?: string }) =>
          setAction(`Connecting ${input.integration} by ${input.method}`),
      },
    },
  })

  return (
    <PluginContext.Provider value={context}>
      <SettingsPanel>
        <GoPage server={() => server} />
        <Show when={action()}>{(text) => <p role="status">{text()}</p>}</Show>
      </SettingsPanel>
    </PluginContext.Provider>
  )
}

const story = (fixture: Fixture) => ({ render: () => <GoStory fixture={fixture} /> })

export default {
  title: "App/Plugins/OpenCode Go",
  id: "plugins-go",
  parameters: {
    docs: {
      description: { component: "The OpenCode Go settings page in each connection state, from local fixtures." },
    },
  },
}

/** Nothing connects Go: Subscribe, and Connect. */
export const NotConnected = story({ go: null })

/** The OpenCode account connects Go, and its workspace subscribes. */
export const Account = story({ go: { ...account, usage: usage({ percent: 64, limited: false }) } })

/** An API key connects Go, and its workspace subscribes. */
export const Key = story({ go: { ...key, usage: usage({ percent: 64, limited: false }) } })

/** The account's workspace has no active subscription. */
export const AccountInactive = story({ go: account })

/** The key's workspace has no active subscription. */
export const KeyInactive = story({ go: key })

/** One window is at its limit. */
export const LimitReached = story({ go: { ...account, usage: usage({ percent: 100, limited: true }) } })

/** The first load, before the server answers. */
export const Loading = story({ go: account, load: "pending" })

/** The first load fails; Try again loads the usage. */
export const Failed = story({ go: { ...account, usage: usage({ percent: 64, limited: false }) }, load: "fails-once" })
