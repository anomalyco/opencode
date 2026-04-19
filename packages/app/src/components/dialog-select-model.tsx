import { Popover as Kobalte } from "@kobalte/core/popover"
import { Component, ComponentProps, createEffect, createMemo, createSignal, JSX, Show, ValidComponent } from "solid-js"
import { createStore } from "solid-js/store"
import { useLocal } from "@/context/local"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { popularProviders } from "@/hooks/use-providers"
import { Button } from "@opencode-ai/ui/button"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tag } from "@opencode-ai/ui/tag"
import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { ModelTooltip } from "./model-tooltip"
import { useLanguage } from "@/context/language"
import { useGlobalSync, type ProviderAccount } from "@/context/global-sync"

const isFree = (provider: string, cost: { input: number } | undefined) =>
  provider === "opencode" && (!cost || cost.input === 0)

type ModelState = ReturnType<typeof useLocal>["model"]

const ModelList: Component<{
  provider?: string
  class?: string
  onSelect: () => void
  action?: JSX.Element
  model?: ModelState
}> = (props) => {
  const model = props.model ?? useLocal().model
  const language = useLanguage()
  const globalSync = useGlobalSync()

  const models = createMemo(() =>
    model
      .list()
      .filter((m) => model.visible({ modelID: m.id, providerID: m.provider.id }))
      .filter((m) => (props.provider ? m.provider.id === props.provider : true)),
  )

  const [accountsMap, setAccountsMap] = createSignal<Record<string, ProviderAccount[]>>({})
  const [activeAccountMap, setActiveAccountMap] = createSignal<Record<string, string | undefined>>({})
  const fetched = new Set<string>()

  createEffect(() => {
    const providerIDs = new Set(models().map((m) => m.provider.id))
    for (const pid of providerIDs) {
      if (fetched.has(pid)) continue
      fetched.add(pid)
      void globalSync.provider.listAccounts(pid).then((accs) => {
        setAccountsMap((prev) => ({ ...prev, [pid]: accs }))
      })
      void globalSync.provider.getActiveAccount(pid).then((active) => {
        setActiveAccountMap((prev) => ({ ...prev, [pid]: active }))
      })
    }
  })

  function getAccountLabel(providerID: string, accountKey: string | undefined): string {
    if (!accountKey) return "Default"
    const accounts = accountsMap()[providerID]
    const account = accounts?.find((a) => a.key === accountKey)
    return account?.label || account?.email || accountKey
  }

  function modelAccountKey(m: { provider: { id: string; name: string }; id: string; name: string }): string | undefined {
    const raw = m as Record<string, unknown>
    if (typeof raw.accountKey === "string") return raw.accountKey
    return undefined
  }

  const providerHasMultipleAccounts = (providerID: string) => {
    const accounts = accountsMap()[providerID]
    return accounts && accounts.length > 1
  }

  const groupByFn = (x: { provider: { id: string; name: string }; id: string; name: string }) => {
    if (providerHasMultipleAccounts(x.provider.id)) {
      const accKey = modelAccountKey(x)
      const active = activeAccountMap()[x.provider.id]
      if (accKey) {
        const label = getAccountLabel(x.provider.id, accKey)
        return `${x.provider.name}\0${accKey}\0${label}\0${accKey === active ? "0" : "1"}`
      }
      const activeLabel = active ? getAccountLabel(x.provider.id, active) : "Default"
      return `${x.provider.name}\0${active ?? "default"}\0${activeLabel}\0${active ? "0" : "1"}`
    }
    return x.provider.name
  }

  const groupHeaderFn = (group: { category: string; items: unknown[] }) => {
    const parts = group.category.split("\0")
    if (parts.length === 4) {
      const providerName = parts[0]
      const accountLabel = parts[2]
      return (
        <div class="flex flex-col gap-0.5">
          <span class="text-12-medium text-text-strong">{providerName}</span>
          <span class="text-11-regular text-text-weak pl-2">{accountLabel}</span>
        </div>
      )
    }
    return <span class="text-12-medium text-text-strong">{group.category}</span>
  }

  return (
    <List
      class={`flex-1 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0 ${props.class ?? ""}`}
      search={{ placeholder: language.t("dialog.model.search.placeholder"), autofocus: true, action: props.action }}
      emptyMessage={language.t("dialog.model.empty")}
      key={(x) => `${x.provider.id}:${x.id}`}
      items={models}
      current={model.current()}
      filterKeys={["provider.name", "name", "id"]}
      sortBy={(a, b) => a.name.localeCompare(b.name)}
      groupBy={groupByFn}
      groupHeader={groupHeaderFn}
      sortGroupsBy={(a, b) => {
        const aParts = a.category.split("\0")
        const bParts = b.category.split("\0")
        const aProvider = aParts[0]
        const bProvider = bParts[0]
        const aFirstItem = a.items[0] as { provider?: { id?: string } } | undefined
        const bFirstItem = b.items[0] as { provider?: { id?: string } } | undefined
        const aProviderID = aFirstItem?.provider?.id ?? ""
        const bProviderID = bFirstItem?.provider?.id ?? ""

        if (aProvider !== bProvider) {
          if (popularProviders.includes(aProviderID) && !popularProviders.includes(bProviderID)) return -1
          if (!popularProviders.includes(aProviderID) && popularProviders.includes(bProviderID)) return 1
          return popularProviders.indexOf(aProviderID) - popularProviders.indexOf(bProviderID)
        }

        const aOrder = aParts[3] ?? "1"
        const bOrder = bParts[3] ?? "1"
        return aOrder.localeCompare(bOrder)
      }}
      itemWrapper={(item, node) => (
        <Tooltip
          class="w-full"
          placement="right-start"
          gutter={12}
          value={<ModelTooltip model={item} latest={item.latest} free={isFree(item.provider.id, item.cost)} />}
        >
          {node}
        </Tooltip>
      )}
      onSelect={(x) => {
        model.set(x ? { modelID: x.id, providerID: x.provider.id } : undefined, {
          recent: true,
        })
        props.onSelect()
      }}
    >
      {(i) => (
        <div class="w-full flex items-center gap-x-2 text-13-regular">
          <span class="truncate">{i.name}</span>
          <Show when={isFree(i.provider.id, i.cost)}>
            <Tag>{language.t("model.tag.free")}</Tag>
          </Show>
          <Show when={i.latest}>
            <Tag>{language.t("model.tag.latest")}</Tag>
          </Show>
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
