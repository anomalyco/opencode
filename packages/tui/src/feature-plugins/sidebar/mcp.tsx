import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, createResource, For, Match, Show, Switch, createSignal, onCleanup } from "solid-js"
import { readJulesMonitor } from "../../util/jules"

const id = "internal:sidebar-mcp"

function View(props: { api: TuiPluginApi }) {
  const [open, setOpen] = createSignal(true)
  const [openJules, setOpenJules] = createSignal(true)
  const theme = () => props.api.theme.current
  const list = createMemo(() => props.api.state.mcp())
  const on = createMemo(() => list().filter((item) => item.status === "connected").length)
  const bad = createMemo(
    () =>
      list().filter(
        (item) =>
          item.status === "failed" || item.status === "needs_auth" || item.status === "needs_client_registration",
      ).length,
  )

  const workspace = () => props.api.state.path.directory
  const [julesTick, setJulesTick] = createSignal(0)
  const [jules] = createResource(
    () => `${workspace()}:${julesTick()}`,
    () => readJulesMonitor(),
    { initialValue: { jobs: [], log: [] } },
  )
  const timer = setInterval(() => setJulesTick((x) => x + 1), 60_000)
  onCleanup(() => clearInterval(timer))
  const julesJobs = createMemo(() =>
    jules().jobs.filter((job) => job.workspace === workspace() || job.workspace === undefined),
  )
  const julesActive = createMemo(() =>
    julesJobs().filter((job) => job.status && job.status !== "COMPLETED" && job.status !== "FAILED").length,
  )

  const dot = (status: string) => {
    if (status === "connected") return theme().success
    if (status === "failed") return theme().error
    if (status === "disabled") return theme().textMuted
    if (status === "needs_auth") return theme().warning
    if (status === "needs_client_registration") return theme().error
    return theme().textMuted
  }

  const julesDot = (status: string | undefined) => {
    switch (status) {
      case "COMPLETED":
        return theme().success
      case "FAILED":
      case "BLOCKED":
        return theme().error
      case "AWAITING_USER_FEEDBACK":
        return theme().warning
      case "IN_PROGRESS":
      case "PLANNING":
      case "QUEUED":
        return theme().info
      default:
        return theme().textMuted
    }
  }

  return (
    <box>
      <Show when={list().length > 0 || julesJobs().length > 0}>
        <box>
          <box flexDirection="row" gap={1} onMouseDown={() => list().length > 2 && setOpen((x) => !x)}>
            <Show when={list().length > 2}>
              <text fg={theme().text}>{open() ? "▼" : "▶"}</text>
            </Show>
            <text fg={theme().text}>
              <b>MCP</b>
              <Show when={!open()}>
                <span style={{ fg: theme().textMuted }}>
                  {" "}
                  ({on()} active{bad() > 0 ? `, ${bad()} error${bad() > 1 ? "s" : ""}` : ""})
                </span>
              </Show>
            </text>
          </box>
          <Show when={list().length <= 2 || open()}>
            <For each={list()}>
              {(item) => (
                <box flexDirection="row" gap={1}>
                  <text
                    flexShrink={0}
                    style={{
                      fg: dot(item.status),
                    }}
                  >
                    •
                  </text>
                  <text fg={theme().text} wrapMode="word">
                    {item.name}{" "}
                    <span style={{ fg: theme().textMuted }}>
                      <Switch fallback={item.status}>
                        <Match when={item.status === "connected"}>Connected</Match>
                        <Match when={item.status === "failed"}>
                          <i>{item.error}</i>
                        </Match>
                        <Match when={item.status === "disabled"}>Disabled</Match>
                        <Match when={item.status === "needs_auth"}>Needs auth</Match>
                        <Match when={item.status === "needs_client_registration"}>Needs client ID</Match>
                      </Switch>
                    </span>
                  </text>
                </box>
              )}
            </For>
          </Show>
        </box>
        <Show when={julesJobs().length > 0}>
          <box>
            <box flexDirection="row" gap={1} onMouseDown={() => julesJobs().length > 1 && setOpenJules((x) => !x)}>
              <Show when={julesJobs().length > 1}>
                <text fg={theme().text}>{openJules() ? "▼" : "▶"}</text>
              </Show>
              <text fg={theme().text}>
                <b>Jules</b>
                <Show when={!openJules()}>
                  <span style={{ fg: theme().textMuted }}> ({julesActive()} active)</span>
                </Show>
              </text>
            </box>
            <Show when={julesJobs().length <= 1 || openJules()}>
              <For each={julesJobs()}>
                {(job) => (
                  <box flexDirection="row" gap={1}>
                    <text flexShrink={0} style={{ fg: julesDot(job.status) }}>
                      •
                    </text>
                    <text fg={theme().text} wrapMode="word">
                      {job.id.slice(0, 8)}{" "}
                      <span style={{ fg: theme().textMuted }}>{job.status ?? "UNKNOWN"}</span>
                    </text>
                  </box>
                )}
              </For>
            </Show>
          </box>
        </Show>
      </Show>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 200,
    slots: {
      sidebar_content() {
        return <View api={api} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
