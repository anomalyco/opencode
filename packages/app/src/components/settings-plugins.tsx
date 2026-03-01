import { Component, For, Show, createResource, createMemo, createSignal, type JSX } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { Switch } from "@opencode-ai/ui/switch"
import { Select } from "@opencode-ai/ui/select"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"

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

type PluginSettingsSchema = {
  id: string
  title: string
  properties: Record<string, SettingDefinition>
}

type PluginSettingsResponse = {
  schemas: PluginSettingsSchema[]
  values: Record<string, Record<string, unknown>>
}

const SettingsRow: Component<{
  title: string | JSX.Element
  description?: string | JSX.Element
  htmlFor?: string
  children: JSX.Element
}> = (props) => (
  <div class="flex flex-wrap items-center justify-between gap-4 py-3 border-b border-border-weak-base last:border-none">
    <div class="flex flex-col gap-0.5 min-w-0">
      <Show when={props.htmlFor} fallback={<span class="text-14-medium text-text-strong">{props.title}</span>}>
        <label for={props.htmlFor} class="text-14-medium text-text-strong cursor-pointer">{props.title}</label>
      </Show>
      <Show when={props.description}>
        <span class="text-12-regular text-text-weak">{props.description}</span>
      </Show>
    </div>
    <div class="flex-shrink-0">{props.children}</div>
  </div>
)

async function fetchPluginSettings(url: string, client?: any): Promise<PluginSettingsResponse> {
  if (client?.config?.["plugin-settings"]?.$get) {
    try {
      const res = await client.config["plugin-settings"].$get()
      if (res.ok) {
        return await res.json()
      }
    } catch (err) {
      // fallback
    }
  }
  const res = await fetch(url + "/config/plugin-settings")
  if (!res.ok) throw new Error("Failed to fetch plugin settings")
  return res.json()
}

async function savePluginSettings(url: string, pluginId: string, settings: Record<string, unknown>, client?: any) {
  if (client?.config?.["plugin-settings"]?.$patch) {
    try {
      const res = await client.config["plugin-settings"].$patch({ json: { plugin_id: pluginId, settings } })
      if (res.ok) {
        return await res.json()
      }
    } catch (err) {
      // fallback
    }
  }
  const res = await fetch(url + "/config/plugin-settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plugin_id: pluginId, settings }),
  })
  if (!res.ok) throw new Error("Failed to save plugin settings")
  return res.json()
}

const PluginCard: Component<{
  schema: PluginSettingsSchema
  values: Record<string, unknown>
  url: string
  client?: any
  refetch: () => void
  error?: string | null
  onError?: (error: string) => void
  onClearError?: () => void
}> = (props) => {
  const language = useLanguage()
  const [state, setState] = createStore({
    values: { ...props.values },
    dirty: false,
    saving: false,
    touched: new Set<string>(),
  })

  const handleSave = async () => {
    setState("saving", true)
    props.onClearError?.()
    try {
      const payload: Record<string, unknown> = {}
      for (const [key, def] of Object.entries(props.schema.properties)) {
        if (def.type === "secret") {
          if (state.touched.has(key)) {
            payload[key] = state.values[key]
          }
        } else {
          payload[key] = state.values[key]
        }
      }

      await savePluginSettings(props.url, props.schema.id, payload, props.client)

      setState("dirty", false)
      setState("touched", new Set<string>())
      props.refetch()

      showToast({
        title: language.t("settings.plugins.saved.title"),
        description: language.t("settings.plugins.saved.description", { plugin: props.schema.title }),
        variant: "success",
        icon: "circle-check",
      })
    } catch (error) {
      console.error("Save failed:", error)
      props.onError?.(error instanceof Error ? error.message : "Failed to save settings")
      showToast({
        title: language.t("settings.plugins.save_failed.title"),
        description: language.t("settings.plugins.save_failed.description", { plugin: props.schema.title }),
        variant: "error",
      })
    } finally {
      setState("saving", false)
    }
  }

  return (
    <div class="flex flex-col gap-1">
      <h3 class="text-14-medium text-text-strong pb-2">{props.schema.title}</h3>
      <Show when={props.error}>
        <p class="text-12-medium text-text-danger pb-2">{props.error}</p>
      </Show>
      <div class="bg-surface-raised-base px-4 rounded-lg">
        <For each={Object.entries(props.schema.properties)}>
          {([key, def]) => {
            const value = createMemo(() => state.values[key])
            const inputId = `plugin-${props.schema.id}-${key}`

            return (
              <SettingsRow title={def.title} description={def.description} htmlFor={inputId}>
                <Show when={def.type === "string"}>
                  <TextField
                    id={inputId}
                    value={(value() as string) ?? ""}
                    onInput={(e) => {
                      setState("values", key, e.currentTarget.value)
                      setState("dirty", true)
                      setState(produce((s) => s.touched.add(key)))
                    }}
                    placeholder={def.placeholder}
                    size="small"
                  />
                </Show>
                <Show when={def.type === "secret"}>
                  <TextField
                    id={inputId}
                    type="password"
                    value={state.touched.has(key) ? ((value() as string) ?? "") : ""}
                    onInput={(e) => {
                      setState("values", key, e.currentTarget.value)
                      setState("dirty", true)
                      setState(produce((s) => s.touched.add(key)))
                    }}
                    placeholder={def.placeholder ?? "••••••••"}
                    size="small"
                  />
                </Show>
                <Show when={def.type === "number"}>
                  <TextField
                    id={inputId}
                    type="number"
                    value={value() !== undefined ? String(value()) : ""}
                    onInput={(e) => {
                      const val = e.currentTarget.value
                      if (val === "") {
                        setState("values", key, undefined)
                      } else {
                        const num = Number(val)
                        if (!isNaN(num)) {
                          setState("values", key, num)
                        } else {
                          return
                        }
                      }
                      setState("dirty", true)
                      setState(produce((s) => s.touched.add(key)))
                    }}
                    size="small"
                  />
                </Show>
                <Show when={def.type === "boolean"}>
                  <div data-action={`settings-plugin-${props.schema.id}-${key}`}>
                    <Switch
                      id={inputId}
                      checked={!!value()}
                      onChange={(checked) => {
                        setState("values", key, checked)
                        setState("dirty", true)
                        setState(produce((s) => s.touched.add(key)))
                      }}
                    />
                  </div>
                </Show>
                <Show when={def.type === "select"}>
                  <Select
                    id={inputId}
                    options={(def.enum ?? []).map((val, idx) => ({
                      value: val,
                      label: def.enumLabels?.[idx] ?? val,
                    }))}
                    current={
                      (def.enum ?? []).includes(value() as string)
                        ? {
                            value: value() as string,
                            label: def.enumLabels?.[def.enum!.indexOf(value() as string)] ?? (value() as string),
                          }
                        : undefined
                    }
                    value={(o) => o.value}
                    label={(o) => o.label}
                    onSelect={(option) => {
                      if (option) {
                        setState("values", key, option.value)
                        setState("dirty", true)
                        setState(produce((s) => s.touched.add(key)))
                      }
                    }}
                    variant="secondary"
                    size="small"
                    triggerVariant="settings"
                  />
                </Show>
              </SettingsRow>
            )
          }}
        </For>
        <div class="flex justify-end py-3 border-t border-border-weak-base">
          <Button size="small" disabled={!state.dirty || state.saving} onClick={handleSave}>
            {state.saving ? "..." : language.t("settings.plugins.save")}
          </Button>
        </div>
      </div>
    </div>
  )
}

export const SettingsPlugins: Component = () => {
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const [errors, setErrors] = createSignal<Record<string, string | null>>({})

  const [data, { refetch }] = createResource(() => fetchPluginSettings(globalSDK.url, globalSDK.client))

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8 max-w-[720px]">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.plugins.title")}</h2>
          <p class="text-12-regular text-text-weak">{language.t("settings.plugins.description")}</p>
        </div>
      </div>

      <div class="flex flex-col gap-8 max-w-[720px]">
        <Show when={data.loading}>
          <p class="text-12-regular text-text-weak">{language.t("settings.plugins.loading")}</p>
        </Show>
        <Show when={data.error}>
          <p class="text-12-regular text-text-weak">{language.t("settings.plugins.error")}</p>
        </Show>
        <Show when={data()}>
          {(resolved) => (
            <Show
              when={Array.isArray(resolved()?.schemas) && resolved()!.schemas.length > 0}
              fallback={<p class="text-12-regular text-text-weak">{language.t("settings.plugins.empty")}</p>}
            >
              <For each={resolved()!.schemas}>
                {(schema) => {
                  if (
                    !schema ||
                    typeof schema !== "object" ||
                    typeof schema.id !== "string" ||
                    typeof schema.title !== "string" ||
                    typeof schema.properties !== "object" ||
                    schema.properties === null
                  ) {
                    return null
                  }

                  return (
                    <PluginCard
                      schema={schema}
                      values={resolved()?.values?.[schema.id] ?? {}}
                      url={globalSDK.url}
                      client={globalSDK.client}
                      refetch={refetch}
                      error={errors()[schema.id]}
                      onError={(err) => setErrors((prev) => ({ ...prev, [schema.id]: err }))}
                      onClearError={() => setErrors((prev) => ({ ...prev, [schema.id]: null }))}
                    />
                  )
                }}
              </For>
            </Show>
          )}
        </Show>
      </div>
    </div>
  )
}
