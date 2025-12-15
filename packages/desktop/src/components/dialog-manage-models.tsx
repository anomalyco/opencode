import { Component } from "solid-js"
import { useLocal } from "@/context/local"
import { useDialog } from "@/context/dialog"
import { popularProviders } from "@/hooks/use-providers"
import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { Switch } from "@opencode-ai/ui/switch"

export const DialogManageModels: Component = () => {
  const local = useLocal()
  const dialog = useDialog()

  return (
    <Dialog
      modal
      defaultOpen
      onOpenChange={(open) => {
        if (!open) {
          dialog.clear()
        }
      }}
    >
      <Dialog.Header>
        <Dialog.Title>Manage models</Dialog.Title>
        <Dialog.CloseButton tabIndex={-1} />
      </Dialog.Header>
      <Dialog.Description>Customize which models appear in the model selector.</Dialog.Description>
      <Dialog.Body>
        <List
          class="px-2.5"
          search={{ placeholder: "Search models", autofocus: true }}
          emptyMessage="No model results"
          key={(x) => `${x?.provider?.id}:${x?.id}`}
          items={local.model.list()}
          filterKeys={["provider.name", "name", "id"]}
          sortBy={(a, b) => a.name.localeCompare(b.name)}
          groupBy={(x) => x.provider.name}
          sortGroupsBy={(a, b) => {
            const aProvider = a.items[0].provider.id
            const bProvider = b.items[0].provider.id
            if (popularProviders.includes(aProvider) && !popularProviders.includes(bProvider)) return -1
            if (!popularProviders.includes(aProvider) && popularProviders.includes(bProvider)) return 1
            return popularProviders.indexOf(aProvider) - popularProviders.indexOf(bProvider)
          }}
          onSelect={(x) => {
            if (!x) return
            local.model.setVisibility({ modelID: x.id, providerID: x.provider.id }, !x.visible)
          }}
        >
          {(i) => (
            <div class="w-full flex items-center justify-between gap-x-2.5">
              <span>{i.name}</span>
              <Switch
                checked={!!i.visible}
                onChange={(checked) => {
                  local.model.setVisibility({ modelID: i.id, providerID: i.provider.id }, checked)
                }}
              />
            </div>
          )}
        </List>
      </Dialog.Body>
    </Dialog>
  )
}
