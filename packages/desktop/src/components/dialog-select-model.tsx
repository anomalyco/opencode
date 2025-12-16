import { Component, createMemo, Show } from "solid-js"
import { useLocal } from "@/context/local"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { popularProviders } from "@/hooks/use-providers"
import { Button } from "@opencode-ai/ui/button"
import { Tag } from "@opencode-ai/ui/tag"
import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { DialogSelectProvider } from "./dialog-select-provider"
import { DialogManageModels } from "./dialog-manage-models"

export const DialogSelectModel: Component<{ provider?: string }> = (props) => {
  const local = useLocal()
  const dialog = useDialog()

  const models = createMemo(() =>
    local.model
      .list()
      .filter((m) => local.model.visible({ modelID: m.id, providerID: m.provider.id }))
      .filter((m) => (props.provider ? m.provider.id === props.provider : true)),
  )

  return (
    <Dialog
      title="Select model"
      action={
        <Button
          class="h-7 -my-1 text-14-medium"
          icon="plus-small"
          tabIndex={-1}
          onClick={() => dialog.show(() => <DialogSelectProvider />)}
        >
          Connect provider
        </Button>
      }
    >
      <List
        class="px-2.5"
        search={{ placeholder: "Search models", autofocus: true }}
        emptyMessage="No model results"
        key={(x) => `${x.provider.id}:${x.id}`}
        items={models}
        current={local.model.current()}
        filterKeys={["provider.name", "name", "id"]}
        sortBy={(a, b) => a.name.localeCompare(b.name)}
        groupBy={(x) => x.provider.name}
        sortGroupsBy={(a, b) => {
          if (a.category === "Recent" && b.category !== "Recent") return -1
          if (b.category === "Recent" && a.category !== "Recent") return 1
          const aProvider = a.items[0].provider.id
          const bProvider = b.items[0].provider.id
          if (popularProviders.includes(aProvider) && !popularProviders.includes(bProvider)) return -1
          if (!popularProviders.includes(aProvider) && popularProviders.includes(bProvider)) return 1
          return popularProviders.indexOf(aProvider) - popularProviders.indexOf(bProvider)
        }}
        onSelect={(x) => {
          local.model.set(x ? { modelID: x.id, providerID: x.provider.id } : undefined, {
            recent: true,
          })
          dialog.close()
        }}
      >
        {(i) => (
          <div class="w-full flex items-center gap-x-2.5">
            <span>{i.name}</span>
            <Show when={i.provider.id === "opencode" && (!i.cost || i.cost?.input === 0)}>
              <Tag>Free</Tag>
            </Show>
            <Show when={i.latest}>
              <Tag>Latest</Tag>
            </Show>
          </div>
        )}
      </List>
      <Button
        variant="ghost"
        class="ml-3 mt-5 mb-6 text-text-base self-start"
        onClick={() => dialog.show(() => <DialogManageModels />)}
      >
        Manage models
      </Button>
    </Dialog>
  )
}
