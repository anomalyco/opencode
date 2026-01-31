import { Component, createSignal, onMount, For, Show } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { useLanguage } from "@/context/language"
import { showToast } from "@opencode-ai/ui/toast"

type PrefField = {
  type: string
  description?: string
  options?: Array<{ label: string; value: any }>
}

export const SettingsPlugins: Component = () => {
  const language = useLanguage()
  const [tabs, setTabs] = createSignal<Array<any>>([])
  const [selected, setSelected] = createSignal<string | null>(null)
  const [values, setValues] = createSignal<Record<string, any>>({})

  onMount(async () => {
    try {
      const res = await fetch(`/preferences`)
      if (!res.ok) throw new Error("Failed to fetch preferences")
      const data = await res.json()
      setTabs(data)
      if (data.length > 0) setSelected(data[0].id)
    } catch (err) {
      // no-op
    }
  })

  async function loadValues(pluginId: string) {
    try {
      const res = await fetch(`/preferences/${pluginId}/values`)
      if (!res.ok) throw new Error("failed")
      const data = await res.json()
      setValues(data)
    } catch (err) {
      setValues({})
    }
  }

  async function save(pluginId: string) {
    const tab = tabs().find((t) => t.id === pluginId)
    if (!tab) return
    try {
      // validate each field sequentially
      for (const key of Object.keys(tab.schema)) {
        const value = values()[key]
        const res = await fetch(`/preferences/${pluginId}/validate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, value }),
        })
        const valid = await res.json()
        if (!valid || (valid.valid === false)) {
          showToast({ variant: "error", title: language.t("common.requestFailed"), description: valid.error ?? "Validation failed" })
          return
        }
      }

      // apply fields
      for (const key of Object.keys(tab.schema)) {
        const value = values()[key]
        await fetch(`/preferences/${pluginId}/apply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, value }),
        })
      }

      showToast({ variant: "success", title: language.t("common.saved") })
    } catch (err) {
      showToast({ variant: "error", title: language.t("common.requestFailed"), description: (err as Error).message })
    }
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 bg-surface-raised-base py-6">
        <h2 class="text-16-medium">{language.t("settings.plugins.title")}</h2>
      </div>

      <div class="flex gap-6 mt-4">
        <div class="w-56 bg-surface-raised-base p-3 rounded">
          <For each={tabs()}>
            {(t) => (
              <button class="w-full text-left p-2 rounded hover:bg-surface-selected" onClick={async () => { setSelected(t.id); await loadValues(t.id) }}>
                <div class="text-14-medium">{t.title}</div>
                <div class="text-12-regular text-text-weak">{t.ui?.group}</div>
              </button>
            )}
          </For>
        </div>

        <div class="flex-1 bg-surface-raised-base p-4 rounded">
          <Show when={selected()} fallback={<div class="text-14-regular text-text-weak">{language.t("settings.plugins.empty")}</div>}>
            <div>
              <For each={Object.entries((tabs().find((x) => x.id === selected())?.schema) ?? {})}>
                {([key, def]) => (
                  <div style={{ marginBottom: "12px" }}>
                    <label style={{ display: "block", fontWeight: 600 }}>{key}</label>
                    {def.type === "string" && (
                      <input value={values()?.[key] ?? ""} onInput={(e: any) => setValues({ ...values(), [key]: e.target.value })} />
                    )}
                    {def.type === "boolean" && (
                      <input type="checkbox" checked={!!values()?.[key]} onInput={(e: any) => setValues({ ...values(), [key]: e.target.checked })} />
                    )}
                    {def.type === "select" && (
                      <select value={values()?.[key] ?? ""} onChange={(e: any) => setValues({ ...values(), [key]: e.target.value })}>
                        <option value="">(select)</option>
                        <For each={def.options ?? []}>{(o: any) => <option value={o.value}>{o.label}</option>}</For>
                      </select>
                    )}
                    {def.description && <div class="text-12-regular text-text-weak">{def.description}</div>}
                  </div>
                )}
              </For>

              <div class="flex gap-3 mt-4">
                <Button variant="primary" onClick={() => save(selected()!)}>{language.t("common.save")}</Button>
              </div>
            </div>
          </Show>
        </div>
      </div>
    </div>
  )
}

export default SettingsPlugins
