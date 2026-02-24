import { For, Match, Show, Switch, createMemo, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { DockPrompt } from "@opencode-ai/ui/dock-prompt"
import { showToast } from "@opencode-ai/ui/toast"
import type { ElicitationRequest } from "@opencode-ai/sdk/v2"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"

type SchemaProperty = {
  type?: string
  title?: string
  description?: string
  default?: unknown
  enum?: string[]
  oneOf?: Array<{ const: string; title?: string; description?: string }>
  anyOf?: Array<{ const: string; title?: string; description?: string }>
  items?: { anyOf?: Array<{ const: string; title?: string; description?: string }> }
  pattern?: string
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
}

export const SessionElicitationDock: Component<{ request: ElicitationRequest; onSubmit: () => void }> = (props) => {
  const sdk = useSDK()
  const language = useLanguage()

  const [store, setStore] = createStore({
    values: {} as Record<string, unknown>,
    sending: false,
  })

  const properties = createMemo(() => {
    const schema = props.request.requestedSchema
    if (!schema?.properties) return []
    const props_ = schema.properties as Record<string, SchemaProperty>
    return Object.entries(props_).map(([key, prop]) => ({ key, ...prop }))
  })

  const initDefaults = () => {
    const defaults: Record<string, unknown> = {}
    for (const prop of properties()) {
      if (prop.default !== undefined) {
        defaults[prop.key] = prop.default
      }
    }
    if (Object.keys(defaults).length > 0) {
      setStore("values", defaults)
    }
  }
  initDefaults()

  const fail = (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    showToast({ title: language.t("common.requestFailed"), description: message })
  }

  const respond = async (action: "accept" | "decline" | "cancel") => {
    if (store.sending) return
    props.onSubmit()
    setStore("sending", true)
    try {
      if (action === "accept") {
        await sdk.client.elicitation.reply({
          requestID: props.request.id,
          elicitationReply: {
            action: "accept",
            content: store.values,
          },
        })
      } else {
        await sdk.client.elicitation.reject({ requestID: props.request.id })
      }
    } catch (err) {
      fail(err)
    } finally {
      setStore("sending", false)
    }
  }

  const setValue = (key: string, value: unknown) => {
    setStore("values", key, value)
  }

  const toggleArrayValue = (key: string, value: string) => {
    const current = (store.values[key] as string[] | undefined) ?? []
    if (current.includes(value)) {
      setValue(key, current.filter((v) => v !== value))
    } else {
      setValue(key, [...current, value])
    }
  }

  const getOptions = (prop: SchemaProperty & { key: string }): Array<{ const: string; title?: string; description?: string }> => {
    if (prop.oneOf) return prop.oneOf
    if (prop.enum) return prop.enum.map((v) => ({ const: v }))
    return []
  }

  const isMultiSelect = (prop: SchemaProperty & { key: string }): boolean => {
    return prop.type === "array" && !!prop.items?.anyOf
  }

  const getMultiOptions = (prop: SchemaProperty & { key: string }): Array<{ const: string; title?: string; description?: string }> => {
    return prop.items?.anyOf ?? []
  }

  return (
    <DockPrompt
      kind="question"
      header={
        <div data-slot="question-header-title">
          {props.request.mode === "url" ? "External Action" : "Elicitation"}
        </div>
      }
      footer={
        <>
          <Button variant="ghost" size="large" disabled={store.sending} onClick={() => respond("cancel")}>
            {language.t("ui.common.dismiss")}
          </Button>
          <div data-slot="question-footer-actions">
            <Button variant="secondary" size="large" disabled={store.sending} onClick={() => respond("decline")}>
              Decline
            </Button>
            <Button variant="primary" size="large" disabled={store.sending} onClick={() => respond("accept")}>
              {props.request.mode === "url" ? "Done" : language.t("ui.common.submit")}
            </Button>
          </div>
        </>
      }
    >
      <div data-slot="question-text">{props.request.message}</div>

      <Switch>
        <Match when={props.request.mode === "url"}>
          <div data-slot="question-options">
            <Show when={props.request.url}>
              {(url) => (
                <div class="flex flex-col gap-2">
                  <div class="text-xs text-text-weak break-all font-mono">{url()}</div>
                  <Button
                    variant="secondary"
                    size="large"
                    onClick={() => window.open(url(), "_blank", "noopener,noreferrer")}
                  >
                    Open in Browser
                  </Button>
                </div>
              )}
            </Show>
          </div>
        </Match>

        <Match when={props.request.mode === "form"}>
          <div data-slot="question-options">
            <For each={properties()}>
              {(prop) => (
                <Switch>
                  <Match when={isMultiSelect(prop)}>
                    <div class="flex flex-col gap-1">
                      <Show when={prop.title}>
                        <div class="text-sm font-medium">{prop.title}</div>
                      </Show>
                      <Show when={prop.description}>
                        <div class="text-xs text-text-weak">{prop.description}</div>
                      </Show>
                      <For each={getMultiOptions(prop)}>
                        {(opt) => {
                          const checked = () => ((store.values[prop.key] as string[] | undefined) ?? []).includes(opt.const)
                          return (
                            <button
                              data-slot="question-option"
                              data-picked={checked()}
                              role="checkbox"
                              aria-checked={checked()}
                              disabled={store.sending}
                              onClick={() => toggleArrayValue(prop.key, opt.const)}
                            >
                              <span data-slot="question-option-main">
                                <span data-slot="option-label">{opt.title ?? opt.const}</span>
                                <Show when={opt.description}>
                                  <span data-slot="option-description">{opt.description}</span>
                                </Show>
                              </span>
                            </button>
                          )
                        }}
                      </For>
                    </div>
                  </Match>

                  <Match when={getOptions(prop).length > 0}>
                    <div class="flex flex-col gap-1">
                      <Show when={prop.title}>
                        <div class="text-sm font-medium">{prop.title}</div>
                      </Show>
                      <Show when={prop.description}>
                        <div class="text-xs text-text-weak">{prop.description}</div>
                      </Show>
                      <For each={getOptions(prop)}>
                        {(opt) => {
                          const picked = () => store.values[prop.key] === opt.const
                          return (
                            <button
                              data-slot="question-option"
                              data-picked={picked()}
                              role="radio"
                              aria-checked={picked()}
                              disabled={store.sending}
                              onClick={() => setValue(prop.key, opt.const)}
                            >
                              <span data-slot="question-option-main">
                                <span data-slot="option-label">{opt.title ?? opt.const}</span>
                                <Show when={opt.description}>
                                  <span data-slot="option-description">{opt.description}</span>
                                </Show>
                              </span>
                            </button>
                          )
                        }}
                      </For>
                    </div>
                  </Match>

                  <Match when={prop.type === "boolean"}>
                    <div class="flex flex-col gap-1">
                      <Show when={prop.title}>
                        <div class="text-sm font-medium">{prop.title}</div>
                      </Show>
                      <button
                        data-slot="question-option"
                        data-picked={!!store.values[prop.key]}
                        role="checkbox"
                        aria-checked={!!store.values[prop.key]}
                        disabled={store.sending}
                        onClick={() => setValue(prop.key, !store.values[prop.key])}
                      >
                        <span data-slot="question-option-main">
                          <span data-slot="option-label">{prop.description ?? prop.title ?? prop.key}</span>
                        </span>
                      </button>
                    </div>
                  </Match>

                  <Match when={prop.type === "number" || prop.type === "integer"}>
                    <div class="flex flex-col gap-1">
                      <Show when={prop.title}>
                        <div class="text-sm font-medium">{prop.title}</div>
                      </Show>
                      <Show when={prop.description}>
                        <div class="text-xs text-text-weak">{prop.description}</div>
                      </Show>
                      <input
                        type="number"
                        class="w-full rounded-md border border-border-weak-base bg-background-base px-3 py-2 text-sm"
                        value={(store.values[prop.key] as number | undefined) ?? ""}
                        min={prop.minimum}
                        max={prop.maximum}
                        step={prop.type === "integer" ? 1 : undefined}
                        disabled={store.sending}
                        onInput={(e) => {
                          const v = prop.type === "integer" ? parseInt(e.currentTarget.value) : parseFloat(e.currentTarget.value)
                          setValue(prop.key, isNaN(v) ? undefined : v)
                        }}
                      />
                    </div>
                  </Match>

                  <Match when={prop.type === "string"}>
                    <div class="flex flex-col gap-1">
                      <Show when={prop.title}>
                        <div class="text-sm font-medium">{prop.title}</div>
                      </Show>
                      <Show when={prop.description}>
                        <div class="text-xs text-text-weak">{prop.description}</div>
                      </Show>
                      <input
                        type="text"
                        class="w-full rounded-md border border-border-weak-base bg-background-base px-3 py-2 text-sm"
                        value={(store.values[prop.key] as string | undefined) ?? ""}
                        minLength={prop.minLength}
                        maxLength={prop.maxLength}
                        pattern={prop.pattern}
                        disabled={store.sending}
                        onInput={(e) => setValue(prop.key, e.currentTarget.value)}
                      />
                    </div>
                  </Match>
                </Switch>
              )}
            </For>
          </div>
        </Match>
      </Switch>
    </DockPrompt>
  )
}
