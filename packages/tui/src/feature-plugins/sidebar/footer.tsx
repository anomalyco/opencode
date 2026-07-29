import { Plugin } from "@opencode-ai/plugin/tui"
import { createMemo, Show } from "solid-js"
import { FilePath } from "../../ui/file-path"
import { createTypewriter } from "../../ui/typewriter"

function View(props: { context: Plugin.Context }) {
  const directory = createMemo(() =>
    props.context.location ? props.context.ui.format.path(props.context.location.directory) : undefined,
  )
  const typed = createTypewriter(directory)
  return (
    <Show when={typed.text !== undefined}>
      <box flexDirection="row" flexShrink={1}>
        <FilePath
          value={typed.text ?? ""}
          maxWidth={38}
          fg={typed.active ? props.context.theme.text.default : props.context.theme.text.subdued}
        />
        <Show when={typed.active}>
          <text fg={props.context.theme.text.default}>│</text>
        </Show>
      </box>
    </Show>
  )
}

export default Plugin.define({
  id: "opencode.sidebar-footer",
  setup(context) {
    context.ui.slot("sidebar.footer", () => <View context={context} />)
  },
})
