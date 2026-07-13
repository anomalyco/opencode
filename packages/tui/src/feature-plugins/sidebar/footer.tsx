import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, Show } from "solid-js"
import { abbreviateHome } from "../../runtime"
import { useTuiPaths } from "../../context/runtime"
import { FilePath } from "../../ui/file-path"
import { useConfig } from "../../config"

const id = "internal:sidebar-footer"

function View(props: { api: TuiPluginApi; directory: string }) {
  const paths = useTuiPaths()
  const config = useConfig()
  const theme = () => props.api.theme.current
  const has = createMemo(() =>
    props.api.state.provider.some(
      (item) => item.id !== "opencode" || Object.values(item.models).some((model) => model.cost?.input !== 0),
    ),
  )
  const done = createMemo(() => !(config.data.hints?.onboarding ?? true))
  const show = createMemo(() => !has() && !done())
  const location = createMemo(() => {
    const branch = props.directory === props.api.state.path.directory ? props.api.state.vcs?.branch : undefined
    return { path: abbreviateHome(props.directory, paths.home), branch }
  })
  const suffix = createMemo(() => (location().branch ? `:${location().branch}` : ""))
  const suffixWidth = createMemo(() => Math.min(Bun.stringWidth(suffix()), 36))

  return (
    <box gap={1}>
      <Show when={show()}>
        <box
          backgroundColor={theme().backgroundElement}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          paddingRight={2}
          flexDirection="row"
          gap={1}
        >
          <text flexShrink={0} fg={theme().text}>
            ⬖
          </text>
          <box flexGrow={1} gap={1}>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={theme().text}>
                <b>Getting started</b>
              </text>
              <text
                fg={theme().textMuted}
                onMouseDown={() =>
                  void config
                    .update((draft) => {
                      draft.hints = { ...draft.hints, onboarding: false }
                    })
                    .catch(() => {})
                }
              >
                ✕
              </text>
            </box>
            <text fg={theme().textMuted}>OpenCode includes free models so you can start immediately.</text>
            <text fg={theme().textMuted}>
              Connect from 75+ providers to use other models, including Claude, GPT, Gemini etc
            </text>
            <box flexDirection="row" gap={1} justifyContent="space-between">
              <text fg={theme().text}>Connect provider</text>
              <text fg={theme().textMuted}>/connect</text>
            </box>
          </box>
        </box>
      </Show>
      <box flexDirection="row" minWidth={0}>
        <FilePath
          value={location().path}
          maxWidth={Math.max(2, 38 - suffixWidth())}
          fg={theme().textMuted}
          basenameFg={theme().text}
        />
        <Show when={suffix()}>
          <text width={suffixWidth()} wrapMode="none" truncate fg={theme().textMuted}>
            {suffix()}
          </text>
        </Show>
      </box>
      <text fg={theme().textMuted}>
        <span style={{ fg: theme().success }}>•</span> <b>Open</b>
        <span style={{ fg: theme().text }}>
          <b>Code</b>
        </span>{" "}
        <span>{props.api.app.version}</span>
      </text>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
    slots: {
      sidebar_footer(_ctx, props) {
        return <View api={api} directory={props.directory} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
