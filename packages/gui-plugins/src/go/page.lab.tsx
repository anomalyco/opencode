import type { UsageLimitsInfo } from "@opencode/client/promise"
import { usePlugin } from "@opencode/plugin/gui"
import { PluginContext } from "@opencode/plugin/gui/host"
import { createSignal, Show, type JSX } from "solid-js"
import { SettingsPanel } from "../../../stories/mocks/gui-plugins/settings-page"
import GoPage, { type GoServer } from "./page"

const hour = 3_600_000

const workspace = {
  id: "wrk_story",
  name: "Acme",
  usageURL: "https://opencode.ai/console/wrk_story/activity/overview",
  goURL: "https://opencode.ai/console/wrk_story/go",
}

const subscribed: UsageLimitsInfo = {
  workspace,
  budgets: [],
  go: {
    rolling: { percent: 42, limited: false, resetsAt: Date.now() + 3 * hour + 20 * 60_000 },
    weekly: { percent: 100, limited: true, resetsAt: Date.now() + 52 * hour },
    monthly: { percent: 18.4, limited: false, resetsAt: Date.now() + 19 * 24 * hour },
  },
}

type Fixture = {
  readonly signedIn: boolean
  readonly limits: UsageLimitsInfo | null
  /** `pending` never answers; `fails-once` fails the first load and answers the next. */
  readonly load?: "pending" | "fails-once"
}

// Subscribe, Manage and Sign in leave the page, so the story names what they asked for instead.
function GoStory(props: { fixture: Fixture }) {
  const [limits, setLimits] = createSignal<UsageLimitsInfo | null>()
  const [action, setAction] = createSignal<string>()
  const failures = { left: props.fixture.load === "fails-once" ? 1 : 0 }

  const sync = async () => {
    if (props.fixture.load === "pending") return new Promise<void>(() => undefined)

    if (failures.left-- > 0) throw new Error("offline")
    setLimits(props.fixture.limits)
  }

  const server: GoServer = {
    id: "story",
    data: {
      location: {
        integration: {
          list: () => [
            { id: "opencode", connections: props.fixture.signedIn ? [{ type: "env", name: "OPENCODE_API_KEY" }] : [] },
          ],
          sync: async () => undefined,
        },
        usage: { limits, sync, invalidate: () => undefined },
      },
    },
  }

  const context = Object.create(usePlugin(), {
    system: { value: { openExternal: (url: string) => setAction(`Opened ${url}`) } },
    layout: {
      value: {
        connect: (input: { integration: string }) => setAction(`Connecting ${input.integration}`),
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
    docs: { description: { component: "The OpenCode Go settings page in each account state, from local fixtures." } },
  },
}

/** Signed out of OpenCode: Subscribe, and Sign in. */
export const SignedOut = story({ signedIn: false, limits: null })

/** Signed in to a workspace without an active Go subscription. */
export const NotSubscribed = story({ signedIn: true, limits: { workspace, budgets: [] } })

/** Signed in with an API key, which names no workspace: the server reports no limits. */
export const ApiKey = story({ signedIn: true, limits: null })

/** A Go subscriber, with one window at its limit. */
export const Subscribed = story({ signedIn: true, limits: subscribed })

/** The first load, before the server answers. */
export const Loading = story({ signedIn: true, limits: subscribed, load: "pending" })

/** The first load fails; Try again loads the subscriber's usage. */
export const Failed = story({ signedIn: true, limits: subscribed, load: "fails-once" })
