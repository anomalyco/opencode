import { createStore } from "solid-js/store"
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import type { TextareaRenderable } from "@opentui/core"
import { useKeybind } from "../../context/keybind"
import { selectedForeground, tint, useTheme } from "../../context/theme"
import type { ElicitationRequest } from "@opencode-ai/sdk/v2"
import { useSDK } from "../../context/sdk"
import { SplitBorder } from "../../component/border"
import { useTextareaKeybindings } from "../../component/textarea-keybindings"
import { useDialog } from "../../ui/dialog"

type SchemaProperty = {
  type?: string
  title?: string
  description?: string
  default?: unknown
  enum?: string[]
  oneOf?: Array<{ const: string; title?: string; description?: string }>
  anyOf?: Array<{ const: string; title?: string; description?: string }>
  items?: { anyOf?: Array<{ const: string; title?: string; description?: string }> }
  minimum?: number
  maximum?: number
}

type Field = SchemaProperty & { key: string }

function getOptions(prop: Field): Array<{ const: string; title?: string; description?: string }> {
  if (prop.oneOf) return prop.oneOf
  if (prop.enum) return prop.enum.map((v) => ({ const: v }))
  return []
}

function isMultiSelect(prop: Field): boolean {
  return prop.type === "array" && !!prop.items?.anyOf
}

function getMultiOptions(prop: Field): Array<{ const: string; title?: string; description?: string }> {
  return prop.items?.anyOf ?? []
}

export function ElicitationPrompt(props: { request: ElicitationRequest }) {
  const sdk = useSDK()
  const { theme } = useTheme()
  const keybind = useKeybind()
  const bindings = useTextareaKeybindings()
  const dialog = useDialog()

  const fields = createMemo((): Field[] => {
    if (props.request.mode !== "form") return []
    const schema = props.request.requestedSchema
    if (!schema?.properties) return []
    const p = schema.properties as Record<string, SchemaProperty>
    return Object.entries(p).map(([key, prop]) => ({ key, ...prop }))
  })

  const isSingleSelect = createMemo(() => {
    if (props.request.mode === "url") return false
    const f = fields()
    if (f.length !== 1) return false
    const opts = getOptions(f[0])
    return opts.length > 0 && !isMultiSelect(f[0])
  })

  const [store, setStore] = createStore({
    selected: 0,
    values: {} as Record<string, unknown>,
    editingField: null as string | null,
  })

  let textarea: TextareaRenderable | undefined

  // init defaults
  for (const f of fields()) {
    if (f.default !== undefined) {
      setStore("values", f.key, f.default)
    }
  }

  const allItems = createMemo((): Array<{ type: "option"; field: Field; option: { const: string; title?: string; description?: string }; index: number } | { type: "field"; field: Field; index: number } | { type: "action"; action: "accept" | "cancel"; index: number }> => {
    if (props.request.mode === "url") {
      return [
        { type: "action" as const, action: "accept" as const, index: 0 },
        { type: "action" as const, action: "cancel" as const, index: 1 },
      ]
    }

    const items: Array<{ type: "option"; field: Field; option: { const: string; title?: string; description?: string }; index: number } | { type: "field"; field: Field; index: number } | { type: "action"; action: "accept" | "cancel"; index: number }> = []
    let idx = 0
    for (const f of fields()) {
      const opts = getOptions(f)
      if (opts.length > 0 && !isMultiSelect(f)) {
        for (const opt of opts) {
          items.push({ type: "option", field: f, option: opt, index: idx++ })
        }
      } else if (isMultiSelect(f)) {
        const multiOpts = getMultiOptions(f)
        for (const opt of multiOpts) {
          items.push({ type: "option", field: f, option: opt, index: idx++ })
        }
      } else {
        items.push({ type: "field", field: f, index: idx++ })
      }
    }

    if (!isSingleSelect()) {
      items.push({ type: "action", action: "accept", index: idx++ })
      items.push({ type: "action", action: "cancel", index: idx++ })
    }

    return items
  })

  function accept() {
    sdk.client.elicitation.reply({
      requestID: props.request.id,
      elicitationReply: {
        action: "accept",
        content: store.values,
      },
    })
  }

  function reject() {
    sdk.client.elicitation.reject({
      requestID: props.request.id,
    })
  }

  function selectCurrent() {
    const item = allItems()[store.selected]
    if (!item) return

    if (item.type === "action") {
      if (item.action === "accept") accept()
      else reject()
      return
    }

    if (item.type === "option") {
      if (isMultiSelect(item.field)) {
        const current = (store.values[item.field.key] as string[] | undefined) ?? []
        if (current.includes(item.option.const)) {
          setStore("values", item.field.key, current.filter((v) => v !== item.option.const))
        } else {
          setStore("values", item.field.key, [...current, item.option.const])
        }
        return
      }
      setStore("values", item.field.key, item.option.const)
      if (isSingleSelect()) {
        accept()
      }
      return
    }

    if (item.type === "field") {
      setStore("editingField", item.field.key)
      return
    }
  }

  useKeyboard((evt) => {
    if (dialog.stack.length > 0) return

    if (store.editingField) {
      if (evt.name === "escape") {
        evt.preventDefault()
        setStore("editingField", null)
        return
      }
      if (keybind.match("input_clear", evt)) {
        evt.preventDefault()
        const text = textarea?.plainText ?? ""
        if (!text) {
          setStore("editingField", null)
          return
        }
        textarea?.setText("")
        return
      }
      if (evt.name === "return") {
        evt.preventDefault()
        const text = textarea?.plainText?.trim() ?? ""
        const field = store.editingField
        if (field) {
          const f = fields().find((x) => x.key === field)
          if (f && (f.type === "number" || f.type === "integer")) {
            const v = f.type === "integer" ? parseInt(text) : parseFloat(text)
            setStore("values", field, isNaN(v) ? undefined : v)
          } else if (f?.type === "boolean") {
            setStore("values", field, text.toLowerCase() === "true" || text === "1")
          } else {
            setStore("values", field, text)
          }
        }
        setStore("editingField", null)
        return
      }
      return
    }

    const total = allItems().length
    if (total === 0) return

    if (evt.name === "up" || evt.name === "k") {
      evt.preventDefault()
      setStore("selected", (store.selected - 1 + total) % total)
    }

    if (evt.name === "down" || evt.name === "j") {
      evt.preventDefault()
      setStore("selected", (store.selected + 1) % total)
    }

    const digit = Number(evt.name)
    if (!Number.isNaN(digit) && digit >= 1 && digit <= Math.min(total, 9)) {
      evt.preventDefault()
      setStore("selected", digit - 1)
      selectCurrent()
      return
    }

    if (evt.name === "return") {
      evt.preventDefault()
      selectCurrent()
    }

    if (evt.name === "escape" || keybind.match("app_exit", evt)) {
      evt.preventDefault()
      reject()
    }
  })

  return (
    <box
      backgroundColor={theme.backgroundPanel}
      border={["left"]}
      borderColor={theme.accent}
      customBorderChars={SplitBorder.customBorderChars}
    >
      <box gap={1} paddingLeft={1} paddingRight={3} paddingTop={1} paddingBottom={1}>
        <box paddingLeft={1}>
          <text fg={theme.textMuted}>
            {props.request.mode === "url" ? "External Action" : "Elicitation"}
          </text>
        </box>
        <box paddingLeft={1}>
          <text fg={theme.text}>{props.request.message}</text>
        </box>

        <Switch>
          <Match when={props.request.mode === "url"}>
            <box paddingLeft={1} gap={1}>
              <Show when={props.request.url}>
                <text fg={theme.secondary}>{props.request.url}</text>
              </Show>
              <box>
                <For each={allItems()}>
                  {(item) => {
                    if (item.type !== "action") return null
                    const active = () => item.index === store.selected
                    return (
                      <box
                        onMouseOver={() => setStore("selected", item.index)}
                        onMouseUp={() => selectCurrent()}
                      >
                        <box flexDirection="row">
                          <box backgroundColor={active() ? theme.backgroundElement : undefined} paddingRight={1}>
                            <text fg={active() ? tint(theme.textMuted, theme.secondary, 0.6) : theme.textMuted}>
                              {`${item.index + 1}.`}
                            </text>
                          </box>
                          <box backgroundColor={active() ? theme.backgroundElement : undefined}>
                            <text fg={active() ? theme.secondary : theme.text}>
                              {item.action === "accept" ? "Done" : "Cancel"}
                            </text>
                          </box>
                        </box>
                      </box>
                    )
                  }}
                </For>
              </box>
            </box>
          </Match>

          <Match when={props.request.mode === "form"}>
            <box paddingLeft={1} gap={1}>
              <For each={fields()}>
                {(field) => {
                  const opts = getOptions(field)
                  const multi = isMultiSelect(field)
                  const multiOpts = getMultiOptions(field)

                  return (
                    <box gap={0}>
                      <Show when={field.title && (!isSingleSelect() || fields().length > 1)}>
                        <text fg={theme.text}>{field.title}</text>
                      </Show>
                      <Show when={field.description}>
                        <text fg={theme.textMuted}>{field.description}</text>
                      </Show>

                      <Switch>
                        <Match when={multi}>
                          <For each={multiOpts}>
                            {(opt) => {
                              const item = () => allItems().find(
                                (i) => i.type === "option" && i.field.key === field.key && i.option.const === opt.const,
                              )
                              const active = () => item()?.index === store.selected
                              const checked = () => ((store.values[field.key] as string[] | undefined) ?? []).includes(opt.const)
                              return (
                                <box
                                  onMouseOver={() => item() && setStore("selected", item()!.index)}
                                  onMouseUp={() => {
                                    if (item()) {
                                      setStore("selected", item()!.index)
                                      selectCurrent()
                                    }
                                  }}
                                >
                                  <box flexDirection="row">
                                    <box backgroundColor={active() ? theme.backgroundElement : undefined} paddingRight={1}>
                                      <text fg={active() ? tint(theme.textMuted, theme.secondary, 0.6) : theme.textMuted}>
                                        {`${(item()?.index ?? 0) + 1}.`}
                                      </text>
                                    </box>
                                    <box backgroundColor={active() ? theme.backgroundElement : undefined}>
                                      <text fg={active() ? theme.secondary : checked() ? theme.success : theme.text}>
                                        {`[${checked() ? "\u2713" : " "}] ${opt.title ?? opt.const}`}
                                      </text>
                                    </box>
                                  </box>
                                </box>
                              )
                            }}
                          </For>
                        </Match>

                        <Match when={opts.length > 0}>
                          <For each={opts}>
                            {(opt) => {
                              const item = () => allItems().find(
                                (i) => i.type === "option" && i.field.key === field.key && i.option.const === opt.const,
                              )
                              const active = () => item()?.index === store.selected
                              const picked = () => store.values[field.key] === opt.const
                              return (
                                <box
                                  onMouseOver={() => item() && setStore("selected", item()!.index)}
                                  onMouseUp={() => {
                                    if (item()) {
                                      setStore("selected", item()!.index)
                                      selectCurrent()
                                    }
                                  }}
                                >
                                  <box flexDirection="row">
                                    <box backgroundColor={active() ? theme.backgroundElement : undefined} paddingRight={1}>
                                      <text fg={active() ? tint(theme.textMuted, theme.secondary, 0.6) : theme.textMuted}>
                                        {`${(item()?.index ?? 0) + 1}.`}
                                      </text>
                                    </box>
                                    <box backgroundColor={active() ? theme.backgroundElement : undefined}>
                                      <text fg={active() ? theme.secondary : picked() ? theme.success : theme.text}>
                                        {opt.title ?? opt.const}
                                      </text>
                                    </box>
                                    <Show when={!isSingleSelect()}>
                                      <text fg={theme.success}>{picked() ? "\u2713" : ""}</text>
                                    </Show>
                                  </box>
                                  <Show when={opt.description}>
                                    <box paddingLeft={3}>
                                      <text fg={theme.textMuted}>{opt.description}</text>
                                    </box>
                                  </Show>
                                </box>
                              )
                            }}
                          </For>
                        </Match>

                        <Match when={field.type === "boolean"}>
                          {(() => {
                            const item = () => allItems().find((i) => i.type === "field" && i.field.key === field.key)
                            const active = () => item()?.index === store.selected
                            const val = () => !!store.values[field.key]
                            return (
                              <box
                                onMouseOver={() => item() && setStore("selected", item()!.index)}
                                onMouseUp={() => {
                                  setStore("values", field.key, !store.values[field.key])
                                }}
                              >
                                <box flexDirection="row">
                                  <box backgroundColor={active() ? theme.backgroundElement : undefined} paddingRight={1}>
                                    <text fg={active() ? tint(theme.textMuted, theme.secondary, 0.6) : theme.textMuted}>
                                      {`${(item()?.index ?? 0) + 1}.`}
                                    </text>
                                  </box>
                                  <box backgroundColor={active() ? theme.backgroundElement : undefined}>
                                    <text fg={active() ? theme.secondary : theme.text}>
                                      {`[${val() ? "\u2713" : " "}] ${field.title ?? field.key}`}
                                    </text>
                                  </box>
                                </box>
                              </box>
                            )
                          })()}
                        </Match>

                        <Match when={field.type === "string" || field.type === "number" || field.type === "integer"}>
                          {(() => {
                            const item = () => allItems().find((i) => i.type === "field" && i.field.key === field.key)
                            const active = () => item()?.index === store.selected
                            const val = () => store.values[field.key]
                            return (
                              <box
                                onMouseOver={() => item() && setStore("selected", item()!.index)}
                                onMouseUp={() => {
                                  if (item()) {
                                    setStore("selected", item()!.index)
                                    selectCurrent()
                                  }
                                }}
                              >
                                <box flexDirection="row">
                                  <box backgroundColor={active() ? theme.backgroundElement : undefined} paddingRight={1}>
                                    <text fg={active() ? tint(theme.textMuted, theme.secondary, 0.6) : theme.textMuted}>
                                      {`${(item()?.index ?? 0) + 1}.`}
                                    </text>
                                  </box>
                                  <box backgroundColor={active() ? theme.backgroundElement : undefined}>
                                    <text fg={active() ? theme.secondary : theme.text}>
                                      {val() !== undefined ? String(val()) : `(enter ${field.type ?? "text"})`}
                                    </text>
                                  </box>
                                </box>
                                <Show when={store.editingField === field.key}>
                                  <box paddingLeft={3}>
                                    <textarea
                                      ref={(val: TextareaRenderable) => {
                                        textarea = val
                                        queueMicrotask(() => {
                                          val.focus()
                                          val.gotoLineEnd()
                                        })
                                      }}
                                      initialValue={store.values[field.key] !== undefined ? String(store.values[field.key]) : ""}
                                      placeholder={field.description ?? `Enter ${field.type ?? "value"}`}
                                      minHeight={1}
                                      maxHeight={6}
                                      textColor={theme.text}
                                      focusedTextColor={theme.text}
                                      cursorColor={theme.primary}
                                      keyBindings={bindings()}
                                    />
                                  </box>
                                </Show>
                              </box>
                            )
                          })()}
                        </Match>
                      </Switch>
                    </box>
                  )
                }}
              </For>

              <Show when={!isSingleSelect()}>
                <box>
                  <For each={allItems()}>
                    {(item) => {
                      if (item.type !== "action") return null
                      const active = () => item.index === store.selected
                      return (
                        <box
                          onMouseOver={() => setStore("selected", item.index)}
                          onMouseUp={() => {
                            setStore("selected", item.index)
                            selectCurrent()
                          }}
                        >
                          <box flexDirection="row">
                            <box backgroundColor={active() ? theme.backgroundElement : undefined} paddingRight={1}>
                              <text fg={active() ? tint(theme.textMuted, theme.secondary, 0.6) : theme.textMuted}>
                                {`${item.index + 1}.`}
                              </text>
                            </box>
                            <box backgroundColor={active() ? theme.backgroundElement : undefined}>
                              <text fg={active() ? theme.secondary : item.action === "accept" ? theme.success : theme.text}>
                                {item.action === "accept" ? "Submit" : "Cancel"}
                              </text>
                            </box>
                          </box>
                        </box>
                      )
                    }}
                  </For>
                </box>
              </Show>
            </box>
          </Match>
        </Switch>
      </box>
      <box
        flexDirection="row"
        flexShrink={0}
        gap={1}
        paddingLeft={2}
        paddingRight={3}
        paddingBottom={1}
        justifyContent="space-between"
      >
        <box flexDirection="row" gap={2}>
          <text fg={theme.text}>
            {"↑↓"} <span style={{ fg: theme.textMuted }}>select</span>
          </text>
          <text fg={theme.text}>
            enter{" "}
            <span style={{ fg: theme.textMuted }}>
              {props.request.mode === "url" ? "confirm" : isSingleSelect() ? "submit" : "select"}
            </span>
          </text>
          <text fg={theme.text}>
            esc <span style={{ fg: theme.textMuted }}>dismiss</span>
          </text>
        </box>
      </box>
    </box>
  )
}
