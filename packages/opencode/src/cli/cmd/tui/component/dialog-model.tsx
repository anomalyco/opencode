import { createMemo, createSignal } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { map, pipe, flatMap, entries, filter, isDeepEqual, sortBy } from "remeda"
import { DialogSelect, type DialogSelectRef } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"

export function DialogModel() {
  const local = useLocal()
  const sync = useSync()
  const dialog = useDialog()
  const [ref, setRef] = createSignal<DialogSelectRef<unknown>>()

  const options = createMemo(() => {
    return [
      ...(!ref()?.filter
        ? local.model.recent().flatMap((item) => {
            const provider = sync.data.provider.find((x) => x.id === item.providerID)!
            if (!provider) return []
            const model = provider.models[item.modelID]
            if (!model) return []
            return [
              {
                key: item,
                value: {
                  providerID: provider.id,
                  modelID: model.id,
                },
                title: model.name ?? item.modelID,
                description: provider.name,
                category: "Recent",
              },
            ]
          })
        : []),
      ...pipe(
        sync.data.provider,
        sortBy(
          (provider) => provider.id !== "opencode",
          (provider) => provider.name,
        ),
        flatMap((provider) =>
          pipe(
            provider.models,
            entries(),
            map(([model, info]) => ({
              value: {
                providerID: provider.id,
                modelID: model,
              },
              title: info.name ?? model,
              description: provider.name,
              category: provider.name,
            })),
            filter(
              (x) =>
                Boolean(ref()?.filter) ||
                !local.model.recent().find((y) => isDeepEqual(y, x.value)),
            ),
          ),
        ),
      ),
    ]
  })

  return (
    <DialogSelect
      ref={setRef}
      title="Select model"
      current={local.model.current()}
      options={options()}
      onSelect={(option) => {
        dialog.clear()
        local.model.set(option.value, { recent: true })
      }}
    />
  )
}
