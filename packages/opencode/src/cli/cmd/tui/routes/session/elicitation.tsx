import { createStore } from "solid-js/store"
import { createMemo, For, onMount, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import type { TextareaRenderable } from "@opentui/core"
import { useKeybind } from "../../context/keybind"
import { useTheme } from "../../context/theme"
import type { Elicitation } from "@/mcp/elicitation"
import { SplitBorder } from "../../component/border"
import { useTextareaKeybindings } from "../../component/textarea-keybindings"
import { useDialog } from "../../ui/dialog"
import { useSDK } from "../../context/sdk"
import { schemaToFields } from "./elicitation-schema"
export { schemaToFields, type FormField, type FieldType } from "./elicitation-schema"

export function ElicitationPrompt(props: { request: Elicitation.Request }) {
  const sdk = useSDK()
  const { theme } = useTheme()
  const keybind = useKeybind()
  const bindings = useTextareaKeybindings()
  const dialog = useDialog()

  const fields = createMemo(() => schemaToFields(props.request.requestedSchema))

  const [store, setStore] = createStore({
    selectedField: 0,
    values: {} as Record<string, string | number | boolean | string[]>,
    editing: false,
    selectedOption: 0, // For enum/multiselect navigation
    validationError: null as string | null,
  })

  let textarea: TextareaRenderable | undefined

  const currentField = createMemo(() => fields()[store.selectedField])

  // Initialize default values
  const initDefaults = () => {
    const defaults: Record<string, string | number | boolean | string[]> = {}
    for (const field of fields()) {
      if (field.default !== undefined) {
        defaults[field.key] = field.default
      } else if (field.type === "boolean") {
        defaults[field.key] = false
      } else if (field.type === "multiselect") {
        defaults[field.key] = []
      }
    }
    setStore("values", defaults)
  }

  // Initialize on mount
  onMount(() => {
    if (fields().length > 0) {
      initDefaults()
    }
  })

  async function submit() {
    // Clear previous validation error
    setStore("validationError", null)

    // Validate required fields
    for (const field of fields()) {
      if (field.required) {
        const value = store.values[field.key]
        if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) {
          setStore("validationError", `Required field "${field.title}" is missing`)
          setStore("selectedField", fields().indexOf(field))
          return
        }
      }
    }

    await sdk.client.mcp.elicitation.reply({
      id: props.request.id,
      content: store.values,
    })
  }

  async function reject(action: "decline" | "cancel" = "cancel") {
    await sdk.client.mcp.elicitation.reject({
      id: props.request.id,
      action,
    })
  }

  function setValue(key: string, value: string | number | boolean | string[]) {
    setStore("values", { ...store.values, [key]: value })
  }

  function toggleMultiSelect(key: string, option: string) {
    const current = (store.values[key] as string[]) ?? []
    const index = current.indexOf(option)
    if (index === -1) {
      setValue(key, [...current, option])
    } else {
      setValue(
        key,
        current.filter((v) => v !== option),
      )
    }
  }

  useKeyboard((evt) => {
    if (dialog.stack.length > 0) return

    // Submit shortcut - check BEFORE field check so it always works
    if (evt.name === "s" && evt.ctrl) {
      evt.preventDefault()
      submit()
      return
    }

    const field = currentField()
    if (!field) return

    // When editing a text field
    if (store.editing) {
      if (evt.name === "escape") {
        evt.preventDefault()
        setStore("editing", false)
        return
      }
      if (evt.name === "return") {
        evt.preventDefault()
        const text = textarea?.plainText?.trim() ?? ""
        setValue(field.key, field.type === "number" ? parseFloat(text) || 0 : text)
        setStore("editing", false)
        // Move to next field
        if (store.selectedField < fields().length - 1) {
          setStore("selectedField", store.selectedField + 1)
        }
        return
      }
      return
    }

    // Navigation
    if (evt.name === "up" || evt.name === "k") {
      evt.preventDefault()
      if (field.type === "enum" || field.type === "multiselect") {
        const opts = field.options ?? []
        setStore("selectedOption", (store.selectedOption - 1 + opts.length) % opts.length)
      } else {
        setStore("selectedField", Math.max(0, store.selectedField - 1))
        setStore("selectedOption", 0)
      }
    }

    if (evt.name === "down" || evt.name === "j") {
      evt.preventDefault()
      if (field.type === "enum" || field.type === "multiselect") {
        const opts = field.options ?? []
        setStore("selectedOption", (store.selectedOption + 1) % opts.length)
      } else {
        setStore("selectedField", Math.min(fields().length - 1, store.selectedField + 1))
        setStore("selectedOption", 0)
      }
    }

    if (evt.name === "tab") {
      evt.preventDefault()
      setStore("selectedField", (store.selectedField + 1) % fields().length)
      setStore("selectedOption", 0)
    }

    // Submit with Ctrl+Enter (check this BEFORE plain return)
    if (evt.name === "return" && evt.ctrl) {
      evt.preventDefault()
      submit()
      return
    }

    // Actions (plain return without ctrl)
    if (evt.name === "return") {
      evt.preventDefault()
      if (field.type === "string" || field.type === "number") {
        setStore("editing", true)
      } else if (field.type === "boolean") {
        setValue(field.key, !store.values[field.key])
      } else if (field.type === "enum") {
        const opt = field.options?.[store.selectedOption]
        if (opt) {
          setValue(field.key, opt.value)
          // Move to next field
          if (store.selectedField < fields().length - 1) {
            setStore("selectedField", store.selectedField + 1)
            setStore("selectedOption", 0)
          }
        }
      } else if (field.type === "multiselect") {
        const opt = field.options?.[store.selectedOption]
        if (opt) {
          toggleMultiSelect(field.key, opt.value)
        }
      }
    }

    // Cancel/Decline
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
        {/* Header */}
        <box paddingLeft={1}>
          <text fg={theme.accent}>MCP Elicitation</text>
          <text fg={theme.textMuted}> from {props.request.serverName}</text>
        </box>

        {/* Message */}
        <box paddingLeft={1}>
          <text fg={theme.text}>{props.request.message}</text>
        </box>

        {/* Validation Error */}
        <Show when={store.validationError}>
          <box paddingLeft={1}>
            <text fg={theme.error}>{store.validationError}</text>
          </box>
        </Show>

        {/* Form Fields */}
        <Show when={fields().length > 0}>
          <box paddingLeft={1} paddingTop={1} gap={1}>
            <For each={fields()}>
              {(field, index) => {
                const isActive = () => index() === store.selectedField
                const value = () => store.values[field.key]

                return (
                  <box>
                    {/* Field label */}
                    <box flexDirection="row" gap={1}>
                      <text fg={isActive() ? theme.accent : theme.text}>
                        {field.title}
                        {field.required ? " *" : ""}
                      </text>
                      <Show when={field.description}>
                        <text fg={theme.textMuted}>- {field.description}</text>
                      </Show>
                    </box>

                    {/* String/Number input */}
                    <Show when={field.type === "string" || field.type === "number"}>
                      <box paddingLeft={2}>
                        <Show when={isActive() && store.editing}>
                          <textarea
                            ref={(val: TextareaRenderable) => (textarea = val)}
                            focused
                            initialValue={String(value() ?? "")}
                            placeholder={`Enter ${field.title.toLowerCase()}`}
                            textColor={theme.text}
                            focusedTextColor={theme.text}
                            cursorColor={theme.primary}
                            keyBindings={bindings()}
                          />
                        </Show>
                        <Show when={!store.editing || !isActive()}>
                          <box
                            backgroundColor={isActive() ? theme.backgroundElement : undefined}
                            paddingLeft={1}
                            paddingRight={1}
                          >
                            <text fg={value() ? theme.text : theme.textMuted}>
                              {value() ? String(value()) : "(press Enter to edit)"}
                            </text>
                          </box>
                        </Show>
                      </box>
                    </Show>

                    {/* Boolean toggle */}
                    <Show when={field.type === "boolean"}>
                      <box paddingLeft={2} flexDirection="row" gap={1}>
                        <box
                          backgroundColor={isActive() ? theme.backgroundElement : undefined}
                          paddingLeft={1}
                          paddingRight={1}
                        >
                          <text fg={value() ? theme.success : theme.textMuted}>{value() ? "[x] Yes" : "[ ] No"}</text>
                        </box>
                      </box>
                    </Show>

                    {/* Enum single-select */}
                    <Show when={field.type === "enum"}>
                      <box paddingLeft={2}>
                        <For each={field.options}>
                          {(opt, optIndex) => {
                            const isSelected = () => value() === opt.value
                            const isHighlighted = () => isActive() && optIndex() === store.selectedOption
                            return (
                              <box
                                flexDirection="row"
                                gap={1}
                                backgroundColor={isHighlighted() ? theme.backgroundElement : undefined}
                              >
                                <text fg={isSelected() ? theme.success : theme.text}>
                                  {isSelected() ? "(*)" : "( )"} {opt.label}
                                </text>
                              </box>
                            )
                          }}
                        </For>
                      </box>
                    </Show>

                    {/* Multi-select */}
                    <Show when={field.type === "multiselect"}>
                      <box paddingLeft={2}>
                        <For each={field.options}>
                          {(opt, optIndex) => {
                            const isSelected = () => ((value() as string[]) ?? []).includes(opt.value)
                            const isHighlighted = () => isActive() && optIndex() === store.selectedOption
                            return (
                              <box
                                flexDirection="row"
                                gap={1}
                                backgroundColor={isHighlighted() ? theme.backgroundElement : undefined}
                              >
                                <text fg={isSelected() ? theme.success : theme.text}>
                                  {isSelected() ? "[x]" : "[ ]"} {opt.label}
                                </text>
                              </box>
                            )
                          }}
                        </For>
                      </box>
                    </Show>
                  </box>
                )
              }}
            </For>
          </box>
        </Show>
      </box>

      {/* Footer with keybindings */}
      <box
        flexDirection="row"
        flexShrink={0}
        gap={2}
        paddingLeft={2}
        paddingRight={3}
        paddingBottom={1}
        justifyContent="space-between"
      >
        <box flexDirection="row" gap={2}>
          <text fg={theme.text}>
            {"↑↓"} <span style={{ fg: theme.textMuted }}>navigate</span>
          </text>
          <text fg={theme.text}>
            tab <span style={{ fg: theme.textMuted }}>next field</span>
          </text>
          <text fg={theme.text}>
            enter <span style={{ fg: theme.textMuted }}>edit/select</span>
          </text>
          <text fg={theme.text}>
            ctrl+s <span style={{ fg: theme.textMuted }}>submit</span>
          </text>
          <text fg={theme.text}>
            esc <span style={{ fg: theme.textMuted }}>cancel</span>
          </text>
        </box>
      </box>
    </box>
  )
}
