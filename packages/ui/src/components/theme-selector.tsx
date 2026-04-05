import { Component, For, Show, createMemo, createSignal } from "solid-js"
import { Dialog } from "./dialog"
import { Button } from "./button"
import { Icon } from "./icon"
import { ThemePreview } from "./theme-preview"
import type { ColorScheme } from "../theme/context"

export interface ThemeSelectorProps {
  isOpen: boolean
  onClose: () => void
  themes: Record<string, { id: string; name: string }>
  currentThemeId: string
  colorScheme: ColorScheme
  onThemeSelect: (themeId: string) => void
  onColorSchemeChange: (scheme: ColorScheme) => void
  onPreviewTheme: (themeId: string) => void
  onPreviewColorScheme: (scheme: ColorScheme) => void
  onCommitPreview: () => void
  onCancelPreview: () => void
  previewThemeId: string | null
  previewColorScheme: ColorScheme | null
}

export function ThemeSelector(props: ThemeSelectorProps) {
  const [searchQuery, setSearchQuery] = createSignal("")
  const [selectedCategory, setSelectedCategory] = createSignal<string | null>(null)

  const categories = createMemo(() => {
    const allThemes = Object.values(props.themes)
    const cats = new Set<string>()
    
    // 简单的主题分类逻辑
    allThemes.forEach(theme => {
      if (theme.name.toLowerCase().includes('dark')) cats.add('Dark')
      else if (theme.name.toLowerCase().includes('light')) cats.add('Light')
      else if (['Catppuccin', 'Dracula', 'Nord', 'One Dark', 'Tokyonight'].includes(theme.name)) cats.add('Popular')
      else cats.add('All')
    })
    
    return ['All', ...Array.from(cats).filter(c => c !== 'All')]
  })

  const filteredThemes = createMemo(() => {
    const query = searchQuery().toLowerCase()
    const category = selectedCategory()
    
    return Object.values(props.themes).filter(theme => {
      const matchesQuery = !query || theme.name.toLowerCase().includes(query)
      const matchesCategory = !category || category === 'All' || 
        (category === 'Dark' && theme.name.toLowerCase().includes('dark')) ||
        (category === 'Light' && theme.name.toLowerCase().includes('light')) ||
        (category === 'Popular' && ['Catppuccin', 'Dracula', 'Nord', 'One Dark', 'Tokyonight'].includes(theme.name))
      return matchesQuery && matchesCategory
    })
  })

  const colorSchemes: { value: ColorScheme; label: string }[] = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' }
  ]

  return (
    <Dialog isOpen={props.isOpen} onClose={props.onClose} title="Theme Selector">
      <div class="flex flex-col gap-4 max-h-[70vh]">
        {/* 搜索和分类 */}
        <div class="space-y-3">
          <div class="relative">
            <Icon name="search" class="absolute left-3 top-1/2 -translate-y-1/2 text-icon-weak" size="small" />
            <input
              type="text"
              placeholder="Search themes..."
              value={searchQuery()}
              onInput={(e) => setSearchQuery(e.target.value)}
              class="w-full pl-9 pr-4 py-2 rounded-md bg-surface-base border border-border-weak-base text-text-strong placeholder-text-weak focus:outline-none focus:border-icon-info-active"
            />
          </div>
          
          <div class="flex flex-wrap gap-2">
            <For each={categories()}>
              {(category) => (
                <Button
                  variant={selectedCategory() === category ? "secondary" : "ghost"}
                  size="small"
                  onClick={() => setSelectedCategory(selectedCategory() === category ? null : category)}
                >
                  {category}
                </Button>
              )}
            </For>
          </div>
        </div>

        {/* 主题预览网格 */}
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 overflow-y-auto flex-1">
          <For each={filteredThemes()}>
            {(theme) => (
              <ThemePreview
                id={theme.id}
                name={theme.name}
                isActive={theme.id === props.currentThemeId && !props.previewThemeId}
                isPreviewing={theme.id === props.previewThemeId}
                onSelect={() => props.onThemeSelect(theme.id)}
                onPreview={() => props.onPreviewTheme(theme.id)}
                onCancelPreview={props.onCancelPreview}
                onCommitPreview={props.onCommitPreview}
              />
            )}
          </For>
        </div>

        {/* 颜色方案选择 */}
        <div class="pt-2 border-t border-border-weak-base">
          <h3 class="text-12-medium text-text-weak mb-3 uppercase tracking-wider">Color Scheme</h3>
          <div class="flex flex-wrap gap-2">
            <For each={colorSchemes}>
              {(scheme) => (
                <Button
                  variant={
                    (props.previewColorScheme || props.colorScheme) === scheme.value 
                      ? "secondary" 
                      : "ghost"
                  }
                  size="small"
                  onClick={() => props.onPreviewColorScheme(scheme.value)}
                >
                  {scheme.label}
                </Button>
              )}
            </For>
          </div>
        </div>

        {/* 操作按钮 */}
        <div class="flex justify-end pt-2 border-t border-border-weak-base gap-2">
          <Show when={props.previewThemeId || props.previewColorScheme}>
            <Button variant="ghost" onClick={props.onCancelPreview}>
              Cancel Preview
            </Button>
            <Button variant="primary" onClick={props.onCommitPreview}>
              Apply
            </Button>
          </Show>
          <Show when={!props.previewThemeId && !props.previewColorScheme}>
            <Button variant="secondary" onClick={props.onClose}>
              Close
            </Button>
          </Show>
        </div>
      </div>
    </Dialog>
  )
}
