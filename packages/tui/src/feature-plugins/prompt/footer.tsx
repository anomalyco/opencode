import { Plugin } from "@opencode-ai/plugin/tui"
import { createMemo, Match, Show, Switch } from "solid-js"
import { contextUsage, formatContextUsage } from "../../util/session"
import { useTerminalDimensions } from "@opentui/solid"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

export function PromptFooter(props: { context: Plugin.Context; sessionID?: string; mode: "normal" | "shell" }) {
  const dimensions = useTerminalDimensions()
  const subagents = createMemo(() => {
    if (!props.sessionID) return 0
    const count = props.context.data.session
      .family(props.sessionID)
      .filter((id) => id !== props.sessionID && props.context.data.session.status(id) === "running").length
    return count ? `${count} subagent${count === 1 ? "" : "s"}` : undefined
  })
  const shells = createMemo(() => {
    if (!props.sessionID) return 0
    const count = props.context.data.shell
      .list(props.context.location)
      .filter((shell) => shell.metadata.sessionID === props.sessionID).length
    return count ? `${count} shell${count === 1 ? "" : "s"}` : undefined
  })
  const status = createMemo(() => {
    if (!props.sessionID) return []
    const session = props.context.data.session.get(props.sessionID)
    if (!session) return []
    const usage = contextUsage(
      props.context.data.session.message.list(props.sessionID),
      props.context.data.location.model.list(session.location),
      session.revert?.messageID,
    )
    const cost = props.context.data.session.cost(props.sessionID)
    return [
      usage ? formatContextUsage(usage.tokens, usage.percent) : undefined,
      cost > 0 ? money.format(cost) : undefined,
    ].filter((item): item is string => Boolean(item))
  })
  const live = createMemo(() => Boolean(subagents() || shells()))
  const shortcut = (id: string) => props.context.keymap.shortcuts(id)[0]

  return (
    <Switch>
      <Match when={props.mode === "normal"}>
        <Switch>
          <Match when={live() || status().length > 0}>
            <text fg={props.context.theme.text.subdued} wrapMode="none" truncate flexShrink={1}>
              <Show when={live() && shortcut("session.child.first")}>
                {(value) => <span style={{ fg: props.context.theme.text.default }}>{value()} </span>}
              </Show>
              <Show when={subagents()}>{(value) => <span>{value()}</span>}</Show>
              <Show when={subagents() && shells()}> · </Show>
              <Show when={shells()}>{(value) => <span>{value()}</span>}</Show>
              <Show when={live() && status().length > 0}> · </Show>
              <Show when={status().length > 0}>{status().join(" · ")}</Show>
            </text>
          </Match>
          <Match when={dimensions().width >= 44}>
            <text fg={props.context.theme.text.default} flexShrink={0}>
              {shortcut("agent.cycle")} <span style={{ fg: props.context.theme.text.subdued }}>agents</span>
            </text>
          </Match>
        </Switch>
        <Show when={dimensions().width >= 44}>
          <text fg={props.context.theme.text.default} flexShrink={0}>
            {shortcut("command.palette.show")} <span style={{ fg: props.context.theme.text.subdued }}>commands</span>
          </text>
        </Show>
      </Match>
      <Match when={props.mode === "shell"}>
        <text fg={props.context.theme.text.default} flexShrink={0}>
          esc{" "}
          <span style={{ fg: props.context.theme.text.subdued }}>
            {dimensions().width < 44 ? "shell" : "exit shell mode"}
          </span>
        </text>
      </Match>
    </Switch>
  )
}

export default Plugin.define({
  id: "opencode.prompt-footer",
  setup(context) {
    context.ui.slot({
      append: "prompt.footer",
      render: (props) => <PromptFooter context={context} sessionID={props.sessionID} mode={props.mode} />,
    })
  },
})
