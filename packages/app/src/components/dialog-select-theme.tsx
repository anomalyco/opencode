import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { List } from "@opencode-ai/ui/list"
import { useTheme, type ColorScheme } from "@opencode-ai/ui/theme"
import { createMemo, onCleanup } from "solid-js"
import { useLanguage } from "@/context/language"

type ThemeEntry = {
  id: string
  type: "theme" | "scheme"
  title: string
  category: string
  themeId?: string
  scheme?: ColorScheme
}

const colorSchemeOrder: ColorScheme[] = ["system", "light", "dark"]

export function DialogSelectTheme() {
  const theme = useTheme()
  const language = useLanguage()
  const dialog = useDialog()
  const state = { cleanup: undefined as (() => void) | void, committed: false, pending: undefined as ReturnType<typeof setTimeout> | undefined }

  const colorSchemeLabel = (scheme: ColorScheme) => {
    switch (scheme) {
      case "system":
        return language.t("theme.scheme.system")
      case "light":
        return language.t("theme.scheme.light")
      case "dark":
        return language.t("theme.scheme.dark")
    }
  }

  const items = createMemo(() => {
    const entries: ThemeEntry[] = []

    for (const scheme of colorSchemeOrder) {
      entries.push({
        id: `scheme:${scheme}`,
        type: "scheme",
        title: colorSchemeLabel(scheme),
        category: language.t("command.category.theme"),
        scheme,
      })
    }

    for (const [id, definition] of Object.entries(theme.themes())) {
      entries.push({
        id: `theme:${id}`,
        type: "theme",
        title: definition.name ?? id,
        category: language.t("dialog.theme.group.theme"),
        themeId: id,
      })
    }

    return entries
  })

  const handleMove = (item: ThemeEntry | undefined) => {
    clearTimeout(state.pending)
    if (!item) return

    console.debug("[dialog-theme] handleMove type=" + item.type + " id=" + item.id)
    state.pending = setTimeout(() => {
      state.cleanup?.()
      if (item.type === "theme" && item.themeId) {
        state.cleanup = () => theme.cancelPreview()
        theme.previewTheme(item.themeId)
      } else if (item.type === "scheme" && item.scheme) {
        state.cleanup = () => theme.cancelPreview()
        theme.previewColorScheme(item.scheme)
      }
    }, 80)
  }

const handleSelect = (item: ThemeEntry | undefined) => {
    clearTimeout(state.pending)
    if (!item) return
    state.committed = true
    state.cleanup = undefined

    if (item.type === "theme" && item.themeId) {
      theme.setTheme(item.themeId)
    } else if (item.type === "scheme" && item.scheme) {
      theme.setColorScheme(item.scheme)
    }

    dialog.close()
  }

  const currentTheme = createMemo(() => `theme:${theme.themeId()}`)
  const currentScheme = createMemo(() => `scheme:${theme.colorScheme()}`)

  const isCurrent = (item: ThemeEntry) => {
    if (item.type === "theme") return item.id === currentTheme()
    return item.id === currentScheme()
  }

  onCleanup(() => {
    if (state.committed) return
    state.cleanup?.()
  })

  return (
    <Dialog class="pt-3 pb-0 !max-h-[480px]" transition>
      <List
        search={{
          placeholder: language.t("dialog.theme.search.placeholder"),
          autofocus: true,
          hideIcon: true,
        }}
        emptyMessage={language.t("dialog.theme.empty")}
        items={() => items()}
        key={(item) => item.id}
        filterKeys={["title", "category"]}
        groupBy={(item) => item.category}
        onMove={handleMove}
        onSelect={handleSelect}
      >
        {(item) => (
          <div class="w-full flex items-center justify-between gap-4">
            <div class="flex items-center gap-2 min-w-0">
              <Icon
                name={item.type === "theme" ? "sliders" : "settings-gear"}
                size="small"
                class="shrink-0 text-icon-weak"
              />
              <span class="text-14-regular text-text-strong whitespace-nowrap">{item.title}</span>
            </div>
            {isCurrent(item) && <Icon name="check" size="small" class="shrink-0 text-accent" />}
          </div>
        )}
      </List>
    </Dialog>
  )
}
