import { Plugin } from "@opencode-ai/plugin/tui"
import { createMemo, Show } from "solid-js"
import { FilePath } from "../../ui/file-path"

function View(props: { context: Plugin.Context }) {
  const directory = createMemo(() => {
    if (!props.context.location) return undefined
    const value = props.context.ui.format.path(props.context.location.directory)
    const branch = props.context.data.location.vcs.info(props.context.location)?.branch.current
    return branch ? `${value}:${branch}` : value
  })
  return (
    <Show when={directory()}>
      {(value) => <FilePath value={value()} maxWidth={38} fg={props.context.theme.text.subdued} />}
    </Show>
  )
}

export default Plugin.define({
  id: "opencode.sidebar-footer",
  setup(context) {
    // Append keeps the path open to additive plugin claims; an external
    // replace still takes the boundary over.
    context.ui.slot({ append: "sidebar.footer", render: () => <View context={context} /> })
  },
})
