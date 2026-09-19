import { Icon } from "@opencode/ui/icon"
import { Menu } from "@opencode/ui/menu"
import { getFilename } from "@opencode/util/path"
import { createMemo, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"

export function WorkspaceSubmenu(props: {
  directories: string[]
  selected?: string
  disabled?: boolean
  onSelect: (directory: string) => void
  onViewAll?: () => void
}) {
  const language = useLanguage()
  const [store, setStore] = createStore({ search: "", focusSearch: false })
  let input: HTMLInputElement | undefined
  let list: HTMLDivElement | undefined
  const searchable = () => props.directories.length >= 10
  const directories = createMemo(() => {
    const query = store.search.trim().toLowerCase()
    return props.directories.filter((directory) => getFilename(directory).toLowerCase().includes(query))
  })
  const focusSearch = () => {
    if (!searchable()) return
    requestAnimationFrame(() => requestAnimationFrame(() => input?.focus({ preventScroll: true })))
  }

  return (
    <Menu.Sub
      gutter={0}
      overlap
      overflowPadding={24}
      onOpenChange={(open) => {
        if (!open) {
          setStore({ search: "", focusSearch: false })
          return
        }
        if (store.focusSearch) focusSearch()
        setStore("focusSearch", false)
      }}
    >
      <Menu.SubTrigger
        onClick={focusSearch}
        onKeyDown={(event) => {
          if (["ArrowRight", "ArrowLeft", "Enter", " "].includes(event.key)) setStore("focusSearch", true)
        }}
      >
        <Icon name="outline-worktree" />
        <span class="min-w-0 flex-1 truncate">
          {language.t("session.new.workspace.existing").replace(/(…|\.{3})$/, "")}
        </span>
      </Menu.SubTrigger>
      <Menu.Portal>
        <Menu.SubContent
          data-slot="workspace-submenu"
          class="max-h-[min(320px,calc(100dvh-48px))] w-[200px] overflow-hidden"
        >
          <Show when={searchable()}>
            <div class="flex h-7 shrink-0 items-center gap-2 rounded-sm ps-3 pe-2 text-v2-icon-icon-muted">
              <Icon name="magnifying-glass" size="small" class="shrink-0" />
              <input
                ref={input}
                value={store.search}
                placeholder={language.t("session.new.workspace.search.placeholder")}
                aria-label={language.t("session.new.workspace.search.placeholder")}
                class="h-7 min-w-0 flex-1 border-0 bg-transparent text-[13px] font-[440] leading-text-compact tracking-[-0.04px] text-v2-text-text-base outline-none placeholder:text-v2-text-text-faint"
                onInput={(event) => setStore("search", event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault()
                    event.stopPropagation()
                    const items = list?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([data-disabled])')
                    items?.[event.key === "ArrowDown" ? 0 : items.length - 1]?.focus()
                    return
                  }
                  if (["Escape", "Enter"].includes(event.key)) return
                  event.stopPropagation()
                }}
              />
            </div>
          </Show>
          <div ref={list} data-slot="workspace-submenu-list" class="min-h-0 overflow-y-auto overscroll-contain">
            <For each={directories()}>
              {(directory) => (
                <Menu.Item disabled={props.disabled} onSelect={() => props.onSelect(directory)}>
                  <Icon name="outline-worktree" />
                  <span class="min-w-0 flex-1 truncate">{getFilename(directory)}</span>
                  <Show when={props.selected === directory}>
                    <Icon name="check" size="small" class="shrink-0" />
                  </Show>
                </Menu.Item>
              )}
            </For>
            <Show when={store.search.trim() && directories().length === 0}>
              <div class="px-3 py-4 text-center text-[13px] font-[440] leading-5 text-v2-text-text-muted">
                {language.t("session.new.workspace.search.empty")}
              </div>
            </Show>
          </div>
          <Show when={props.onViewAll}>
            <Menu.Separator class="h-[0.5px] shrink-0" />
            <Menu.Item onSelect={() => props.onViewAll?.()}>
              <span class="min-w-0 flex-1 truncate">{language.t("common.viewAll")}</span>
            </Menu.Item>
          </Show>
        </Menu.SubContent>
      </Menu.Portal>
    </Menu.Sub>
  )
}
