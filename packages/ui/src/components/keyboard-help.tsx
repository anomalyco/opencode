import { Component, For, Show, createMemo, createSignal } from "solid-js"
import { Dialog } from "./dialog"
import { Button } from "./button"
import { Icon } from "./icon"
import { Keybind } from "./keybind"

export interface KeyboardShortcut {
  id: string
  category: string
  title: string
  description?: string
  keybind?: string
}

export interface KeyboardHelpProps {
  shortcuts: KeyboardShortcut[]
  isOpen: boolean
  onClose: () => void
}

const CATEGORIES = [
  "view",
  "project",
  "session",
  "workspace",
  "theme",
  "language",
  "command",
  "provider",
  "server",
  "settings",
] as const

type Category = typeof CATEGORIES[number]

export function KeyboardHelp(props: KeyboardHelpProps) {
  const [searchQuery, setSearchQuery] = createSignal("")

  const categories = createMemo(() => {
    const query = searchQuery().toLowerCase()
    const shortcutsByCategory = new Map<Category, KeyboardShortcut[]>()

    for (const category of CATEGORIES) {
      shortcutsByCategory.set(category, [])
    }

    for (const shortcut of props.shortcuts) {
      const matchesQuery = 
        !query ||
        shortcut.title.toLowerCase().includes(query) ||
        shortcut.description?.toLowerCase().includes(query) ||
        shortcut.keybind?.toLowerCase().includes(query)

      if (matchesQuery) {
        const category = shortcut.category as Category
        const list = shortcutsByCategory.get(category) || []
        list.push(shortcut)
        shortcutsByCategory.set(category, list)
      }
    }

    return Array.from(shortcutsByCategory.entries())
      .filter(([_, shortcuts]) => shortcuts.length > 0)
  })

  const parseKeybind = (keybind?: string) => {
    if (!keybind) return []
    return keybind.split("+").map((part) => part.trim())
  }

  return (
    <Dialog isOpen={props.isOpen} onClose={props.onClose} title="Keyboard Shortcuts">
      <div class="flex flex-col gap-4 max-h-[70vh]">
        <div class="relative">
          <Icon name="search" class="absolute left-3 top-1/2 -translate-y-1/2 text-icon-weak" size="small" />
          <input
            type="text"
            placeholder="Search shortcuts..."
            value={searchQuery()}
            onInput={(e) => setSearchQuery(e.target.value)}
            class="w-full pl-9 pr-4 py-2 rounded-md bg-surface-base border border-border-weak-base text-text-strong placeholder-text-weak focus:outline-none focus:border-icon-info-active"
          />
        </div>

        <div class="overflow-y-auto flex-1">
          <For each={categories()}>
            {([category, shortcuts]) => (
              <div class="mb-6">
                <h3 class="text-12-medium text-text-weak mb-3 uppercase tracking-wider">
                  {category}
                </h3>
                <div class="space-y-2">
                  <For each={shortcuts}>
                    {(shortcut) => (
                      <div class="flex items-center justify-between py-2 px-3 rounded-md hover:bg-surface-base-hover transition-colors">
                        <div class="flex-1">
                          <div class="text-14-regular text-text-strong">{shortcut.title}</div>
                          <Show when={shortcut.description}>
                            <div class="text-12-regular text-text-weak mt-1">
                              {shortcut.description}
                            </div>
                          </Show>
                        </div>
                        <Show when={shortcut.keybind}>
                          <div class="flex items-center gap-1 ml-4">
                            <For each={parseKeybind(shortcut.keybind)}>
                              {(key, index) => (
                                <>
                                  <Keybind>{key}</Keybind>
                                  <Show when={index() < parseKeybind(shortcut.keybind).length - 1}>
                                    <span class="text-text-weak text-12-regular">+</span>
                                  </Show>
                                </>
                              )}
                            </For>
                          </div>
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            )}
          </For>

          <Show when={categories().length === 0}>
            <div class="text-center py-8 text-text-weak">
              No shortcuts found matching "{searchQuery()}"
            </div>
          </Show>
        </div>

        <div class="flex justify-end pt-2 border-t border-border-weak-base">
          <Button variant="secondary" onClick={props.onClose}>
            Close
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
