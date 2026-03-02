import { type Accessor, createMemo, createResource, createSignal, Match, Show, Switch } from "solid-js"
import { useRouteData } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { pipe, sumBy } from "remeda"
import { useTheme } from "@tui/context/theme"
import { SplitBorder } from "@tui/component/border"
import type { AssistantMessage, Session } from "@opencode-ai/sdk/v2"
import { useCommandDialog } from "@tui/component/dialog-command"
import { useKeybind } from "../../context/keybind"
import { useTerminalDimensions } from "@opentui/solid"
import { loadCodexUsage } from "@/cli/cmd/tui/util/codex-usage"

const Title = (props: { session: Accessor<Session> }) => {
  const { theme } = useTheme()
  return (
    <text fg={theme.text}>
      <span style={{ bold: true }}>#</span> <span style={{ bold: true }}>{props.session().title}</span>
    </text>
  )
}

const ContextInfo = (props: {
  context: Accessor<string | undefined>
  cost: Accessor<string>
  usage: Accessor<{ primary: number; secondary: number } | undefined>
}) => {
  const { theme } = useTheme()
  const usageColor = (value: number) => {
    if (value >= 90) return theme.error
    if (value >= 70) return theme.warning
    return theme.textMuted
  }

  return (
    <box flexDirection="row" gap={2}>
      <Show when={props.context()}>
        <text fg={theme.textMuted} wrapMode="none" flexShrink={0}>
          {props.context()} ({props.cost()})
        </text>
      </Show>
      <Show when={props.usage()}>
        <text fg={theme.textMuted} wrapMode="none" flexShrink={0}>
          <span>Codex </span>
          <span>5h </span>
          <span style={{ fg: usageColor(props.usage()!.primary) }}>{props.usage()!.primary}%</span>
          <span> · 7d </span>
          <span style={{ fg: usageColor(props.usage()!.secondary) }}>{props.usage()!.secondary}%</span>
        </text>
      </Show>
    </box>
  )
}

export function Header() {
  const route = useRouteData("session")
  const sync = useSync()
  const session = createMemo(() => sync.session.get(route.sessionID)!)
  const messages = createMemo(() => sync.data.message[route.sessionID] ?? [])
  const [usage] = createResource(loadCodexUsage)

  const cost = createMemo(() => {
    const total = pipe(
      messages(),
      sumBy((x) => (x.role === "assistant" ? x.cost : 0)),
    )
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(total)
  })

  const context = createMemo(() => {
    const last = messages().findLast((x) => x.role === "assistant" && x.tokens.output > 0) as AssistantMessage
    if (!last) return
    const total =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    const model = sync.data.provider.find((x) => x.id === last.providerID)?.models[last.modelID]
    let result = total.toLocaleString()
    if (model?.limit.context) {
      result += "  " + Math.round((total / model.limit.context) * 100) + "%"
    }
    return result
  })

  const usageSummary = createMemo(() => {
    const entries = (usage() ?? []).filter((x) => !x.error)
    if (!entries.length) return
    return {
      primary: Math.max(...entries.map((x) => x.primary)),
      secondary: Math.max(...entries.map((x) => x.secondary ?? 0)),
    }
  })

  const { theme } = useTheme()
  const keybind = useKeybind()
  const command = useCommandDialog()
  const [hover, setHover] = createSignal<"parent" | "prev" | "next" | null>(null)
  const dimensions = useTerminalDimensions()
  const narrow = createMemo(() => dimensions().width < 80)

  return (
    <box flexShrink={0}>
      <box
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={1}
        {...SplitBorder}
        border={["left"]}
        borderColor={theme.border}
        flexShrink={0}
        backgroundColor={theme.backgroundPanel}
      >
        <Switch>
          <Match when={session()?.parentID}>
            <box flexDirection="column" gap={1}>
              <box flexDirection={narrow() ? "column" : "row"} justifyContent="space-between" gap={narrow() ? 1 : 0}>
                <text fg={theme.text}>
                  <b>Subagent session</b>
                </text>
                <ContextInfo context={context} cost={cost} usage={usageSummary} />
              </box>
              <box flexDirection="row" gap={2}>
                <box
                  onMouseOver={() => setHover("parent")}
                  onMouseOut={() => setHover(null)}
                  onMouseUp={() => command.trigger("session.parent")}
                  backgroundColor={hover() === "parent" ? theme.backgroundElement : theme.backgroundPanel}
                >
                  <text fg={theme.text}>
                    Parent <span style={{ fg: theme.textMuted }}>{keybind.print("session_parent")}</span>
                  </text>
                </box>
                <box
                  onMouseOver={() => setHover("prev")}
                  onMouseOut={() => setHover(null)}
                  onMouseUp={() => command.trigger("session.child.previous")}
                  backgroundColor={hover() === "prev" ? theme.backgroundElement : theme.backgroundPanel}
                >
                  <text fg={theme.text}>
                    Prev <span style={{ fg: theme.textMuted }}>{keybind.print("session_child_cycle_reverse")}</span>
                  </text>
                </box>
                <box
                  onMouseOver={() => setHover("next")}
                  onMouseOut={() => setHover(null)}
                  onMouseUp={() => command.trigger("session.child.next")}
                  backgroundColor={hover() === "next" ? theme.backgroundElement : theme.backgroundPanel}
                >
                  <text fg={theme.text}>
                    Next <span style={{ fg: theme.textMuted }}>{keybind.print("session_child_cycle")}</span>
                  </text>
                </box>
              </box>
            </box>
          </Match>
          <Match when={true}>
            <box flexDirection={narrow() ? "column" : "row"} justifyContent="space-between" gap={1}>
              <Title session={session} />
              <ContextInfo context={context} cost={cost} usage={usageSummary} />
            </box>
          </Match>
        </Switch>
      </box>
    </box>
  )
}
