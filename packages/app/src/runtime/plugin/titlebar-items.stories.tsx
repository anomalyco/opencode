import { For } from "solid-js"
import type { TitlebarItem } from "@opencode/plugin/gui"
import { TitlebarItems } from "./titlebar-items"

const catalogs = import.meta.glob<{ default: Record<string, string> }>(
  "../../../../gui-plugins/src/updater/i18n/*.ts",
  { eager: true },
)

const rtl = new Set(["ar", "dv", "fa", "he", "ur"])

const locales = Object.entries(catalogs)
  .map(([file, module]) => ({
    locale: file.split("/").pop()!.replace(".ts", ""),
    label: module.default["status.label"]!,
  }))
  .sort((a, b) => a.locale.localeCompare(b.locale))

const items = (label: string) => {
  const item: TitlebarItem = { id: "update", label, run: () => {} }

  return { ids: () => [item.id], item: () => item }
}

export default {
  title: "App/Titlebar/Items",
  id: "app-titlebar-items",
  component: TitlebarItems,
}

/** The update pill in every updater locale; hover or focus a pill to expand its label. */
export const UpdateLabels = {
  render: () => (
    <div class="flex flex-col gap-1 bg-v2-background-bg-base p-4">
      <For each={locales}>
        {(entry) => (
          <div data-locale={entry.locale} dir={rtl.has(entry.locale) ? "rtl" : "ltr"} class="flex items-center gap-4">
            <span class="w-10 shrink-0 font-mono text-[11px] text-v2-text-text-weak">{entry.locale}</span>
            <div
              data-slot="story-horizontal"
              class="flex h-10 w-[320px] shrink-0 items-center justify-end rounded-md bg-v2-background-bg-deep/60"
            >
              <div class="relative z-20 flex shrink-0 items-center justify-end overflow-visible">
                <TitlebarItems items={items(entry.label)} />
              </div>
            </div>
            <div
              data-slot="story-vertical"
              class="flex w-[220px] shrink-0 flex-col rounded-md bg-v2-background-bg-deep/60 p-2"
            >
              <TitlebarItems items={items(entry.label)} vertical />
            </div>
          </div>
        )}
      </For>
    </div>
  ),
}
