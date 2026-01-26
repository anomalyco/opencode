import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import type { IconName } from "@opencode-ai/ui/icons/provider"
import { List, type ListRef } from "@opencode-ai/ui/list"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { Tag } from "@opencode-ai/ui/tag"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { type Component, onCleanup, onMount, Show } from "solid-js"
import { useLocal } from "@/context/local"
import { popularProviders, useProviders } from "@/hooks/use-providers"
import { DialogConnectProvider } from "./dialog-connect-provider"
import { DialogSelectProvider } from "./dialog-select-provider"
import { ModelTooltip } from "./model-tooltip"
import { useLanguage } from "@/context/language"

export const DialogSelectModelUnpaid: Component = () => {
  const local = useLocal()
  const dialog = useDialog()
  const providers = useProviders()
  const language = useLanguage()

  let listRef: ListRef | undefined
  const handleKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") return
    listRef?.onKeyDown(e)
  }

  onMount(() => {
    document.addEventListener("keydown", handleKey)
    onCleanup(() => {
      document.removeEventListener("keydown", handleKey)
    })
  })

  return (
    <Dialog title={language.t("dialog.model.select.title")}>
      <div class="flex flex-col gap-3 px-2.5 flex-1 min-h-0">
        <div class="text-14-medium text-text-base px-2.5">{language.t("dialog.model.unpaid.freeModels.title")}</div>
        <List
          class="flex-1 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0"
          ref={(ref) => (listRef = ref)}
          items={local.model.list}
          current={local.model.current()}
          key={(x) => `${x.provider.id}:${x.id}`}
          itemWrapper={(item, node) => (
            <Tooltip
              class="w-full"
              placement="right-start"
              gutter={12}
              value={
                <ModelTooltip
                  model={item}
                  latest={item.latest}
                  free={item.provider.id === "opencode" && (!item.cost || item.cost.input === 0)}
                />
              }
            >
              {node}
            </Tooltip>
          )}
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
              <Tag>{language.t("model.tag.free")}</Tag>
              <Show when={i.latest}>
                <Tag>{language.t("model.tag.latest")}</Tag>
              </Show>
            </div>
          )}
        </List>
        <div />
        <div />
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
                  dialog.show(() => <DialogConnectProvider provider={x.id} />)
                }}
              >
                {(i) => (
                  <div class="w-full flex items-center gap-x-3">
                    <ProviderIcon data-slot="list-item-extra-icon" id={i.id as IconName} />
                    <span>{i.name}</span>
                    <Show when={i.id === "opencode"}>
                      <Tag>{language.t("dialog.provider.tag.recommended")}</Tag>
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
                onClick={() => {
                  dialog.show(() => <DialogSelectProvider />)
                }}
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
