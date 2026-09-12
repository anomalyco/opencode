import { createMemo, Show } from "solid-js"
import type { TuiHostSlotMap, TuiPlugin, TuiThemeCurrent } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "./builtins"
import { BoxRenderable } from "@opentui/core"
import { useLocal } from "../context/local"
import { useSync } from "../context/sync"
import { alwaysSeparate } from "../util/separate"
import { Locale } from "../util/locale"
import * as Model from "../util/model"

const id = "internal:assistant-message-footer"

function Footer(props: { value: TuiHostSlotMap["assistant_message_footer"]; theme: TuiThemeCurrent }) {
  const local = useLocal()
  const sync = useSync()
  const aborted = () => props.value.message.error?.name === "MessageAbortedError"
  const model = createMemo(() =>
    Model.name(sync.data.provider, props.value.message.providerID, props.value.message.modelID),
  )
  const messages = createMemo(() => sync.data.message[props.value.session_id] ?? [])
  const duration = createMemo(() => {
    if (!props.value.message.finish || ["tool-calls", "unknown"].includes(props.value.message.finish)) return 0
    if (!props.value.message.time.completed) return 0
    const user = messages().find((x) => x.role === "user" && x.id === props.value.message.parentID)
    if (!user || !user.time) return 0
    return props.value.message.time.completed - user.time.created
  })

  return (
    <box ref={(el: BoxRenderable) => alwaysSeparate.add(el)} paddingLeft={3}>
      <text marginTop={1}>
        <span
          style={{
            fg: aborted() ? props.theme.textMuted : local.agent.color(props.value.message.agent),
          }}
        >
          ▣{" "}
        </span>{" "}
        <span style={{ fg: props.theme.text }}>{Locale.titlecase(props.value.message.mode)}</span>
        <span style={{ fg: props.theme.textMuted }}> · {model()}</span>
        <Show when={duration()}>
          <span style={{ fg: props.theme.textMuted }}> · {Locale.duration(duration())}</span>
        </Show>
        <Show when={aborted()}>
          <span style={{ fg: props.theme.textMuted }}> · interrupted</span>
        </Show>
      </text>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 0,
    slots: {
      assistant_message_footer(ctx, value) {
        if (!value.last && !value.terminal) return null
        return <Footer value={value} theme={ctx.theme.current} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin