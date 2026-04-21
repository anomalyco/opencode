import { Popover as Kobalte } from "@kobalte/core/popover"
import { Component, ComponentProps, createMemo, JSX, Show, ValidComponent } from "solid-js"
import { createStore } from "solid-js/store"
import { useLocal } from "@/context/local"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { popularProviders } from "@/hooks/use-providers"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tag } from "@opencode-ai/ui/tag"
import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { ModelTooltip } from "./model-tooltip"
import { useLanguage } from "@/context/language"

const isFree = (provider: string, cost: { input: number } | undefined) =>
  provider === "opencode" && (!cost || cost.input === 0)

type ModelState = ReturnType<typeof useLocal>["model"]
type ModelListItem = {
  model: ReturnType<ModelState["list"]>[number]
  category: string
  order: number
}

function key(item: { provider: { id: string }; id: string }) {
  return `${item.provider.id}:${item.id}`
}

const ModelList: Component<{
  provider?: string
  class?: string
  onSelect: () => void
  action?: JSX.Element
  model?: ModelState
}> = (props) => {
  const model = props.model ?? useLocal().model
  const language = useLanguage()

  const items = createMemo<ModelListItem[]>(() => {
    const favoritesLabel = language.t("dialog.model.group.favorites")
    const recentLabel = language.t("dialog.model.group.recent")
    const visible = model
      .list()
      .filter((m) => model.visible({ modelID: m.id, providerID: m.provider.id }))
      .filter((m) => (props.provider ? m.provider.id === props.provider : true))

    if (props.provider) {
      return visible.map((item, order) => ({ model: item, category: item.provider.name, order }))
    }

    const favorites = model.favorite().flatMap((item) => (item ? [item] : []))
    const recent = model.recent().flatMap((item) => (item ? [item] : []))
    const favoriteKeys = new Set(favorites.map(key))
    const recentKeys = new Set(recent.map(key))

    const rest = visible
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

  return (
    <List
      class={`flex-1 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0 ${props.class ?? ""}`}
      search={{ placeholder: language.t("dialog.model.search.placeholder"), autofocus: true, action: props.action }}
      emptyMessage={language.t("dialog.model.empty")}
      key={(x) => `${x.model.provider.id}:${x.model.id}`}
      items={items}
      current={current()}
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

        const aProvider = a.items[0].model.provider.id
        const bProvider = b.items[0].model.provider.id
        if (popularProviders.includes(aProvider) && !popularProviders.includes(bProvider)) return -1
        if (!popularProviders.includes(aProvider) && popularProviders.includes(bProvider)) return 1
        if (!popularProviders.includes(aProvider) && !popularProviders.includes(bProvider))
          return a.items[0].model.provider.name.localeCompare(b.items[0].model.provider.name)
        return popularProviders.indexOf(aProvider) - popularProviders.indexOf(bProvider)
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
              free={isFree(item.model.provider.id, item.model.cost)}
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
        props.onSelect()
      }}
    >
      {(i) => (
        <div class="w-full flex items-center gap-x-2 text-13-regular">
          <span class="truncate">{i.model.name}</span>
          <Show when={isFree(i.model.provider.id, i.model.cost)}>
            <Tag>{language.t("model.tag.free")}</Tag>
          </Show>
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
              class={
                model.isFavorite({ modelID: i.model.id, providerID: i.model.provider.id })
                  ? "text-icon-warning-base"
                  : undefined
              }
            />
          </div>
        </div>
      )}
    </List>
  )
}

type ModelSelectorTriggerProps = Omit<ComponentProps<typeof Kobalte.Trigger>, "as" | "ref">
type Dismiss = "escape" | "outside" | "select" | "manage" | "provider"

export function ModelSelectorPopover(props: {
  provider?: string
  model?: ModelState
  children?: JSX.Element
  triggerAs?: ValidComponent
  triggerProps?: ModelSelectorTriggerProps
  onClose?: (cause: "escape" | "select") => void
}) {
  const [store, setStore] = createStore<{
    open: boolean
    dismiss: Dismiss | null
  }>({
    open: false,
    dismiss: null,
  })
  const dialog = useDialog()

  const close = (dismiss: Dismiss) => {
    setStore("dismiss", dismiss)
    setStore("open", false)
  }

  const handleManage = () => {
    close("manage")
    void import("./dialog-manage-models").then((x) => {
      dialog.show(() => <x.DialogManageModels />)
    })
  }

  const handleConnectProvider = () => {
    close("provider")
    void import("./dialog-select-provider").then((x) => {
      dialog.show(() => <x.DialogSelectProvider />)
    })
  }
  const language = useLanguage()

  return (
    <Kobalte
      open={store.open}
      onOpenChange={(next) => {
        if (next) setStore("dismiss", null)
        setStore("open", next)
      }}
      modal={false}
      placement="top-start"
      gutter={4}
    >
      <Kobalte.Trigger as={props.triggerAs ?? "div"} {...props.triggerProps}>
        {props.children}
      </Kobalte.Trigger>
      <Kobalte.Portal>
        <Kobalte.Content
          class="w-72 h-80 flex flex-col p-2 rounded-md border border-border-base bg-surface-raised-stronger-non-alpha shadow-md z-50 outline-none overflow-hidden"
          onEscapeKeyDown={(event) => {
            close("escape")
            event.preventDefault()
            event.stopPropagation()
          }}
          onPointerDownOutside={() => close("outside")}
          onFocusOutside={() => close("outside")}
          onCloseAutoFocus={(event) => {
            const dismiss = store.dismiss
            if (dismiss === "outside") event.preventDefault()
            if (dismiss === "escape" || dismiss === "select") {
              event.preventDefault()
              props.onClose?.(dismiss)
            }
            setStore("dismiss", null)
          }}
        >
          <Kobalte.Title class="sr-only">{language.t("dialog.model.select.title")}</Kobalte.Title>
          <ModelList
            provider={props.provider}
            model={props.model}
            onSelect={() => close("select")}
            class="p-1"
            action={
              <div class="flex items-center gap-1">
                <Tooltip placement="top" value={language.t("command.provider.connect")}>
                  <IconButton
                    icon="plus-small"
                    variant="ghost"
                    iconSize="normal"
                    class="size-6"
                    aria-label={language.t("command.provider.connect")}
                    onClick={handleConnectProvider}
                  />
                </Tooltip>
                <Tooltip placement="top" value={language.t("dialog.model.manage")}>
                  <IconButton
                    icon="sliders"
                    variant="ghost"
                    iconSize="normal"
                    class="size-6"
                    aria-label={language.t("dialog.model.manage")}
                    onClick={handleManage}
                  />
                </Tooltip>
              </div>
            }
          />
        </Kobalte.Content>
      </Kobalte.Portal>
    </Kobalte>
  )
}

export const DialogSelectModel: Component<{ provider?: string; model?: ModelState }> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()

  const provider = () => {
    void import("./dialog-select-provider").then((x) => {
      dialog.show(() => <x.DialogSelectProvider />)
    })
  }

  const manage = () => {
    void import("./dialog-manage-models").then((x) => {
      dialog.show(() => <x.DialogManageModels />)
    })
  }

  return (
    <Dialog
      title={language.t("dialog.model.select.title")}
      action={
        <Button class="h-7 -my-1 text-14-medium" icon="plus-small" tabIndex={-1} onClick={provider}>
          {language.t("command.provider.connect")}
        </Button>
      }
    >
      <ModelList provider={props.provider} model={props.model} onSelect={() => dialog.close()} />
      <Button variant="ghost" class="ml-3 mt-5 mb-6 text-text-base self-start" onClick={manage}>
        {language.t("dialog.model.manage")}
      </Button>
    </Dialog>
  )
}
