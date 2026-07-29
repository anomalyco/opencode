import { Plugin } from "@opencode-ai/plugin/tui"
import { createMemo } from "solid-js"
import { FadeFilePath } from "../../ui/fade-file-path"

function View(props: { context: Plugin.Context }) {
  const directory = createMemo(() =>
    props.context.location ? props.context.ui.format.path(props.context.location.directory) : undefined,
  )
  return (
    <FadeFilePath
      value={directory()}
      maxWidth={38}
      fg={props.context.theme.text.subdued}
      bg={props.context.theme.background.default}
    />
  )
}

export default Plugin.define({
  id: "opencode.sidebar-footer",
  setup(context) {
    context.ui.slot("sidebar.footer", () => <View context={context} />)
  },
})
