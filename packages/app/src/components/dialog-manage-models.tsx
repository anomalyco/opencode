import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { Switch } from "@opencode-ai/ui/switch"
import { Button } from "@opencode-ai/ui/button"
import { createMemo, type Component } from "solid-js"
import { useLocal } from "@/context/local"
import { popularProviders } from "@/hooks/use-providers"
import { useLanguage } from "@/context/language"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DialogSelectProvider } from "./dialog-select-provider"
import { allModelsVisible } from "./dialog-manage-models-state"

export const DialogManageModels: Component = () => {
  const local = useLocal()
  const language = useLanguage()
  const dialog = useDialog()

  const all = createMemo(() => {
    return allModelsVisible(local.model.list(), local.model.visible)
  })

  const handleConnectProvider = () => {
    dialog.show(() => <DialogSelectProvider />)
  }

  return (
    <Dialog
      title={language.t("dialog.model.manage")}
      description={
        <div class="w-full flex items-center justify-between gap-x-3">
          <span class="flex-1">{language.t("dialog.model.manage.description")}</span>
          <div class="flex items-center gap-x-2">
            <span class="text-11-medium text-text-dimmed">{language.t("dialog.model.manage.all")}</span>
            <Switch
              checked={all()}
              onChange={(checked) => {
                local.model.setVisibilityAll(checked)
              }}
            />
          </div>
        </div>
      }
      action={
        <Button class="h-7 -my-1 text-14-medium" icon="plus-small" tabIndex={-1} onClick={handleConnectProvider}>
          {language.t("command.provider.connect")}
        </Button>
      }
    >
      <List
        search={{ placeholder: language.t("dialog.model.search.placeholder"), autofocus: true }}
        emptyMessage={language.t("dialog.model.empty")}
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
          const visible = local.model.visible({
            modelID: x.id,
            providerID: x.provider.id,
          })
          local.model.setVisibility({ modelID: x.id, providerID: x.provider.id }, !visible)
        }}
      >
        {(i) => (
          <div class="w-full flex items-center justify-between gap-x-3">
            <span>{i.name}</span>
            <div onClick={(e) => e.stopPropagation()}>
              <Switch
                checked={
                  !!local.model.visible({
                    modelID: i.id,
                    providerID: i.provider.id,
                  })
                }
                onChange={(checked) => {
                  local.model.setVisibility({ modelID: i.id, providerID: i.provider.id }, checked)
                }}
              />
            </div>
          </div>
        )}
      </List>
    </Dialog>
  )
}
