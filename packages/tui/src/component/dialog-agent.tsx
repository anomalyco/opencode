import { createMemo, createSignal } from "solid-js"
import { useLocal } from "../context/local"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useSync } from "../context/sync"
import { Spinner } from "./spinner"
import { useTheme } from "../context/theme"

export function DialogAgent() {
  const local = useLocal()
  const dialog = useDialog()
  const sync = useSync()
  const { theme } = useTheme()
  const [attention, setAttention] = createSignal(0)
  const loading = () => sync.data.agent_status === "loading"
  const failed = () => sync.data.agent_status === "error"

  const options = createMemo(() =>
    local.agent.list().map((item) => {
      return {
        value: item.name,
        title: item.name,
        description: item.native ? "native" : item.description,
      }
    }),
  )

  return (
    <DialogSelect
      title="Select agent"
      current={local.agent.current()?.name}
      options={loading() || failed() ? [] : options()}
      locked={loading() || failed()}
      onEmptySubmit={loading() ? () => setAttention((value) => value + 1) : undefined}
      emptyView={
        loading() ? (
          <box paddingLeft={4} paddingRight={4} paddingTop={1}>
            <Spinner attention={attention()}>Loading agents</Spinner>
          </box>
        ) : failed() ? (
          <box paddingLeft={4} paddingRight={4} paddingTop={1}>
            <text fg={theme.error}>Could not load agents</text>
          </box>
        ) : undefined
      }
      onSelect={(option) => {
        local.agent.set(option.value)
        dialog.clear()
      }}
    />
  )
}
