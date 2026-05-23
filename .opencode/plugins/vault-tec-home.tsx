/** @jsxImportSource ../../packages/opencode/node_modules/@opentui/solid */
import type {
  TuiPlugin,
  TuiPluginApi,
  TuiPluginModule,
} from "../../packages/opencode/node_modules/@opencode-ai/plugin/src/tui.ts"

const color = (api: TuiPluginApi) => {
  const theme = api.theme.current
  return {
    primary: theme.primary,
    text: theme.text,
    muted: theme.textMuted,
    accent: theme.accent,
    warning: theme.warning,
    success: theme.success,
    error: theme.error,
    panel: theme.backgroundPanel,
    selected: theme.selectedListItemText,
  }
}

function HomeLogo(props: { api: TuiPluginApi }) {
  const skin = color(props.api)
  const art = [
    "⢀⣤⡶⠶⠶⢶⣤⡀",
    "⠘⠛⠛⠛⠛⢻⡿⠁⣠⣤⣤⣄⠈⢿⡟⠛⠛⠛⠛⠃",
    "⠶⠶⠶⠶⠶⠶⠶⠶⠶⢾⡁⠀⣿⣿⣿⣿⠀⢨⡷⠶⠶⠶⠶⠶⠶⠶⠶⠶",
    "⢤⣴⣶⣶⣶⣾⣷⡀⠙⠛⠛⠋⢀⣾⣷⣶⣶⣶⣦⡤",
    "⠈⠛⠷⠶⠶⠾⠛⠁",
    "",
    "ROBCO INDUSTRIES UNIFIED OPERATING SYSTEM",
    "VAULT-TEC PERSONAL TERMINAL MK IV [OK]",
  ]

  return (
    <box width="100%" alignItems="center" paddingBottom={1}>
      <box flexDirection="column" alignItems="center" paddingLeft={2} paddingRight={2}>
        <text fg={skin.muted}>==================== VAULT-TEC ====================</text>
      {art.map((line, index) => (
          <text fg={index < 5 ? skin.primary : index === 6 ? skin.muted : skin.text}>{line}</text>
      ))}
        <text fg={skin.muted}>=================== AUTHORIZED ===================</text>
      </box>
    </box>
  )
}

function HomeFooter(props: { api: TuiPluginApi }) {
  const skin = color(props.api)
  return (
    <box
      width="100%"
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
      border={["top"]}
      borderColor={skin.panel}
      flexDirection="column"
    >
      <text fg={skin.muted}>[ OK ] BIOS LOAD   [ OK ] MEMORY CHECK   [ OK ] HOLOTAPE BUS   [ OK ] RADIO LINK</text>
      <text fg={skin.text}>
        <span style={{ fg: skin.primary }}>VT-CLI SHELL READY</span>
        <span style={{ fg: skin.muted }}> :: </span>
        <span style={{ fg: skin.warning }}>PROFILE</span>
        <span style={{ fg: skin.muted }}> .opencode/tui.json </span>
        <span style={{ fg: skin.muted }}>:: COMMAND </span>
        <span style={{ fg: skin.accent }}>/theme</span>
      </text>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 200,
    slots: {
      home_logo() {
        return <HomeLogo api={api} />
      },
      home_footer() {
        return <HomeFooter api={api} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id: "vault-tec-home",
  tui,
}

export default plugin