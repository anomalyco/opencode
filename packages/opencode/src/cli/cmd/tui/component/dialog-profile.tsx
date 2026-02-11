import { createMemo, createResource } from "solid-js"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useLocal } from "@tui/context/local"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"

export function DialogProfile() {
  const sdk = useSDK()
  const sync = useSync()
  const local = useLocal()
  const dialog = useDialog()

  const providerID = createMemo(() => local.model.current()?.providerID ?? "")
  const name = createMemo(() => local.model.parsed().provider)

  const [profiles] = createResource(providerID, async (id) => {
    if (!id) return undefined
    const result = await sdk.client.auth.profiles({ providerID: id })
    return result.data
  })

  const options = createMemo(() => {
    const data = profiles()
    if (!data) return []
    return data.profiles.map((p) => ({
      value: p,
      title: p,
      description: p === data.active ? "active" : undefined,
    }))
  })

  return (
    <DialogSelect
      title={`Switch profile · ${name()}`}
      current={profiles()?.active}
      options={options()}
      onSelect={async (option) => {
        const id = providerID()
        await sdk.client.auth.profile.switch({
          providerID: id,
          profileID: option.value,
        })
        sync.set("active_profiles", id, option.value)
        dialog.clear()
      }}
    />
  )
}
