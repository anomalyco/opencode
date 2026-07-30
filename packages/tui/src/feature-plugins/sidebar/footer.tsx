import { Plugin } from "@opencode-ai/plugin/tui"
import { createMemo, Show } from "solid-js"
import { FilePath } from "../../ui/file-path"

function View(props: { context: Plugin.Context }) {
  const directory = createMemo(() =>
    props.context.location ? props.context.ui.format.path(props.context.location.directory) : undefined,
  )
  return (
    <Show when={directory()}>
      {(value) => <FilePath value={value()} maxWidth={38} fg={props.context.theme.text.subdued} />}
    </Show>
  )
}

export default Plugin.define({
  id: "opencode.sidebar-footer",
  setup(context) {
    context.ui.slot("sidebar.footer", () => <View context={context} />)
  },
})
