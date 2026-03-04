import { Dialog } from "@opencode-ai/ui/dialog"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { List } from "@opencode-ai/ui/list"
import { Switch } from "@opencode-ai/ui/switch"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { Button } from "@opencode-ai/ui/button"
import { Show, type Component } from "solid-js"
import { useLocal } from "@/context/local"
import { useGlobalSync } from "@/context/global-sync"
import { popularProviders } from "@/hooks/use-providers"
import { useLanguage } from "@/context/language"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DialogSelectProvider } from "./dialog-select-provider"
import { DialogCustomProvider } from "./dialog-custom-provider"
import { DialogConnectProvider } from "./dialog-connect-provider"

export const DialogManageModels: Component = () => {
  const local = useLocal()
  const language = useLanguage()
  const dialog = useDialog()
  const globalSync = useGlobalSync()

  const handleConnectProvider = () => {
    dialog.show(() => <DialogSelectProvider />)
  }
  const providerRank = (id: string) => popularProviders.indexOf(id)
  const providerList = (providerID: string) => local.model.list().filter((x) => x.provider.id === providerID)
  const providerVisible = (providerID: string) =>
    providerList(providerID).every((x) => local.model.visible({ modelID: x.id, providerID: x.provider.id }))
  const setProviderVisibility = (providerID: string, checked: boolean) => {
    providerList(providerID).forEach((x) => {
      local.model.setVisibility({ modelID: x.id, providerID: x.provider.id }, checked)
    })
  }

  const isConfigCustom = (providerID: string) => {
    const provider = globalSync.data.config.provider?.[providerID]
    if (!provider) return false
    if (provider.npm !== "@ai-sdk/openai-compatible") return false
    if (!provider.models || Object.keys(provider.models).length === 0) return false
    return true
  }

  const getProviderSource = (providerID: string) => {
    const item = globalSync.data.provider.all.find((p) => p.id === providerID)
    if (!item) return undefined
    if (!("source" in item)) return undefined
    const value = (item as { source: string }).source
    if (value === "env" || value === "api" || value === "config" || value === "custom") return value
    return undefined
  }

  const isEditable = (providerID: string) => {
    const source = getProviderSource(providerID)
    if (source === "config" && isConfigCustom(providerID)) return true
    if (source === "api") return true
    return false
  }

  const handleEditProvider = (providerID: string) => {
    if (isConfigCustom(providerID)) {
      dialog.show(() => <DialogCustomProvider editProviderID={providerID} back="close" />)
    } else {
      dialog.show(() => <DialogConnectProvider provider={providerID} />)
    }
  }

  return (
    <Dialog
      title={language.t("dialog.model.manage")}
      description={language.t("dialog.model.manage.description")}
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
        groupBy={(x) => x.provider.id}
        groupHeader={(group) => {
          const provider = group.items[0].provider
          return (
            <>
              <span class="flex items-center gap-x-1.5">
                {provider.name}
                <Show when={isEditable(provider.id)}>
                  <IconButton
                    icon="pencil-line"
                    variant="ghost"
                    class="size-5"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleEditProvider(provider.id)
                    }}
                    aria-label={language.t("common.edit")}
                  />
                </Show>
              </span>
              <Tooltip
                placement="top"
                value={language.t("dialog.model.manage.provider.toggle", { provider: provider.name })}
              >
                <Switch
                  class="-mr-1"
                  checked={providerVisible(provider.id)}
                  onChange={(checked) => setProviderVisibility(provider.id, checked)}
                  hideLabel
                >
                  {provider.name}
                </Switch>
              </Tooltip>
            </>
          )
        }}
        sortGroupsBy={(a, b) => {
          const aRank = providerRank(a.items[0].provider.id)
          const bRank = providerRank(b.items[0].provider.id)
          const aPopular = aRank >= 0
          const bPopular = bRank >= 0
          if (aPopular && !bPopular) return -1
          if (!aPopular && bPopular) return 1
          return aRank - bRank
        }}
        onSelect={(x) => {
          if (!x) return
          const key = { modelID: x.id, providerID: x.provider.id }
          local.model.setVisibility(key, !local.model.visible(key))
        }}
      >
        {(i) => (
          <div class="w-full flex items-center justify-between gap-x-3">
            <span>{i.name}</span>
            <div onClick={(e) => e.stopPropagation()}>
              <Switch
                checked={!!local.model.visible({ modelID: i.id, providerID: i.provider.id })}
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
