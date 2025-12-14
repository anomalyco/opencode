import { Component, Show } from "solid-js"
import { useLayout } from "@/context/layout"
import { popularProviders, useProviders } from "@/hooks/use-providers"
import { SelectDialog } from "@opencode-ai/ui/select-dialog"
import { Tag } from "@opencode-ai/ui/tag"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { IconName } from "@opencode-ai/ui/icons/provider"

export const DialogProvider: Component = () => {
  const layout = useLayout()
  const providers = useProviders()

  return (
    <SelectDialog
      defaultOpen
      title="Connect provider"
      placeholder="Search providers"
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
        layout.dialog.connect(x.id)
      }}
      onOpenChange={(open) => {
        if (open) {
          layout.dialog.open("provider")
        } else {
          layout.dialog.close("provider")
        }
      }}
    >
      {(i) => (
        <div class="px-1.25 w-full flex items-center gap-x-4">
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
    </SelectDialog>
  )
}
