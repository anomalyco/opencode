import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog, type DialogContext } from "../ui/dialog"
import { createStore } from "solid-js/store"
import { For, Show, Switch, Match, createMemo, createSignal } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { Locale } from "@/util/locale"
import { useSDK } from "../context/sdk"
import type { IntentInfo, FormField, SelectOption } from "@/intent/types"

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

  return (
    <Switch>
      <Match when={props.info.intent.type === "confirm"}>
        <ConfirmDialog
          info={props.info}
          onConfirm={() => respond({ type: "submit" })}
          onCancel={() => respond({ type: "cancel" })}
        />
      </Match>
      <Match when={props.info.intent.type === "select"}>
        <SelectDialog
          info={props.info}
          onSelect={(value) => respond({ type: "submit", data: { selected: value } })}
          onCancel={() => respond({ type: "cancel" })}
        />
      </Match>
      <Match when={props.info.intent.type === "multiselect"}>
        <MultiSelectDialog
          info={props.info}
          onSubmit={(values) => respond({ type: "submit", data: { selected: values } })}
          onCancel={() => respond({ type: "cancel" })}
        />
      </Match>
      <Match when={props.info.intent.type === "form"}>
        <FormDialog
          info={props.info}
          onSubmit={(data) => respond({ type: "submit", data })}
          onCancel={() => respond({ type: "cancel" })}
        />
      </Match>
    </Switch>
  )
}

function ConfirmDialog(props: { info: IntentInfo; onConfirm: () => void; onCancel: () => void }) {
  const { theme } = useTheme()
  const dialog = useDialog()
  const [store, setStore] = createStore({ active: "confirm" as "confirm" | "cancel" })

  const intent = () => props.info.intent as { type: "confirm"; title: string; message: string; confirmLabel?: string; cancelLabel?: string; variant?: string }

  useKeyboard((evt) => {
    if (evt.name === "return") {
      if (store.active === "confirm") props.onConfirm()
      else props.onCancel()
    }
    if (evt.name === "left" || evt.name === "right") {
      setStore("active", store.active === "confirm" ? "cancel" : "confirm")
    }
    if (evt.name === "escape") {
      props.onCancel()
    }
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {intent().title}
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>
      <box paddingBottom={1}>
        <text fg={theme.textMuted}>{intent().message}</text>
      </box>
      <box flexDirection="row" justifyContent="flex-end" paddingBottom={1}>
        <For each={["cancel", "confirm"]}>
          {(key) => (
            <box
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={key === store.active ? theme.primary : undefined}
              onMouseUp={() => {
                if (key === "confirm") props.onConfirm()
                else props.onCancel()
              }}
            >
              <text fg={key === store.active ? theme.selectedListItemText : theme.textMuted}>
                {key === "confirm" ? (intent().confirmLabel || "Yes") : (intent().cancelLabel || "No")}
              </text>
            </box>
          )}
        </For>
      </box>
    </box>
  )
}

function SelectDialog(props: { info: IntentInfo; onSelect: (value: string) => void; onCancel: () => void }) {
  const { theme } = useTheme()
  const [selected, setSelected] = createSignal(0)

  const intent = () => props.info.intent as { type: "select"; title: string; description?: string; options: SelectOption[]; default?: string }
  const options = () => intent().options

  useKeyboard((evt) => {
    if (evt.name === "up" || (evt.ctrl && evt.name === "p")) {
      setSelected((s) => (s > 0 ? s - 1 : options().length - 1))
    }
    if (evt.name === "down" || (evt.ctrl && evt.name === "n")) {
      setSelected((s) => (s < options().length - 1 ? s + 1 : 0))
    }
    if (evt.name === "return") {
      const opt = options()[selected()]
      if (opt) props.onSelect(opt.value)
    }
    if (evt.name === "escape") {
      props.onCancel()
    }
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {intent().title}
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>
      <Show when={intent().description}>
        <text fg={theme.textMuted}>{intent().description}</text>
      </Show>
      <box paddingTop={1} paddingBottom={1}>
        <For each={options()}>
          {(opt, index) => (
            <box
              flexDirection="row"
              paddingLeft={1}
              backgroundColor={index() === selected() ? theme.primary : undefined}
              onMouseUp={() => props.onSelect(opt.value)}
              onMouseOver={() => setSelected(index())}
            >
              <text fg={index() === selected() ? theme.selectedListItemText : theme.text}>
                {opt.label}
              </text>
              <Show when={opt.description}>
                <text fg={index() === selected() ? theme.selectedListItemText : theme.textMuted}>
                  {" "}- {opt.description}
                </text>
              </Show>
            </box>
          )}
        </For>
      </box>
    </box>
  )
}

function MultiSelectDialog(props: { info: IntentInfo; onSubmit: (values: string[]) => void; onCancel: () => void }) {
  const { theme } = useTheme()
  const [focused, setFocused] = createSignal(0)
  const [selectedValues, setSelectedValues] = createStore<Record<string, boolean>>({})

  const intent = () => props.info.intent as { type: "multiselect"; title: string; description?: string; options: SelectOption[]; default?: string[]; min?: number; max?: number }
  const options = () => intent().options

  const getSelected = () => Object.entries(selectedValues).filter(([_, v]) => v).map(([k]) => k)

  useKeyboard((evt) => {
    if (evt.name === "up" || (evt.ctrl && evt.name === "p")) {
      setFocused((s) => (s > 0 ? s - 1 : options().length - 1))
    }
    if (evt.name === "down" || (evt.ctrl && evt.name === "n")) {
      setFocused((s) => (s < options().length - 1 ? s + 1 : 0))
    }
    if (evt.name === "space") {
      const opt = options()[focused()]
      if (opt) {
        setSelectedValues(opt.value, !selectedValues[opt.value])
      }
    }
    if (evt.name === "return") {
      props.onSubmit(getSelected())
    }
    if (evt.name === "escape") {
      props.onCancel()
    }
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {intent().title}
        </text>
        <text fg={theme.textMuted}>esc / space to toggle / enter to submit</text>
      </box>
      <Show when={intent().description}>
        <text fg={theme.textMuted}>{intent().description}</text>
      </Show>
      <box paddingTop={1} paddingBottom={1}>
        <For each={options()}>
          {(opt, index) => (
            <box
              flexDirection="row"
              paddingLeft={1}
              backgroundColor={index() === focused() ? theme.primary : undefined}
              onMouseUp={() => setSelectedValues(opt.value, !selectedValues[opt.value])}
              onMouseOver={() => setFocused(index())}
            >
              <text fg={index() === focused() ? theme.selectedListItemText : theme.text}>
                {selectedValues[opt.value] ? "[x] " : "[ ] "}{opt.label}
              </text>
              <Show when={opt.description}>
                <text fg={index() === focused() ? theme.selectedListItemText : theme.textMuted}>
                  {" "}- {opt.description}
                </text>
              </Show>
            </box>
          )}
        </For>
      </box>
    </box>
  )
}

function FormDialog(props: { info: IntentInfo; onSubmit: (data: Record<string, any>) => void; onCancel: () => void }) {
  const { theme } = useTheme()
  const [focusedField, setFocusedField] = createSignal(0)
  const [formData, setFormData] = createStore<Record<string, any>>({})

  const intent = () => props.info.intent as { type: "form"; title: string; description?: string; fields: FormField[]; submitLabel?: string; cancelLabel?: string }
  const fields = () => intent().fields
  const visibleFields = createMemo(() => {
    return fields().filter((field) => {
      if (!("condition" in field) || !field.condition) return true
      const conditionField = field.condition.field
      const conditionValue = field.condition.equals
      return formData[conditionField] === conditionValue
    })
  })

  useKeyboard((evt) => {
    if (evt.name === "up" || (evt.ctrl && evt.name === "p")) {
      setFocusedField((s) => (s > 0 ? s - 1 : visibleFields().length - 1))
    }
    if (evt.name === "down" || (evt.ctrl && evt.name === "n")) {
      setFocusedField((s) => (s < visibleFields().length - 1 ? s + 1 : 0))
    }
    if (evt.name === "escape") {
      props.onCancel()
    }
    if (evt.ctrl && evt.name === "return") {
      props.onSubmit(formData)
    }
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {intent().title}
        </text>
        <text fg={theme.textMuted}>esc / ctrl+enter to submit</text>
      </box>
      <Show when={intent().description}>
        <text fg={theme.textMuted}>{intent().description}</text>
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
          <text fg={theme.textMuted}>{intent().cancelLabel || "Cancel"}</text>
        </box>
        <box paddingLeft={1} paddingRight={1} backgroundColor={theme.primary} onMouseUp={() => props.onSubmit(formData)}>
          <text fg={theme.selectedListItemText}>{intent().submitLabel || "Submit"}</text>
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
          <input
            onInput={(value) => {
              setLocalValue(value)
              props.onChange(value)
            }}
            focusedBackgroundColor={theme.backgroundPanel}
            cursorColor={theme.primary}
            focusedTextColor={theme.text}
            placeholder={(props.field as any).placeholder ?? ""}
          />
        </Match>
        <Match when={props.field.type === "select"}>
          <SelectFieldRenderer
            field={props.field as any}
            value={props.value}
            onChange={props.onChange}
            focused={props.focused}
          />
        </Match>
        <Match when={props.field.type === "multiselect"}>
          <MultiSelectFieldRenderer
            field={props.field as any}
            value={props.value ?? []}
            onChange={props.onChange}
            focused={props.focused}
          />
        </Match>
        <Match when={props.field.type === "confirm"}>
          <box
            flexDirection="row"
            onMouseUp={() => props.onChange(!props.value)}
          >
            <text fg={props.focused ? theme.primary : theme.text}>
              {props.value ? "[x] Yes" : "[ ] No"}
            </text>
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
    props.field.options.findIndex((o) => o.value === (props.value ?? props.field.default)) || 0
  )

  useKeyboard((evt) => {
    if (!props.focused) return
    if (evt.name === "left") {
      setSelectedIndex((s) => (s > 0 ? s - 1 : props.field.options.length - 1))
      props.onChange(props.field.options[selectedIndex()].value)
    }
    if (evt.name === "right") {
      setSelectedIndex((s) => (s < props.field.options.length - 1 ? s + 1 : 0))
      props.onChange(props.field.options[selectedIndex()].value)
    }
  })

  return (
    <box flexDirection="row" gap={1}>
      <For each={props.field.options}>
        {(opt, index) => (
          <box
            paddingLeft={1}
            paddingRight={1}
            backgroundColor={index() === selectedIndex() ? theme.primary : undefined}
            onMouseUp={() => {
              setSelectedIndex(index())
              props.onChange(opt.value)
            }}
          >
            <text fg={index() === selectedIndex() ? theme.selectedListItemText : theme.text}>
              {opt.label}
            </text>
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
  const isSelected = (value: string) => props.value.includes(value)

  const toggle = (value: string) => {
    if (isSelected(value)) {
      props.onChange(props.value.filter((v) => v !== value))
    } else {
      props.onChange([...props.value, value])
    }
  }

  return (
    <box flexDirection="row" gap={1}>
      <For each={props.field.options}>
        {(opt) => (
          <box
            paddingLeft={1}
            paddingRight={1}
            backgroundColor={isSelected(opt.value) ? theme.primary : undefined}
            onMouseUp={() => toggle(opt.value)}
          >
            <text fg={isSelected(opt.value) ? theme.selectedListItemText : theme.text}>
              {isSelected(opt.value) ? "x " : "  "}{opt.label}
            </text>
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
