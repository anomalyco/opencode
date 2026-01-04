import { InputRenderable, TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog, type DialogContext } from "../ui/dialog"
import { createStore } from "solid-js/store"
import { createEffect, For, Show, Switch, Match, createMemo, createSignal } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { Locale } from "@/util/locale"
import { useSDK } from "../context/sdk"
import type {
  IntentInfo,
  FormField,
  SelectOption,
  ConfirmIntent,
  SelectIntent,
  MultiSelectIntent,
  FormIntent,
} from "@/intent/types"

export type DialogIntentProps = {
  info: IntentInfo
  onComplete?: () => void
}

async function respondToIntent(
  baseUrl: string,
  sessionID: string,
  intentID: string,
  response: { type: "submit" | "cancel"; data?: Record<string, any> },
) {
  await fetch(`${baseUrl}/session/${sessionID}/intent/${intentID}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ response }),
  })
}

export function DialogIntent(props: DialogIntentProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const sdk = useSDK()

  const respond = async (response: { type: "submit" | "cancel"; data?: Record<string, any> }) => {
    await respondToIntent(sdk.url, props.info.sessionID, props.info.id, response)
    dialog.clear()
    props.onComplete?.()
  }

  const intent = props.info.intent

  return (
    <Switch>
      <Match when={intent.type === "confirm"}>
        <ConfirmDialog
          intent={intent as ConfirmIntent}
          onConfirm={() => respond({ type: "submit" })}
          onCancel={() => respond({ type: "cancel" })}
        />
      </Match>
      <Match when={intent.type === "select"}>
        <SelectDialog
          intent={intent as SelectIntent}
          onSelect={(value) => respond({ type: "submit", data: { selected: value } })}
          onCancel={() => respond({ type: "cancel" })}
        />
      </Match>
      <Match when={intent.type === "multiselect"}>
        <MultiSelectDialog
          intent={intent as MultiSelectIntent}
          onSubmit={(values) => respond({ type: "submit", data: { selected: values } })}
          onCancel={() => respond({ type: "cancel" })}
        />
      </Match>
      <Match when={intent.type === "form"}>
        <FormDialog
          intent={intent as FormIntent}
          onSubmit={(data) => respond({ type: "submit", data })}
          onCancel={() => respond({ type: "cancel" })}
        />
      </Match>
    </Switch>
  )
}

function ConfirmDialog(props: { intent: ConfirmIntent; onConfirm: () => void; onCancel: () => void }) {
  const { theme } = useTheme()
  const [store, setStore] = createStore({ active: "confirm" as "confirm" | "cancel" })

  useKeyboard((evt) => {
    if (evt.name === "return" && store.active === "confirm") {
      evt.preventDefault()
      props.onConfirm()
      return
    }
    if (evt.name === "return") {
      evt.preventDefault()
      props.onCancel()
      return
    }
    if (evt.name === "left" || evt.name === "right") {
      evt.preventDefault()
      setStore("active", store.active === "confirm" ? "cancel" : "confirm")
    }
    if (evt.name === "escape") {
      evt.preventDefault()
      props.onCancel()
    }
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {props.intent.title}
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>
      <box paddingBottom={1}>
        <text fg={theme.textMuted}>{props.intent.message}</text>
      </box>
      <box flexDirection="row" justifyContent="flex-end" paddingBottom={1}>
        <For each={["cancel", "confirm"]}>
          {(key) => (
            <box
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={key === store.active ? theme.primary : undefined}
              onMouseUp={() => (key === "confirm" ? props.onConfirm() : props.onCancel())}
            >
              <text fg={key === store.active ? theme.selectedListItemText : theme.textMuted}>
                {key === "confirm" ? props.intent.confirmLabel : props.intent.cancelLabel}
              </text>
            </box>
          )}
        </For>
      </box>
    </box>
  )
}

function SelectDialog(props: { intent: SelectIntent; onSelect: (value: string) => void; onCancel: () => void }) {
  const { theme } = useTheme()
  const [selected, setSelected] = createSignal(0)
  const options = props.intent.options

  useKeyboard((evt) => {
    if (evt.name === "up" || (evt.ctrl && evt.name === "p")) {
      evt.preventDefault()
      setSelected((s) => (s > 0 ? s - 1 : options.length - 1))
    }
    if (evt.name === "down" || (evt.ctrl && evt.name === "n")) {
      evt.preventDefault()
      setSelected((s) => (s < options.length - 1 ? s + 1 : 0))
    }
    if (evt.name === "return") {
      evt.preventDefault()
      const opt = options[selected()]
      if (opt) props.onSelect(opt.value)
    }
    if (evt.name === "escape") {
      evt.preventDefault()
      props.onCancel()
    }
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {props.intent.title}
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>
      <Show when={props.intent.description}>
        <text fg={theme.textMuted}>{props.intent.description}</text>
      </Show>
      <box paddingTop={1} paddingBottom={1}>
        <For each={options}>
          {(opt, index) => (
            <box
              flexDirection="row"
              paddingLeft={1}
              backgroundColor={index() === selected() ? theme.primary : undefined}
              onMouseUp={() => props.onSelect(opt.value)}
              onMouseOver={() => setSelected(index())}
            >
              <text fg={index() === selected() ? theme.selectedListItemText : theme.text}>{opt.label}</text>
              <Show when={opt.description}>
                <text fg={index() === selected() ? theme.selectedListItemText : theme.textMuted}>
                  {" "}
                  - {opt.description}
                </text>
              </Show>
            </box>
          )}
        </For>
      </box>
    </box>
  )
}

function MultiSelectDialog(props: {
  intent: MultiSelectIntent
  onSubmit: (values: string[]) => void
  onCancel: () => void
}) {
  const { theme } = useTheme()
  const [focused, setFocused] = createSignal(0)
  const [selectedValues, setSelectedValues] = createStore<Record<string, boolean>>({})
  const options = props.intent.options

  const getSelected = () =>
    Object.entries(selectedValues)
      .filter(([_, v]) => v)
      .map(([k]) => k)

  useKeyboard((evt) => {
    if (evt.name === "up" || (evt.ctrl && evt.name === "p")) {
      evt.preventDefault()
      setFocused((s) => (s > 0 ? s - 1 : options.length - 1))
    }
    if (evt.name === "down" || (evt.ctrl && evt.name === "n")) {
      evt.preventDefault()
      setFocused((s) => (s < options.length - 1 ? s + 1 : 0))
    }
    if (evt.name === "space") {
      evt.preventDefault()
      const opt = options[focused()]
      if (opt) {
        setSelectedValues(opt.value, !selectedValues[opt.value])
      }
    }
    if (evt.name === "return") {
      evt.preventDefault()
      props.onSubmit(getSelected())
    }
    if (evt.name === "escape") {
      evt.preventDefault()
      props.onCancel()
    }
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {props.intent.title}
        </text>
        <text fg={theme.textMuted}>esc / space to toggle / enter to submit</text>
      </box>
      <Show when={props.intent.description}>
        <text fg={theme.textMuted}>{props.intent.description}</text>
      </Show>
      <box paddingTop={1} paddingBottom={1}>
        <For each={options}>
          {(opt, index) => (
            <box
              flexDirection="row"
              paddingLeft={1}
              backgroundColor={index() === focused() ? theme.primary : undefined}
              onMouseUp={() => setSelectedValues(opt.value, !selectedValues[opt.value])}
              onMouseOver={() => setFocused(index())}
            >
              <text fg={index() === focused() ? theme.selectedListItemText : theme.text}>
                {selectedValues[opt.value] ? "[x] " : "[ ] "}
                {opt.label}
              </text>
              <Show when={opt.description}>
                <text fg={index() === focused() ? theme.selectedListItemText : theme.textMuted}>
                  {" "}
                  - {opt.description}
                </text>
              </Show>
            </box>
          )}
        </For>
      </box>
    </box>
  )
}

function FormDialog(props: {
  intent: FormIntent
  onSubmit: (data: Record<string, any>) => void
  onCancel: () => void
}) {
  const { theme } = useTheme()
  const [focusedField, setFocusedField] = createSignal(0)
  const [formData, setFormData] = createStore<Record<string, any>>({})
  const fields = props.intent.fields

  const visibleFields = createMemo(() => {
    return fields.filter((field) => {
      if (!("condition" in field) || !field.condition) return true
      const conditionField = field.condition.field
      const conditionValue = field.condition.equals
      const fieldValue = formData[conditionField]
      if (Array.isArray(fieldValue)) {
        return fieldValue.includes(conditionValue)
      }
      return fieldValue === conditionValue
    })
  })

  let prevVisibleCount = visibleFields().length
  createEffect(() => {
    const currentCount = visibleFields().length
    if (currentCount > prevVisibleCount) {
      setFocusedField(currentCount - 1)
    }
    prevVisibleCount = currentCount
  })

  useKeyboard((evt) => {
    if (evt.name === "up" || (evt.ctrl && evt.name === "p")) {
      evt.preventDefault()
      setFocusedField((s) => (s > 0 ? s - 1 : visibleFields().length - 1))
    }
    if (evt.name === "down" || (evt.ctrl && evt.name === "n")) {
      evt.preventDefault()
      setFocusedField((s) => (s < visibleFields().length - 1 ? s + 1 : 0))
    }
    if (evt.name === "escape") {
      evt.preventDefault()
      props.onCancel()
    }
    if (evt.name === "return") {
      evt.preventDefault()
      props.onSubmit(formData)
    }
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {props.intent.title}
        </text>
        <text fg={theme.textMuted}>esc / enter to submit</text>
      </box>
      <Show when={props.intent.description}>
        <text fg={theme.textMuted}>{props.intent.description}</text>
      </Show>
      <box paddingTop={1} paddingBottom={1}>
        <For each={visibleFields()}>
          {(field, index) => (
            <FormFieldRenderer
              field={field}
              focused={index() === focusedField()}
              value={formData[field.id]}
              onChange={(value) => setFormData(field.id, value)}
              onFocus={() => setFocusedField(index())}
            />
          )}
        </For>
      </box>
      <box flexDirection="row" justifyContent="flex-end" gap={1} paddingBottom={1}>
        <box paddingLeft={1} paddingRight={1} onMouseUp={() => props.onCancel()}>
          <text fg={theme.textMuted}>{props.intent.cancelLabel}</text>
        </box>
        <box
          paddingLeft={1}
          paddingRight={1}
          backgroundColor={theme.primary}
          onMouseUp={() => props.onSubmit(formData)}
        >
          <text fg={theme.selectedListItemText}>{props.intent.submitLabel}</text>
        </box>
      </box>
    </box>
  )
}

function FormFieldRenderer(props: {
  field: FormField
  focused: boolean
  value: any
  onChange: (value: any) => void
  onFocus: () => void
}) {
  const { theme } = useTheme()
  const [localValue, setLocalValue] = createSignal(props.value ?? props.field.default ?? "")
  let inputRef: InputRenderable | undefined

  createEffect(() => {
    if (props.focused && props.field.type === "text" && inputRef) {
      setTimeout(() => inputRef?.focus(), 1)
    }
  })

  return (
    <box paddingBottom={1}>
      <text fg={props.focused ? theme.primary : theme.text} attributes={TextAttributes.BOLD}>
        {props.field.label}
      </text>
      <Show when={props.field.description}>
        <text fg={theme.textMuted}>{props.field.description}</text>
      </Show>
      <Switch>
        <Match when={props.field.type === "text"}>
          <box paddingTop={1}>
            <input
              ref={(r: InputRenderable) => {
                inputRef = r
                if (props.focused) {
                  setTimeout(() => r.focus(), 1)
                }
              }}
              onInput={(value) => {
                setLocalValue(value)
                props.onChange(value)
              }}
              focusedBackgroundColor={theme.backgroundPanel}
              cursorColor={theme.primary}
              focusedTextColor={theme.text}
              placeholder={"placeholder" in props.field ? (props.field.placeholder ?? "") : "Type here..."}
            />
          </box>
        </Match>
        <Match when={props.field.type === "select"}>
          <SelectFieldRenderer
            field={props.field as { type: "select"; options: SelectOption[]; default?: string }}
            value={props.value}
            onChange={props.onChange}
            focused={props.focused}
          />
        </Match>
        <Match when={props.field.type === "multiselect"}>
          <MultiSelectFieldRenderer
            field={props.field as { type: "multiselect"; options: SelectOption[]; default?: string[] }}
            value={props.value ?? []}
            onChange={props.onChange}
            focused={props.focused}
          />
        </Match>
        <Match when={props.field.type === "confirm"}>
          <box flexDirection="row" onMouseUp={() => props.onChange(!props.value)}>
            <text fg={props.focused ? theme.primary : theme.text}>{props.value ? "[x] Yes" : "[ ] No"}</text>
          </box>
        </Match>
      </Switch>
    </box>
  )
}

function SelectFieldRenderer(props: {
  field: { type: "select"; options: SelectOption[]; default?: string }
  value: string | undefined
  onChange: (value: string) => void
  focused: boolean
}) {
  const { theme } = useTheme()
  const [selectedIndex, setSelectedIndex] = createSignal(
    props.field.options.findIndex((o) => o.value === (props.value ?? props.field.default)) || 0,
  )

  useKeyboard((evt) => {
    if (!props.focused) return
    if (evt.name === "up" || (evt.ctrl && evt.name === "p")) {
      evt.preventDefault()
      const newIndex = selectedIndex() > 0 ? selectedIndex() - 1 : props.field.options.length - 1
      setSelectedIndex(newIndex)
      props.onChange(props.field.options[newIndex].value)
    }
    if (evt.name === "down" || (evt.ctrl && evt.name === "n")) {
      evt.preventDefault()
      const newIndex = selectedIndex() < props.field.options.length - 1 ? selectedIndex() + 1 : 0
      setSelectedIndex(newIndex)
      props.onChange(props.field.options[newIndex].value)
    }
  })

  return (
    <box flexDirection="column">
      <For each={props.field.options}>
        {(opt, index) => (
          <box
            flexDirection="row"
            paddingLeft={1}
            backgroundColor={index() === selectedIndex() ? theme.primary : undefined}
            onMouseUp={() => {
              setSelectedIndex(index())
              props.onChange(opt.value)
            }}
            onMouseOver={() => setSelectedIndex(index())}
          >
            <text fg={index() === selectedIndex() ? theme.selectedListItemText : theme.text}>{opt.label}</text>
            <Show when={opt.description}>
              <text fg={index() === selectedIndex() ? theme.selectedListItemText : theme.textMuted}>
                {" "}
                - {opt.description}
              </text>
            </Show>
          </box>
        )}
      </For>
    </box>
  )
}

function MultiSelectFieldRenderer(props: {
  field: { type: "multiselect"; options: SelectOption[]; default?: string[] }
  value: string[]
  onChange: (value: string[]) => void
  focused: boolean
}) {
  const { theme } = useTheme()
  const [focusedIndex, setFocusedIndex] = createSignal(0)
  const isSelected = (value: string) => props.value.includes(value)

  const toggle = (value: string) => {
    if (isSelected(value)) {
      props.onChange(props.value.filter((v) => v !== value))
      return
    }
    props.onChange([...props.value, value])
  }

  useKeyboard((evt) => {
    if (!props.focused) return
    if (evt.name === "up" || (evt.ctrl && evt.name === "p")) {
      evt.preventDefault()
      setFocusedIndex((s) => (s > 0 ? s - 1 : props.field.options.length - 1))
    }
    if (evt.name === "down" || (evt.ctrl && evt.name === "n")) {
      evt.preventDefault()
      setFocusedIndex((s) => (s < props.field.options.length - 1 ? s + 1 : 0))
    }
    if (evt.name === "space") {
      evt.preventDefault()
      const opt = props.field.options[focusedIndex()]
      if (opt) toggle(opt.value)
    }
  })

  return (
    <box flexDirection="column">
      <For each={props.field.options}>
        {(opt, index) => (
          <box
            flexDirection="row"
            paddingLeft={1}
            backgroundColor={index() === focusedIndex() ? theme.primary : undefined}
            onMouseUp={() => toggle(opt.value)}
            onMouseOver={() => setFocusedIndex(index())}
          >
            <text fg={index() === focusedIndex() ? theme.selectedListItemText : theme.text}>
              {isSelected(opt.value) ? "[x] " : "[ ] "}
              {opt.label}
            </text>
            <Show when={opt.description}>
              <text fg={index() === focusedIndex() ? theme.selectedListItemText : theme.textMuted}>
                {" "}
                - {opt.description}
              </text>
            </Show>
          </box>
        )}
      </For>
    </box>
  )
}

DialogIntent.show = (dialog: DialogContext, info: IntentInfo) => {
  return new Promise<void>((resolve) => {
    dialog.replace(
      () => <DialogIntent info={info} onComplete={resolve} />,
      () => resolve(),
    )
  })
}
