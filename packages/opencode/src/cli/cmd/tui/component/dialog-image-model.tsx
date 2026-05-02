import { createMemo, createSignal } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { pipe, flatMap, entries, filter, sortBy, map } from "remeda"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import * as fuzzysort from "fuzzysort"

function supportsImages(model: { capabilities?: { input?: { image?: boolean } } }): boolean {
  return !!model.capabilities?.input?.image
}

export function DialogImageModel() {
  const local = useLocal()
  const sync = useSync()
  const dialog = useDialog()
  const [query, setQuery] = createSignal("")

  const options = createMemo(() => {
    const needle = query().trim()
    const current = local.model.imageModel.current()

    const allOptions = pipe(
      sync.data.provider,
      sortBy(
        (provider) => provider.id !== "opencode",
        (provider) => provider.name,
      ),
      flatMap((provider) =>
        pipe(
          provider.models,
          entries(),
          filter(([_, info]) => info.status !== "deprecated"),
          filter(([_, info]) => supportsImages(info)),
          map(([model, info]) => ({
            value: { providerID: provider.id, modelID: model },
            title: info.name ?? model,
            description: provider.name,
            category: provider.name,
            onSelect() {
              local.model.imageModel.set({ providerID: provider.id, modelID: model })
              dialog.clear()
            },
          })),
          sortBy((x) => x.title),
        ),
      ),
    )

    if (needle) {
      return fuzzysort.go(needle, allOptions, { keys: ["title", "category"] }).map((x) => x.obj)
    }

    return allOptions
  })

  const currentLabel = createMemo(() => {
    const im = local.model.imageModel.current()
    if (!im) return "Auto"
    const provider = sync.data.provider.find((x) => x.id === im.providerID)
    const info = provider?.models[im.modelID]
    return info?.name ?? im.modelID
  })

  return (
    <DialogSelect
      options={[
        {
          value: { providerID: "__auto__", modelID: "__auto__" },
          title: "Auto (first available)",
          description: "Automatically select an image-capable model",
          category: "Default",
          onSelect() {
            local.model.imageModel.clear()
            dialog.clear()
          },
        },
        ...options(),
      ]}
      onFilter={setQuery}
      flat={true}
      skipFilter={true}
      title="Select image model"
      current={local.model.imageModel.current() ?? undefined}
    />
  )
}
