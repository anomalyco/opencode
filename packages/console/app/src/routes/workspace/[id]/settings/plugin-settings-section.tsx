import { createSignal, createResource, For, Show, Switch, Match } from "solid-js"
import styles from "./plugin-settings-section.module.css"

type SettingDefinition = {
  type: "string" | "number" | "boolean" | "select" | "secret"
  title: string
  description?: string
  default?: unknown
  required?: boolean
  placeholder?: string
  enum?: string[]
  enumLabels?: string[]
}

type PluginSchema = {
  id: string
  title: string
  properties: Record<string, SettingDefinition>
}

type PluginSettingsData = {
  schemas: PluginSchema[]
  values: Record<string, Record<string, unknown>>
}

async function fetchSettings(): Promise<PluginSettingsData> {
  const res = await fetch("/config/plugin-settings")
  if (!res.ok) throw new Error("Failed to fetch plugin settings")
  return res.json()
}

export function PluginSettingsSection() {
  const [data, { refetch }] = createResource(fetchSettings)
  const [saving, setSaving] = createSignal<string | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [draft, setDraft] = createSignal<Record<string, Record<string, unknown>>>({})

  function val(pluginId: string, key: string) {
    const local = draft()[pluginId]
    if (local && key in local) return local[key]
    return data()?.values[pluginId]?.[key]
  }

  function update(pluginId: string, key: string, v: unknown) {
    setDraft((prev: Record<string, Record<string, unknown>>) => ({
      ...prev,
      [pluginId]: { ...(prev[pluginId] ?? {}), [key]: v },
    }))
  }

  function dirty(pluginId: string) {
    const d = draft()[pluginId]
    return !!d && Object.keys(d).length > 0
  }

  async function save(pluginId: string) {
    setSaving(pluginId)
    setError(null)
    try {
      const current = data()?.values[pluginId] ?? {}
      const merged = { ...current, ...draft()[pluginId] }
      const res = await fetch("/config/plugin-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plugin_id: pluginId, settings: merged }),
      })
      if (!res.ok) throw new Error("Failed to save")
      setDraft((prev: Record<string, Record<string, unknown>>) => {
        const next = { ...prev }
        delete next[pluginId]
        return next
      })
      await refetch()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed")
    } finally {
      setSaving(null)
    }
  }

  return (
    <section class={styles.root}>
      <div data-slot="section-title">
        <h2>Plugin Settings</h2>
        <p>Configure settings for installed plugins.</p>
      </div>
      <div data-slot="section-content">
        <Show when={data.loading}>
          <p data-slot="status">Loading plugin settings…</p>
        </Show>
        <Show when={data.error}>
          <p data-slot="status" data-color="danger">
            Failed to load plugin settings. Make sure the OpenCode server is running.
          </p>
        </Show>
        <Show when={data() && !data()!.schemas.length && !data.loading}>
          <p data-slot="status">No plugins with configurable settings found.</p>
        </Show>
        <For each={data()?.schemas ?? []}>
          {(schema: PluginSchema) => (
            <div data-slot="plugin-card">
              <h3>{schema.title}</h3>
              <div data-slot="plugin-fields">
                <For each={Object.entries(schema.properties)}>
                  {([key, def]: [string, SettingDefinition]) => (
                    <div data-slot="setting-field">
                      <label>
                        <span data-slot="field-title">{def.title}</span>
                        <Show when={def.description}>
                          <span data-slot="field-description">{def.description}</span>
                        </Show>
                      </label>
                      <Switch>
                        <Match when={def.type === "boolean"}>
                          <label data-slot="toggle">
                            <input
                              type="checkbox"
                              checked={(val(schema.id, key) as boolean) ?? (def.default as boolean) ?? false}
                              onChange={(e: Event & { target: HTMLInputElement }) => update(schema.id, key, e.target.checked)}
                            />
                            <span data-slot="toggle-track">
                              <span data-slot="toggle-thumb" />
                            </span>
                          </label>
                        </Match>
                        <Match when={def.type === "select"}>
                          <select
                            data-component="input"
                            value={(val(schema.id, key) as string) ?? (def.default as string) ?? ""}
                            onChange={(e: Event & { target: HTMLSelectElement }) => update(schema.id, key, e.target.value)}
                          >
                            <For each={def.enum ?? []}>
                              {(opt: string, i: () => number) => <option value={opt}>{def.enumLabels?.[i()] ?? opt}</option>}
                            </For>
                          </select>
                        </Match>
                        <Match when={def.type === "secret"}>
                          <input
                            data-component="input"
                            type="password"
                            placeholder={def.placeholder ?? ""}
                            value={(val(schema.id, key) as string) ?? ""}
                            onInput={(e: Event & { target: HTMLInputElement }) => update(schema.id, key, e.target.value)}
                          />
                        </Match>
                        <Match when={def.type === "number"}>
                          <input
                            data-component="input"
                            type="number"
                            placeholder={def.placeholder ?? ""}
                            value={String((val(schema.id, key) as number) ?? (def.default as number) ?? "")}
                            onInput={(e: Event & { target: HTMLInputElement }) => update(schema.id, key, Number(e.target.value))}
                          />
                        </Match>
                        <Match when={def.type === "string"}>
                          <input
                            data-component="input"
                            type="text"
                            placeholder={def.placeholder ?? ""}
                            value={(val(schema.id, key) as string) ?? (def.default as string) ?? ""}
                            onInput={(e: Event & { target: HTMLInputElement }) => update(schema.id, key, e.target.value)}
                          />
                        </Match>
                      </Switch>
                    </div>
                  )}
                </For>
              </div>
              <div data-slot="plugin-actions">
                <button
                  data-color="primary"
                  disabled={saving() === schema.id || !dirty(schema.id)}
                  onClick={() => save(schema.id)}
                >
                  {saving() === schema.id ? "Saving…" : "Save"}
                </button>
              </div>
              <Show when={error()}>
                <div data-slot="form-error">{error()}</div>
              </Show>
            </div>
          )}
        </For>
      </div>
    </section>
  )
}
