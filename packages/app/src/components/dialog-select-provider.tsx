import { Component, Show } from "solid-js"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { popularProviders, useProviders } from "@/hooks/use-providers"
import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { Tag } from "@opencode-ai/ui/tag"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { IconName } from "@opencode-ai/ui/icons/provider"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { DialogConnectProvider } from "./dialog-connect-provider"

export const DialogSelectProvider: Component<{ onBack?: () => void }> = (props) => {
  const dialog = useDialog()
  const providers = useProviders()
  const showProviderList = () => dialog.show(() => <DialogSelectProvider onBack={props.onBack} />)

  return (
    <Dialog
      title={
        props.onBack ? (
          <div class="flex items-center gap-2">
            <IconButton tabIndex={-1} icon="arrow-left" variant="ghost" onClick={props.onBack} />
            <span>Connect provider</span>
          </div>
        ) : (
          "Connect provider"
        )
      }
    >
      <List
        search={{ placeholder: "Search providers", autofocus: true }}
        activeIcon="plus-small"
        key={(x) => x?.id}
        items={providers.all}
        filterKeys={["id", "name"]}
        groupBy={(x) => (popularProviders.includes(x.id) ? "Popular" : "Other")}
        sortBy={(a, b) => {
          if (popularProviders.includes(a.id) && popularProviders.includes(b.id))
            return popularProviders.indexOf(a.id) - popularProviders.indexOf(b.id)
          return a.name.localeCompare(b.name)
        }}
        sortGroupsBy={(a, b) => {
          if (a.category === "Popular" && b.category !== "Popular") return -1
          if (b.category === "Popular" && a.category !== "Popular") return 1
          return 0
        }}
        onSelect={(x) => {
          if (!x) return
          dialog.show(
            () =>
              <DialogConnectProvider
                provider={x.id}
                onBack={props.onBack ? showProviderList : undefined}
              />,
          )
        }}
      >
        {(i) => (
          <div class="px-1.25 w-full flex items-center gap-x-3">
            <ProviderIcon data-slot="list-item-extra-icon" id={i.id as IconName} />
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
    </Dialog>
  )
}
