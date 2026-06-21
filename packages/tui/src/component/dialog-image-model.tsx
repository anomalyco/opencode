import { createMemo, createSignal } from "solid-js"
import { useLocal } from "../context/local"
import { useSync } from "../context/sync"
import { pipe, flatMap, entries, filter, sortBy, map } from "remeda"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
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

    const allOptions = pipe(
      sync.data.provider,
      sortBy(
        (provider: (typeof sync.data.provider)[number]) => provider.id !== "opencode",
        (provider: (typeof sync.data.provider)[number]) => provider.name,
      ),
      flatMap((provider: (typeof sync.data.provider)[number]) =>
        pipe(
          provider.models,
          entries(),
          filter(([_, info]: [string, any]) => info.status !== "deprecated"),
          filter(([_, info]: [string, any]) => supportsImages(info)),
          map(([model, info]: [string, any]) => ({
            value: { providerID: provider.id, modelID: model },
            title: info.name ?? model,
            description: provider.name,
            category: provider.name,
            onSelect() {
              local.model.imageModel.set({ providerID: provider.id, modelID: model })
              dialog.clear()
            },
          })),
          sortBy((x: { title: string }) => x.title),
        ),
      ),
    )

    if (needle) {
      return fuzzysort.go(needle, allOptions, { keys: ["title", "category"] }).map((x: any) => x.obj)
    }

    return allOptions
  })

  const currentLabel = createMemo(() => {
    const im = local.model.imageModel.current()
    if (!im) return "Auto"
    const provider = sync.data.provider.find((x: any) => x.id === im.providerID)
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
