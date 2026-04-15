import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"

const id = "internal:sidebar-favorites"

function View(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const sync = useSync()
  const local = useLocal()

  const connected = createMemo(() =>
    sync.data.provider.some((x) => x.id !== "opencode" || Object.values(x.models).some((y) => y.cost?.input !== 0)),
  )

  const favorites = createMemo(() => {
    if (!connected()) return []
    return local.model.favorite()
  })

  const currentModel = createMemo(() => {
    const model = local.model.current()
    if (!model) return null
    return `${model.providerID}/${model.modelID}`
  })

  return (
    <box gap={1}>
      <text fg={theme().text}>
        <b>⭐ Favorites</b>
      </text>
      <box gap={0}>
        {favorites().map((fav: { providerID: string; modelID: string }) => {
          const modelKey = `${fav.providerID}/${fav.modelID}`
          const isActive = currentModel() === modelKey
          return (
            <box>
              <text fg={isActive ? theme().text : theme().textMuted}>
                {isActive ? "▶" : "○"} {fav.providerID}/{fav.modelID}
              </text>
            </box>
          )
        })}
      </box>
      {favorites().length === 0 && (
        <text fg={theme().textMuted}>No favorites. Press Ctrl+F in model dialog to add.</text>
      )}
      <text fg={theme().textMuted}>Use /f1 /f2 to cycle</text>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 50,
    slots: {
      sidebar_content() {
        return <View api={api} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
