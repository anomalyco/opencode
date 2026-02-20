import { createMemo, createResource } from "solid-js"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useSDK } from "@tui/context/sdk"
import { createStore } from "solid-js/store"

export function DialogTag(props: { onSelect?: (value: string) => void }) {
  const sdk = useSDK()
  const dialog = useDialog()

  const [store] = createStore({
    filter: "",
  })

  const [files] = createResource(
    () => [store.filter],
    async () => {
      const result = await sdk.client.find.files({
        query: store.filter,
      })
      if (result.error) return []
      const sliced = (result.data ?? []).slice(0, 5)
      return sliced
    },
  )

  const options = createMemo(() =>
    (files() ?? []).map((file: any) => ({
      value: file,
      title: file,
    })),
  )

  return (
    <DialogSelect
      title="Autocomplete"
      options={options()}
      onSelect={(option: any) => {
        props.onSelect?.(option.value)
        dialog.clear()
      }}
    />
  )
}
