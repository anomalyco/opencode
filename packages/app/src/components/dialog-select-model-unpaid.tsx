import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { List, type ListRef } from "@opencode-ai/ui/list"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { Tag } from "@opencode-ai/ui/tag"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { type Component, createMemo, Show } from "solid-js"
import { useLocal } from "@/context/local"
import { popularProviders, useProviders } from "@/hooks/use-providers"
import { ModelTooltip } from "./model-tooltip"
import { useLanguage } from "@/context/language"

type ModelState = ReturnType<typeof useLocal>["model"]
type ModelListItem = {
  model: ReturnType<ModelState["list"]>[number]
  category: string
  order: number
}

function key(item: { provider: { id: string }; id: string }) {
  return `${item.provider.id}:${item.id}`
}

export const DialogSelectModelUnpaid: Component<{ model?: ModelState }> = (props) => {
  const model = props.model ?? useLocal().model
  const dialog = useDialog()
  const providers = useProviders()
  const language = useLanguage()

  const items = createMemo<ModelListItem[]>(() => {
    const favoritesLabel = language.t("dialog.model.group.favorites")
    const recentLabel = language.t("dialog.model.group.recent")
    const favorites = model.favorite().flatMap((item) => (item ? [item] : []))
    const recent = model.recent().flatMap((item) => (item ? [item] : []))
    const favoriteKeys = new Set(favorites.map(key))
    const recentKeys = new Set(recent.map(key))
    const rest = model
      .list()
      .filter((item) => !favoriteKeys.has(key(item)))
      .filter((item) => !recentKeys.has(key(item)))
      .map((item, order) => ({ model: item, category: item.provider.name, order }))

    return [
      ...favorites.map((item, order) => ({ model: item, category: favoritesLabel, order })),
      ...recent
        .filter((item) => !favoriteKeys.has(key(item)))
        .map((item, order) => ({ model: item, category: recentLabel, order })),
      ...rest,
    ]
  })

  const current = createMemo(() => {
    const item = model.current()
    if (!item) return undefined
    return items().find((entry) => entry.model.id === item.id && entry.model.provider.id === item.provider.id)
  })

  const connect = (provider: string) => {
    void import("./dialog-connect-provider").then((x) => {
      dialog.show(() => <x.DialogConnectProvider provider={provider} />)
    })
  }

  const all = () => {
    void import("./dialog-select-provider").then((x) => {
      dialog.show(() => <x.DialogSelectProvider />)
    })
  }

  let listRef: ListRef | undefined
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") return
    listRef?.onKeyDown(e)
  }

  return (
    <Dialog
      title={language.t("dialog.model.select.title")}
      class="overflow-y-auto [&_[data-slot=dialog-body]]:overflow-visible [&_[data-slot=dialog-body]]:flex-none"
    >
      <div class="flex flex-col gap-3 px-2.5" onKeyDown={handleKeyDown}>
        <div class="text-14-medium text-text-base px-2.5">{language.t("dialog.model.unpaid.freeModels.title")}</div>
        <List
          class="[&_[data-slot=list-scroll]]:overflow-visible"
          ref={(ref) => (listRef = ref)}
          items={items}
          current={current()}
          key={(x) => `${x.model.provider.id}:${x.model.id}`}
          filterKeys={["model.provider.name", "model.name", "model.id", "category"]}
          sortBy={(a, b) => {
            const favoritesLabel = language.t("dialog.model.group.favorites")
            const recentLabel = language.t("dialog.model.group.recent")
            if (a.category === favoritesLabel && b.category === favoritesLabel) return a.order - b.order
            if (a.category === recentLabel && b.category === recentLabel) return a.order - b.order
            return a.model.name.localeCompare(b.model.name)
          }}
          groupBy={(x) => x.category}
          sortGroupsBy={(a, b) => {
            const favoritesLabel = language.t("dialog.model.group.favorites")
            const recentLabel = language.t("dialog.model.group.recent")
            if (a.category === favoritesLabel) return -1
            if (b.category === favoritesLabel) return 1
            if (a.category === recentLabel) return -1
            if (b.category === recentLabel) return 1
            return a.category.localeCompare(b.category)
          }}
          itemWrapper={(item, node) => (
            <Tooltip
              class="w-full"
              placement="right-start"
              gutter={12}
              value={
                <ModelTooltip
                  model={item.model}
                  latest={item.model.latest}
                  free={item.model.provider.id === "opencode" && (!item.model.cost || item.model.cost.input === 0)}
                />
              }
            >
              {node}
            </Tooltip>
          )}
          onSelect={(x) => {
            model.set(x ? { modelID: x.model.id, providerID: x.model.provider.id } : undefined, {
              recent: true,
            })
            dialog.close()
          }}
        >
          {(i) => (
            <div class="w-full flex items-center gap-x-2.5">
              <span class="truncate">{i.model.name}</span>
              <Tag>{language.t("model.tag.free")}</Tag>
              <Show when={i.model.latest}>
                <Tag>{language.t("model.tag.latest")}</Tag>
              </Show>
              <div
                role="button"
                tabIndex={-1}
                data-component="icon-button"
                data-size="normal"
                data-variant="ghost"
                class="ml-auto"
                aria-label={
                  model.isFavorite({ modelID: i.model.id, providerID: i.model.provider.id })
                    ? language.t("dialog.model.favorite.remove")
                    : language.t("dialog.model.favorite.add")
                }
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  model.toggleFavorite({ modelID: i.model.id, providerID: i.model.provider.id })
                }}
              >
                <Icon
                  name="star"
                  class={model.isFavorite({ modelID: i.model.id, providerID: i.model.provider.id })
                    ? "text-icon-warning-base"
                    : undefined}
                />
              </div>
            </div>
          )}
        </List>
      </div>
      <div class="px-1.5 pb-1.5">
        <div class="w-full rounded-sm border border-border-weak-base bg-surface-raised-base">
          <div class="w-full flex flex-col items-start gap-4 px-1.5 pt-4 pb-4">
            <div class="px-2 text-14-medium text-text-base">{language.t("dialog.model.unpaid.addMore.title")}</div>
            <div class="w-full">
              <List
                class="w-full px-0"
                key={(x) => x?.id}
                items={providers.popular}
                activeIcon="plus-small"
                sortBy={(a, b) => {
                  if (popularProviders.includes(a.id) && popularProviders.includes(b.id))
                    return popularProviders.indexOf(a.id) - popularProviders.indexOf(b.id)
                  return a.name.localeCompare(b.name)
                }}
                onSelect={(x) => {
                  if (!x) return
                  connect(x.id)
                }}
              >
                {(i) => (
                  <div class="w-full flex items-center gap-x-3">
                    <ProviderIcon data-slot="list-item-extra-icon" id={i.id} />
                    <span>{i.name}</span>
                    <Show when={i.id === "opencode"}>
                      <div class="text-14-regular text-text-weak">{language.t("dialog.provider.opencode.tagline")}</div>
                    </Show>
                    <Show when={i.id === "opencode"}>
                      <Tag>{language.t("dialog.provider.tag.recommended")}</Tag>
                    </Show>
                    <Show when={i.id === "opencode-go"}>
                      <>
                        <div class="text-14-regular text-text-weak">
                          {language.t("dialog.provider.opencodeGo.tagline")}
                        </div>
                        <Tag>{language.t("dialog.provider.tag.recommended")}</Tag>
                      </>
                    </Show>
                    <Show when={i.id === "anthropic"}>
                      <div class="text-14-regular text-text-weak">{language.t("dialog.provider.anthropic.note")}</div>
                    </Show>
                  </div>
                )}
              </List>
              <Button
                variant="ghost"
                class="w-full justify-start px-[11px] py-3.5 gap-4.5 text-14-medium"
                icon="dot-grid"
                onClick={all}
              >
                {language.t("dialog.provider.viewAll")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Dialog>
  )
}
