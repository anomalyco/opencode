import { Plugin } from "@opencode-ai/plugin/tui"
import { useTerminalDimensions } from "@opentui/solid"

function Commands(props: { context: Plugin.Context }) {
  props.context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "app.scrap",
        title: "Open scrap screen",
        group: "Debug",
        palette: true,
        run() {
          props.context.ui.router.navigate({ type: "plugin", name: "scrap" })
          props.context.ui.dialog.clear()
        },
      },
    ],
  }))
  return null
}

function Scrap(props: { context: Plugin.Context }) {
  const dimensions = useTerminalDimensions()
  const theme = props.context.theme
  const elevatedTheme = props.context.theme.contextual("elevated")

  props.context.keymap.layer(() => ({
    commands: [
      {
        bind: "escape",
        title: "Back home",
        group: "Scrap",
        run() {
          props.context.ui.router.navigate({ type: "home" })
        },
      },
    ],
  }))

  return (
    <box width={dimensions().width} height={dimensions().height} backgroundColor={theme.background.default}>
      <box flexGrow={1} />
      <box
        height={1}
        flexShrink={0}
        backgroundColor={elevatedTheme.background.default}
        paddingLeft={1}
        paddingRight={1}
        flexDirection="row"
      >
        <text fg={elevatedTheme.text.subdued}>~/code/anomalyco/opencode</text>
        <box flexGrow={1} />
        <text fg={elevatedTheme.text.subdued}>esc home</text>
      </box>
    </box>
  )
}

export default Plugin.define({
  id: "opencode.scrap",
  setup(context) {
    context.ui.router.register({ name: "scrap", render: () => <Scrap context={context} /> })
    context.ui.slot("app", () => <Commands context={context} />)
  },
})
