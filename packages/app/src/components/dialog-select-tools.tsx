import { Component, createMemo, createSignal, Show } from "solid-js"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { Switch } from "@opencode-ai/ui/switch"
import { useLanguage } from "@/context/language"

export const DialogSelectTools: Component = () => {
  const sync = useSync()
  const sdk = useSDK()
  const language = useLanguage()
  const [loading, setLoading] = createSignal<string | null>(null)

  const items = createMemo(() =>
    [...sync.data.tools].sort(
      (a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name),
    ),
  )

  const toggle = async (name: string) => {
    if (loading()) return
    setLoading(name)
    try {
      const result = await sdk.client.tools.toggle({ name })
      if (result.data) {
        sync.set("tools", (prev) => prev.map((t) => (t.name === name ? { ...t, disabled: result.data!.disabled } : t)))
      }
    } finally {
      setLoading(null)
    }
  }

  const enabledCount = createMemo(() => items().filter((t) => !t.disabled).length)
  const totalCount = createMemo(() => items().length)

  return (
    <Dialog
      title={language.t("dialog.tools.title")}
      description={language.t("dialog.tools.description", { enabled: enabledCount(), total: totalCount() })}
    >
      <List
        search={{ placeholder: language.t("common.search.placeholder"), autofocus: true }}
        emptyMessage={language.t("dialog.tools.empty")}
        key={(x) => x?.name ?? ""}
        items={items}
        filterKeys={["name", "category"]}
        sortBy={(a, b) => a.name.localeCompare(b.name)}
        groupBy={(x) => x.category}
        onSelect={(x) => {
          if (x) toggle(x.name)
        }}
      >
        {(i) => {
          const enabled = () => !sync.data.tools.find((t) => t.name === i.name)?.disabled
          return (
            <div class="w-full flex items-center justify-between gap-x-3">
              <div class="flex flex-col gap-0.5 min-w-0">
                <div class="flex items-center gap-2">
                  <span class="truncate">{i.name}</span>
                  <Show when={loading() === i.name}>
                    <span class="text-11-regular text-text-weak">{language.t("common.loading.ellipsis")}</span>
                  </Show>
                </div>
              </div>
              <div onClick={(e) => e.stopPropagation()}>
                <Switch checked={enabled()} disabled={loading() === i.name} onChange={() => toggle(i.name)} />
              </div>
            </div>
          )
        }}
      </List>
    </Dialog>
  )
}
