import { type Accessor, type JSX } from "solid-js"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { useLanguage } from "@/context/language"

export type SidebarSearchScope = "current" | "all"

export const SidebarSearch = (props: {
  query: Accessor<string>
  setQuery: (value: string) => void
  scope: Accessor<SidebarSearchScope>
  setScope: (value: SidebarSearchScope) => void
}): JSX.Element => {
  const language = useLanguage()
  const label = (value: SidebarSearchScope) =>
    value === "all" ? language.t("sidebar.search.scope.all") : language.t("sidebar.search.scope.current")

  return (
    <div data-component="sidebar-search" class="pt-2">
      <div class="relative">
        <div class="pointer-events-none absolute inset-y-0 left-2 flex items-center text-icon-weak">
          <Icon name="magnifying-glass" size="small" />
        </div>
        <input
          type="text"
          value={props.query()}
          onInput={(event) => props.setQuery(event.currentTarget.value)}
          placeholder={label(props.scope())}
          aria-label={language.t("sidebar.search.placeholder")}
          class="w-full h-8 pl-7 pr-8 box-border rounded-md border border-border-weak-base bg-surface-panel text-13-regular text-text-strong placeholder:text-text-weak focus:outline-none focus:border-border-base"
        />
        <div class="absolute inset-y-0 right-1 flex items-center">
          <DropdownMenu placement="bottom-end" gutter={6}>
            <DropdownMenu.Trigger
              as={IconButton}
              icon="chevron-down"
              variant="ghost"
              size="small"
              class="size-6 rounded-md"
              aria-label={label(props.scope())}
            />
            <DropdownMenu.Portal>
              <DropdownMenu.Content class="min-w-48">
                <DropdownMenu.Item onSelect={() => props.setScope("current")}>
                  <DropdownMenu.ItemLabel>{label("current")}</DropdownMenu.ItemLabel>
                </DropdownMenu.Item>
                <DropdownMenu.Item onSelect={() => props.setScope("all")}>
                  <DropdownMenu.ItemLabel>{label("all")}</DropdownMenu.ItemLabel>
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu>
        </div>
      </div>
    </div>
  )
}
