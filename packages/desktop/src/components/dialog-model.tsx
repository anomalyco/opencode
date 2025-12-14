import { Component, createMemo, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { useLocal } from "@/context/local"
import { useLayout } from "@/context/layout"
import { popularProviders, useProviders } from "@/hooks/use-providers"
import { SelectDialog } from "@opencode-ai/ui/select-dialog"
import { Button } from "@opencode-ai/ui/button"
import { Tag } from "@opencode-ai/ui/tag"
import { Dialog } from "@opencode-ai/ui/dialog"
import { List, ListRef } from "@opencode-ai/ui/list"
import { iife } from "@opencode-ai/util/iife"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { IconName } from "@opencode-ai/ui/icons/provider"

export const DialogModel: Component = () => {
  const local = useLocal()
  const layout = useLayout()
  const providers = useProviders()

  return (
    <Switch>
      <Match when={providers.paid().length > 0}>
        {iife(() => {
          const models = createMemo(() =>
            local.model
              .list()
              .filter((m) => m.visible)
              .filter((m) =>
                layout.connect.state() === "complete" ? m.provider.id === layout.connect.provider() : true,
              ),
          )
          return (
            <SelectDialog
              defaultOpen
              onOpenChange={(open) => {
                if (open) {
                  layout.dialog.open("model")
                } else {
                  layout.dialog.close("model")
                }
              }}
              title="Select model"
              placeholder="Search models"
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
              onSelect={(x) =>
                local.model.set(x ? { modelID: x.id, providerID: x.provider.id } : undefined, {
                  recent: true,
                })
              }
              actions={
                <Button
                  class="h-7 -my-1 text-14-medium"
                  icon="plus-small"
                  tabIndex={-1}
                  onClick={() => layout.dialog.open("provider")}
                >
                  Connect provider
                </Button>
              }
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
            </SelectDialog>
          )
        })}
      </Match>
      <Match when={true}>
        {iife(() => {
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
            <Dialog
              modal
              defaultOpen
              onOpenChange={(open) => {
                if (open) {
                  layout.dialog.open("model")
                } else {
                  layout.dialog.close("model")
                }
              }}
            >
              <Dialog.Header>
                <Dialog.Title>Select model</Dialog.Title>
                <Dialog.CloseButton tabIndex={-1} />
              </Dialog.Header>
              <Dialog.Body>
                <div class="flex flex-col gap-3 px-2.5">
                  <div class="text-14-medium text-text-base px-2.5">Free models provided by OpenCode</div>
                  <List
                    ref={(ref) => (listRef = ref)}
                    items={local.model.list}
                    current={local.model.current()}
                    key={(x) => `${x.provider.id}:${x.id}`}
                    onSelect={(x) => {
                      local.model.set(x ? { modelID: x.id, providerID: x.provider.id } : undefined, {
                        recent: true,
                      })
                      layout.dialog.close("model")
                    }}
                  >
                    {(i) => (
                      <div class="w-full flex items-center gap-x-2.5">
                        <span>{i.name}</span>
                        <Tag>Free</Tag>
                        <Show when={i.latest}>
                          <Tag>Latest</Tag>
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
                      <div class="px-2 text-14-medium text-text-base">Add more models from popular providers</div>
                      <div class="w-full">
                        <List
                          class="w-full"
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
                            layout.dialog.connect(x.id)
                          }}
                        >
                          {(i) => (
                            <div class="w-full flex items-center gap-x-4">
                              <ProviderIcon
                                data-slot="list-item-extra-icon"
                                id={i.id as IconName}
                                // TODO: clean this up after we update icon in models.dev
                                classList={{
                                  "text-icon-weak-base": true,
                                  "size-4 mx-0.5": i.id === "opencode",
                                  "size-5": i.id !== "opencode",
                                }}
                              />
                              <span>{i.name}</span>
                              <Show when={i.id === "opencode"}>
                                <Tag>Recommended</Tag>
                              </Show>
                              <Show when={i.id === "anthropic"}>
                                <div class="text-14-regular text-text-weak">Connect with Claude Pro/Max or API key</div>
                              </Show>
                            </div>
                          )}
                        </List>
                        <Button
                          variant="ghost"
                          class="w-full justify-start px-[11px] py-3.5 gap-4.5 text-14-medium"
                          icon="dot-grid"
                          onClick={() => {
                            layout.dialog.open("provider")
                          }}
                        >
                          View all providers
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </Dialog.Body>
            </Dialog>
          )
        })}
      </Match>
    </Switch>
  )
}
