import { createStore } from "solid-js/store"
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import type { ScrollBoxRenderable, TextareaRenderable } from "@opentui/core"
import open from "open"
import { selectedForeground, tint, useTheme } from "../../context/theme"
import type { FormFormInfo, FormValue } from "@opencode-ai/sdk/v2"
import type { FormInfo } from "../../context/data"
import { useSDK } from "../../context/sdk"
import { SplitBorder } from "../../ui/border"
import { useTuiConfig } from "../../config"
import { useBindings, useOpencodeModeStack } from "../../keymap"

const FORM_MODE = "form"

type Field = FormFormInfo["fields"][number]

function fieldLabel(field: Field) {
  return field.title ?? field.key
}

function truncate(label: string, max: number) {
  return label.length > max ? label.slice(0, max - 1).trimEnd() + "…" : label
}

function validateText(field: Field, text: string): string | undefined {
  if (field.type !== "string") return
  if (field.minLength !== undefined && text.length < field.minLength)
    return `Must be at least ${field.minLength} characters`
  if (field.maxLength !== undefined && text.length > field.maxLength)
    return `Must be at most ${field.maxLength} characters`
  if (field.pattern !== undefined) {
    try {
      if (!new RegExp(field.pattern).test(text)) return `Must match pattern: ${field.pattern}`
    } catch {
      return `Invalid pattern: ${field.pattern}`
    }
  }
  if (field.format === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return "Expected an email address"
  if (field.format === "uri") {
    try {
      new URL(text)
    } catch {
      return "Expected a URL"
    }
  }
  if (field.format === "date") {
    const date = new Date(`${text}T00:00:00.000Z`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text)
      return "Expected a date (YYYY-MM-DD)"
  }
  if (field.format === "date-time" && Number.isNaN(new Date(text).getTime())) return "Expected a date and time"
}

function validateSelection(field: Field, value: FormValue | undefined) {
  if (field.type !== "multiselect" || value === undefined) return
  if (!Array.isArray(value)) return "Expected selections"
  if (field.required && value.length === 0) return "Select at least one option"
  if (field.minItems !== undefined && value.length < field.minItems) return `Select at least ${field.minItems}`
  if (field.maxItems !== undefined && value.length > field.maxItems) return `Select at most ${field.maxItems}`
}

function validateValue(field: Field, value: FormValue | undefined) {
  if (value === undefined) return field.required ? "Answer required" : undefined
  if (field.required && (value === "" || (Array.isArray(value) && value.length === 0))) {
    return field.type === "multiselect" ? "Select at least one option" : "Answer required"
  }
  if (field.type === "string") {
    if (typeof value !== "string") return "Expected text"
    const invalid = validateText(field, value)
    if (invalid) return invalid
    if (field.options && !field.custom && !field.options.some((option) => option.value === value)) {
      return "Select an available option"
    }
    return
  }
  if (field.type === "number" || field.type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value)) return "Expected a number"
    if (field.type === "integer" && !Number.isInteger(value)) return "Expected an integer"
    if (typeof field.minimum === "number" && value < field.minimum) return `Must be at least ${field.minimum}`
    if (typeof field.maximum === "number" && value > field.maximum) return `Must be at most ${field.maximum}`
    return
  }
  if (field.type === "boolean") return typeof value === "boolean" ? undefined : "Expected yes or no"
  const invalid = validateSelection(field, value)
  if (invalid) return invalid
  if (
    Array.isArray(value) &&
    !field.custom &&
    value.some((item) => !field.options.some((option) => option.value === item))
  ) {
    return "Select only available options"
  }
}

function fieldRows(field: Field): { value: FormValue; label: string; description?: string }[] {
  if (field.type === "boolean")
    return [
      { value: true, label: "Yes" },
      { value: false, label: "No" },
    ]
  if (field.type === "multiselect" || (field.type === "string" && field.options))
    return (field.options ?? []).map((option) => ({
      value: option.value,
      label: option.label,
      description: option.description,
    }))
  return []
}

function selectedRow(field: Field | undefined, value: FormValue | undefined) {
  if (!field || value === undefined || Array.isArray(value)) return 0
  const rows = fieldRows(field)
  const index = rows.findIndex((row) => row.value === value)
  if (index !== -1) return index
  if (typeof value === "string" && field.type === "string" && field.options && field.custom) return rows.length
  return 0
}

function customDefault(field: Field) {
  if (field.type !== "string" || !field.options || !field.custom || typeof field.default !== "string") return
  if (!field.options.some((option) => option.value === field.default)) return field.default
}

function display(field: Field, value: FormValue | undefined) {
  if (value === undefined) return ""
  const label = (item: string | number | boolean) =>
    fieldRows(field).find((row) => row.value === item)?.label ?? String(item)
  if (Array.isArray(value)) return value.length === 0 ? "(none)" : value.map(label).join(", ")
  return label(value)
}

function requestOptions(form: FormInfo) {
  if (form.sessionID !== "global" || !form.location) return undefined
  return {
    headers: {
      "x-opencode-directory": encodeURIComponent(form.location.directory),
      ...(form.location.workspaceID ? { "x-opencode-workspace": form.location.workspaceID } : {}),
    },
  }
}

export function FormPrompt(props: { form: FormInfo }) {
  return props.form.mode === "url" ? <UrlPrompt form={props.form} /> : <FieldsPrompt form={props.form} />
}

function UrlPrompt(props: { form: FormInfo & { mode: "url" } }) {
  const sdk = useSDK()
  const { theme } = useTheme()
  const modeStack = useOpencodeModeStack()
  const message = createMemo(() => {
    const value = props.form.metadata?.["message"]
    return typeof value === "string" ? value : undefined
  })

  onMount(() => onCleanup(modeStack.push(FORM_MODE)))

  useBindings(() => ({
    mode: FORM_MODE,
    enabled: true,
    commands: [
      {
        name: "app.exit",
        title: "Dismiss form",
        category: "Form",
        run() {
          void sdk.api.form.cancel(
            { sessionID: props.form.sessionID, formID: props.form.id },
            requestOptions(props.form),
          )
        },
      },
    ],
    bindings: [
      {
        key: "return",
        desc: "Open link",
        group: "Form",
        cmd: () => {
          void open(props.form.url)
        },
      },
      {
        key: "escape",
        desc: "Dismiss form",
        group: "Form",
        cmd: () => {
          void sdk.api.form.cancel(
            { sessionID: props.form.sessionID, formID: props.form.id },
            requestOptions(props.form),
          )
        },
      },
    ],
  }))

  return (
    <box
      backgroundColor={theme.backgroundPanel}
      border={["left"]}
      borderColor={theme.accent}
      customBorderChars={SplitBorder.customBorderChars}
    >
      <box gap={1} paddingLeft={2} paddingRight={3} paddingTop={1} paddingBottom={1}>
        <text fg={theme.text}>{props.form.title}</text>
        <Show when={message()}>
          <text fg={theme.textMuted}>{message()}</text>
        </Show>
        <text fg={theme.secondary}>{props.form.url}</text>
      </box>
      <box flexDirection="row" flexShrink={0} gap={2} paddingLeft={2} paddingRight={3} paddingBottom={1}>
        <text fg={theme.text}>
          enter <span style={{ fg: theme.textMuted }}>open link</span>
        </text>
        <text fg={theme.text}>
          esc <span style={{ fg: theme.textMuted }}>dismiss</span>
        </text>
      </box>
    </box>
  )
}

function FieldsPrompt(props: { form: FormInfo & { mode: "form" } }) {
  const sdk = useSDK()
  const { theme } = useTheme()
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const tuiConfig = useTuiConfig()
  const modeStack = useOpencodeModeStack()

  const [tabHover, setTabHover] = createSignal<number | "confirm" | null>(null)
  const [store, setStore] = createStore({
    tab: 0,
    answers: Object.fromEntries(
      props.form.fields.flatMap((field) => (field.default === undefined ? [] : [[field.key, field.default]])),
    ) as Record<string, FormValue | undefined>,
    custom: Object.fromEntries(
      props.form.fields.flatMap((field) => {
        const value = customDefault(field)
        return value === undefined ? [] : [[field.key, value]]
      }),
    ) as Record<string, string>,
    selected: selectedRow(props.form.fields[0], props.form.fields[0]?.default),
    editing: false,
    error: "",
  })

  let textarea: TextareaRenderable | undefined
  let review: ScrollBoxRenderable | undefined

  const fields = createMemo(() => {
    const answers: Record<string, FormValue | undefined> = {}
    return props.form.fields.filter((field) => {
      const active = (field.when ?? []).every((when) => {
        const value = answers[when.key]
        if (value === undefined) return false
        const hit = Array.isArray(value) ? value.some((item) => item === when.value) : value === when.value
        return when.op === "eq" ? hit : !hit
      })
      if (active) answers[field.key] = store.answers[field.key]
      return active
    })
  })
  const single = createMemo(() => {
    const list = fields()
    if (props.form.fields.length !== 1) return false
    if (list.length !== 1) return false
    const field = list[0]!
    return field.type === "boolean" || (field.type === "string" && field.options !== undefined)
  })
  const tabs = createMemo(() => (single() ? 1 : fields().length + 1))
  const tabbed = createMemo(() => {
    const width = fields().reduce((sum, item) => sum + truncate(fieldLabel(item), 24).length + 3, "Confirm".length + 3)
    return width <= dimensions().width - 8
  })
  const answered = createMemo(
    () =>
      fields().filter((item) => {
        const value = store.answers[item.key]
        return value !== undefined
      }).length,
  )
  const field = createMemo(() => fields()[Math.min(store.tab, fields().length - 1)])
  const confirm = createMemo(() => !single() && store.tab >= fields().length)
  const rows = createMemo(() => {
    const current = field()
    if (!current) return []
    const configured = fieldRows(current)
    const value = store.answers[current.key]
    if (current.type !== "multiselect" || !Array.isArray(value)) return configured
    const known = new Set(configured.map((row) => row.value))
    return [
      ...configured,
      ...value.filter((item) => !known.has(item)).map((item) => ({ value: item, label: item, description: undefined })),
    ]
  })
  const textual = createMemo(() => {
    if (confirm()) return false
    const current = field()
    if (!current) return false
    if (current.type === "number" || current.type === "integer") return true
    return current.type === "string" && current.options === undefined
  })
  const custom = createMemo(() => {
    const current = field()
    if (!current) return false
    if (current.type === "string" && current.options !== undefined) return current.custom === true
    if (current.type === "multiselect") return current.custom === true
    return false
  })
  const multi = createMemo(() => field()?.type === "multiselect")
  const placeholder = createMemo(() => {
    const current = field()
    if (current?.type === "string") {
      if (current.placeholder) return current.placeholder
      if (current.format === "email") return "name@example.com"
      if (current.format === "uri") return "https://example.com"
      if (current.format === "date") return "YYYY-MM-DD"
      if (current.format === "date-time") return "YYYY-MM-DDTHH:MM:SSZ"
    }
    if (current?.type === "number" || current?.type === "integer") {
      const minimum = typeof current.minimum === "number" ? current.minimum : undefined
      const maximum = typeof current.maximum === "number" ? current.maximum : undefined
      if (minimum !== undefined && maximum !== undefined) return `${minimum}-${maximum}`
      if (minimum !== undefined) return `at least ${minimum}`
      if (maximum !== undefined) return `at most ${maximum}`
    }
    return "Type your answer"
  })
  const other = createMemo(() => custom() && store.selected === rows().length)
  const input = createMemo(() => store.custom[field()?.key ?? ""] ?? "")
  const customPicked = createMemo(() => {
    const value = input()
    if (!value) return false
    const answer = store.answers[field()?.key ?? ""]
    if (Array.isArray(answer)) return answer.includes(value)
    return answer === value
  })

  function answer(key: string, value: FormValue | undefined) {
    setStore("answers", { ...store.answers, [key]: value })
    setStore("error", "")
  }

  function replySingle(field: Field, value: FormValue) {
    sdk.api.form
      .reply(
        {
          sessionID: props.form.sessionID,
          formID: props.form.id,
          answer: { [field.key]: value },
        },
        requestOptions(props.form),
      )
      .catch((error: unknown) => {
        setStore(
          "error",
          typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
            ? error.message
            : "Invalid answer",
        )
      })
  }

  function pick(value: FormValue, customValue?: string) {
    const current = field()
    if (!current) return
    const invalid = validateValue(current, value)
    if (invalid) {
      setStore("error", invalid)
      return
    }
    answer(current.key, value)
    if (customValue !== undefined) setStore("custom", { ...store.custom, [current.key]: customValue })
    if (single()) {
      replySingle(current, value)
      return
    }
    selectTab(store.tab + 1)
  }

  function toggle(value: string) {
    const current = field()
    if (!current) return
    const existing = store.answers[current.key]
    const list = Array.isArray(existing) ? [...existing] : []
    const index = list.indexOf(value)
    if (index === -1) list.push(value)
    if (index !== -1) list.splice(index, 1)
    answer(current.key, list)
  }

  function validateCurrent() {
    if (confirm()) return true
    const current = field()
    if (!current) return true
    const invalid = validateValue(current, store.answers[current.key])
    if (!invalid) return true
    setStore("error", invalid)
    return false
  }

  function selectTab(index: number) {
    if (!confirm() && index > store.tab && !validateCurrent()) return
    const next = fields()[index]
    setStore("tab", index)
    setStore("selected", selectedRow(next, next ? store.answers[next.key] : undefined))
    setStore("editing", false)
    setStore("error", "")
  }

  function selectOption() {
    if (other()) {
      if (!multi()) {
        setStore("editing", true)
        return
      }
      const value = input()
      if (value && customPicked()) {
        toggle(value)
        return
      }
      setStore("editing", true)
      return
    }
    const row = rows()[store.selected]
    if (!row) return
    if (multi()) {
      toggle(String(row.value))
      return
    }
    pick(row.value)
  }

  function commitInput(text: string) {
    const current = field()
    if (!current) return false
    const isTextual = textual()
    const isMulti = multi()
    if (!text) {
      const previous = store.custom[current.key]
      const existing = store.answers[current.key]
      const values = Array.isArray(existing) ? existing.filter((value) => value !== previous) : []
      const value = !isTextual && isMulti && Array.isArray(existing) ? values : undefined
      const invalid = validateValue(current, value)
      if (invalid) {
        setStore("error", invalid)
        return false
      }
      answer(current.key, value)
      setStore("custom", { ...store.custom, [current.key]: "" })
      setStore("editing", false)
      return true
    }

    if (isTextual && (current.type === "number" || current.type === "integer")) {
      const value = Number(text)
      const invalid = validateValue(current, value)
      if (invalid) {
        setStore("error", invalid)
        return false
      }
      answer(current.key, value)
    }

    if (isTextual && current.type === "string") {
      const invalid = validateValue(current, text)
      if (invalid) {
        setStore("error", invalid)
        return false
      }
      answer(current.key, text)
    }

    if (!isTextual && isMulti) {
      const previous = store.custom[current.key]
      const existing = store.answers[current.key]
      const values = Array.isArray(existing) ? [...existing] : []
      if (previous) {
        const index = values.indexOf(previous)
        if (index !== -1) values.splice(index, 1)
      }
      if (!values.includes(text)) values.push(text)
      answer(current.key, values)
    }

    if (!isTextual && !isMulti) {
      const invalid = validateValue(current, text)
      if (invalid) {
        setStore("error", invalid)
        return false
      }
      answer(current.key, text)
    }

    const configured = current.type === "string" && current.options?.some((option) => option.value === text)
    setStore("custom", { ...store.custom, [current.key]: isMulti || configured ? "" : text })
    setStore("editing", false)
    return true
  }

  function submitInput(text: string, direction: 1 | -1 = 1) {
    if (!commitInput(text)) {
      if (direction === -1) selectTab((store.tab + direction + tabs()) % tabs())
      return
    }
    if (!single()) selectTab((store.tab + direction + tabs()) % tabs())
  }

  function selectTabFromMouse(target?: Field) {
    const targetIndex = () => {
      const index = target ? fields().findIndex((field) => field.key === target.key) : fields().length
      return index === -1 ? fields().length : index
    }
    const move = () => selectTab(targetIndex())
    if (!textual() && !store.editing) {
      move()
      return
    }
    if (!commitInput(textarea?.plainText?.trim() ?? "")) {
      if (targetIndex() < store.tab) move()
      return
    }
    move()
  }

  onMount(() => onCleanup(modeStack.push(FORM_MODE)))

  useBindings(() => ({
    mode: FORM_MODE,
    enabled: (store.editing || textual()) && !confirm(),
    commands: [
      {
        name: "prompt.clear",
        title: "Clear answer edit",
        category: "Form",
        run() {
          const text = textarea?.plainText ?? ""
          if (!text) {
            setStore("editing", false)
            return
          }
          textarea?.setText("")
        },
      },
    ],
    bindings: [
      {
        key: "escape",
        desc: "Cancel answer edit",
        group: "Form",
        cmd: () => {
          if (textual()) {
            void sdk.api.form.cancel(
              { sessionID: props.form.sessionID, formID: props.form.id },
              requestOptions(props.form),
            )
            return
          }
          setStore("editing", false)
        },
      },
      ...tuiConfig.keybinds.get("prompt.clear"),
      {
        key: "tab",
        desc: "Next field",
        group: "Form",
        cmd: () => {
          const text = textarea?.plainText?.trim() ?? ""
          submitInput(text)
        },
      },
      {
        key: "shift+tab",
        desc: "Previous field",
        group: "Form",
        cmd: () => {
          const text = textarea?.plainText?.trim() ?? ""
          submitInput(text, -1)
        },
      },
      {
        key: "return",
        desc: "Submit answer edit",
        group: "Form",
        cmd: () => {
          const text = textarea?.plainText?.trim() ?? ""
          const current = field()
          if (!current) return
          if (textual()) {
            submitInput(text)
            return
          }
          const wasMulti = multi()
          if (!commitInput(text) || wasMulti || !text) return
          if (single()) {
            replySingle(current, text)
            return
          }
          selectTab(store.tab + 1)
        },
      },
    ],
  }))

  useBindings(() => {
    const total = rows().length + (custom() ? 1 : 0)
    const max = Math.min(total, 9)

    return {
      mode: FORM_MODE,
      enabled: !store.editing && !textual(),
      commands: [
        {
          name: "app.exit",
          title: "Dismiss form",
          category: "Form",
          run() {
            void sdk.api.form.cancel(
              { sessionID: props.form.sessionID, formID: props.form.id },
              requestOptions(props.form),
            )
          },
        },
      ],
      bindings: [
        {
          key: "left",
          desc: "Previous field",
          group: "Form",
          cmd: () => selectTab((store.tab - 1 + tabs()) % tabs()),
        },
        {
          key: "h",
          desc: "Previous field",
          group: "Form",
          cmd: () => selectTab((store.tab - 1 + tabs()) % tabs()),
        },
        { key: "right", desc: "Next field", group: "Form", cmd: () => selectTab((store.tab + 1) % tabs()) },
        { key: "l", desc: "Next field", group: "Form", cmd: () => selectTab((store.tab + 1) % tabs()) },
        {
          key: "tab",
          desc: "Next field",
          group: "Form",
          cmd: () => selectTab((store.tab + 1) % tabs()),
        },
        {
          key: "shift+tab",
          desc: "Previous field",
          group: "Form",
          cmd: () => selectTab((store.tab - 1 + tabs()) % tabs()),
        },
        ...(confirm()
          ? [
              {
                key: "return",
                desc: "Submit form",
                group: "Form",
                cmd: () => {
                  const invalid = fields().find((field) => validateValue(field, store.answers[field.key]))
                  if (invalid) {
                    setStore("error", validateValue(invalid, store.answers[invalid.key]) ?? "Invalid answer")
                    return
                  }
                  sdk.api.form
                    .reply(
                      {
                        sessionID: props.form.sessionID,
                        formID: props.form.id,
                        answer: Object.fromEntries(
                          fields().flatMap((field) => {
                            const value = store.answers[field.key]
                            return value === undefined ? [] : [[field.key, value] as const]
                          }),
                        ),
                      },
                      requestOptions(props.form),
                    )
                    .catch((error: unknown) => {
                      setStore(
                        "error",
                        typeof error === "object" &&
                          error !== null &&
                          "message" in error &&
                          typeof error.message === "string"
                          ? error.message
                          : "Invalid answer",
                      )
                    })
                },
              },
              {
                key: "escape",
                desc: "Dismiss form",
                group: "Form",
                cmd: () => {
                  void sdk.api.form.cancel(
                    { sessionID: props.form.sessionID, formID: props.form.id },
                    requestOptions(props.form),
                  )
                },
              },
              { key: "up", desc: "Scroll review", group: "Form", cmd: () => review?.scrollBy(-1) },
              { key: "k", desc: "Scroll review", group: "Form", cmd: () => review?.scrollBy(-1) },
              { key: "down", desc: "Scroll review", group: "Form", cmd: () => review?.scrollBy(1) },
              { key: "j", desc: "Scroll review", group: "Form", cmd: () => review?.scrollBy(1) },
              ...tuiConfig.keybinds.get("app.exit"),
            ]
          : [
              ...Array.from({ length: max }, (_, index) => ({
                key: String(index + 1),
                desc: `Select answer ${index + 1}`,
                group: "Form",
                cmd: () => {
                  setStore("selected", index)
                  selectOption()
                },
              })),
              {
                key: "up",
                desc: "Previous answer",
                group: "Form",
                cmd: () => setStore("selected", (store.selected - 1 + total) % total),
              },
              {
                key: "k",
                desc: "Previous answer",
                group: "Form",
                cmd: () => setStore("selected", (store.selected - 1 + total) % total),
              },
              {
                key: "down",
                desc: "Next answer",
                group: "Form",
                cmd: () => setStore("selected", (store.selected + 1) % total),
              },
              {
                key: "j",
                desc: "Next answer",
                group: "Form",
                cmd: () => setStore("selected", (store.selected + 1) % total),
              },
              { key: "return", desc: "Select answer", group: "Form", cmd: () => selectOption() },
              {
                key: "escape",
                desc: "Dismiss form",
                group: "Form",
                cmd: () => {
                  void sdk.api.form.cancel(
                    { sessionID: props.form.sessionID, formID: props.form.id },
                    requestOptions(props.form),
                  )
                },
              },
              ...tuiConfig.keybinds.get("app.exit"),
            ]),
      ],
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
          <text fg={theme.textMuted}>{props.form.title}</text>
        </box>
        <Show when={!single() && !tabbed()}>
          <box flexDirection="row" gap={1} paddingLeft={1}>
            <text fg={theme.textMuted}>
              {confirm() ? "Review" : `Field ${Math.min(store.tab, fields().length - 1) + 1} of ${fields().length}`}
            </text>
            <text fg={theme.textMuted}>
              · {answered()}/{fields().length} answered
            </text>
          </box>
        </Show>
        <Show when={!single() && tabbed()}>
          <box flexDirection="row" gap={1} paddingLeft={1}>
            <For each={fields()}>
              {(item, index) => {
                const isTab = () => index() === store.tab
                const isAnswered = () => store.answers[item.key] !== undefined
                return (
                  <box
                    paddingLeft={1}
                    paddingRight={1}
                    backgroundColor={
                      isTab() ? theme.accent : tabHover() === index() ? theme.backgroundElement : theme.backgroundPanel
                    }
                    onMouseOver={() => setTabHover(index())}
                    onMouseOut={() => setTabHover(null)}
                    onMouseUp={() => {
                      if (renderer.getSelection()?.getSelectedText()) return
                      selectTabFromMouse(item)
                    }}
                  >
                    <text
                      fg={
                        isTab() ? selectedForeground(theme, theme.accent) : isAnswered() ? theme.text : theme.textMuted
                      }
                    >
                      {truncate(fieldLabel(item), 24)}
                    </text>
                  </box>
                )
              }}
            </For>
            <box
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={
                confirm() ? theme.accent : tabHover() === "confirm" ? theme.backgroundElement : theme.backgroundPanel
              }
              onMouseOver={() => setTabHover("confirm")}
              onMouseOut={() => setTabHover(null)}
              onMouseUp={() => {
                if (renderer.getSelection()?.getSelectedText()) return
                selectTabFromMouse()
              }}
            >
              <text fg={confirm() ? selectedForeground(theme, theme.accent) : theme.textMuted}>Confirm</text>
            </box>
          </box>
        </Show>

        <Show when={!confirm() && field()}>
          <box paddingLeft={1} gap={1}>
            <box>
              <text fg={theme.text}>
                {field()!.description ?? fieldLabel(field()!)}
                {field()!.required ? " (required)" : ""}
                {multi() ? " (select all that apply)" : ""}
              </text>
            </box>
            <Show when={textual() ? field()!.key : undefined} keyed>
              <box paddingLeft={1}>
                <textarea
                  ref={(val: TextareaRenderable) => {
                    textarea = val
                    val.traits = { status: "ANSWER" }
                    queueMicrotask(() => {
                      val.focus()
                      val.gotoLineEnd()
                    })
                  }}
                  initialValue={input() || display(field()!, store.answers[field()!.key])}
                  placeholder={placeholder()}
                  placeholderColor={theme.textMuted}
                  minHeight={1}
                  maxHeight={6}
                  textColor={theme.text}
                  focusedTextColor={theme.text}
                  cursorColor={theme.primary}
                />
              </box>
            </Show>
            <Show when={!textual()}>
              <box>
                <For each={rows()}>
                  {(row, i) => {
                    const active = () => i() === store.selected
                    const picked = () => {
                      const value = store.answers[field()?.key ?? ""]
                      if (Array.isArray(value)) return value.includes(String(row.value))
                      return value === row.value
                    }
                    return (
                      <box
                        onMouseOver={() => setStore("selected", i())}
                        onMouseDown={() => setStore("selected", i())}
                        onMouseUp={() => {
                          if (renderer.getSelection()?.getSelectedText()) return
                          selectOption()
                        }}
                      >
                        <box flexDirection="row">
                          <box backgroundColor={active() ? theme.backgroundElement : undefined} paddingRight={1}>
                            <text fg={active() ? tint(theme.textMuted, theme.secondary, 0.6) : theme.textMuted}>
                              {`${i() + 1}.`}
                            </text>
                          </box>
                          <box backgroundColor={active() ? theme.backgroundElement : undefined}>
                            <text fg={active() ? theme.secondary : picked() ? theme.success : theme.text}>
                              {multi() ? `[${picked() ? "✓" : " "}] ${row.label}` : row.label}
                            </text>
                          </box>
                          <Show when={!multi()}>
                            <text fg={theme.success}>{picked() ? " ✓" : ""}</text>
                          </Show>
                        </box>
                        <Show when={row.description}>
                          <box paddingLeft={3}>
                            <text fg={theme.textMuted}>{row.description}</text>
                          </box>
                        </Show>
                      </box>
                    )
                  }}
                </For>
                <Show when={custom()}>
                  <box
                    onMouseOver={() => setStore("selected", rows().length)}
                    onMouseDown={() => setStore("selected", rows().length)}
                    onMouseUp={() => {
                      if (renderer.getSelection()?.getSelectedText()) return
                      selectOption()
                    }}
                  >
                    <box flexDirection="row">
                      <box backgroundColor={other() ? theme.backgroundElement : undefined} paddingRight={1}>
                        <text fg={other() ? tint(theme.textMuted, theme.secondary, 0.6) : theme.textMuted}>
                          {`${rows().length + 1}.`}
                        </text>
                      </box>
                      <box backgroundColor={other() ? theme.backgroundElement : undefined}>
                        <text fg={other() ? theme.secondary : customPicked() ? theme.success : theme.text}>
                          {multi() ? `[${customPicked() ? "✓" : " "}] Type your own answer` : "Type your own answer"}
                        </text>
                      </box>
                      <Show when={!multi()}>
                        <text fg={theme.success}>{customPicked() ? " ✓" : ""}</text>
                      </Show>
                    </box>
                    <Show when={store.editing}>
                      <box paddingLeft={3}>
                        <textarea
                          ref={(val: TextareaRenderable) => {
                            textarea = val
                            val.traits = { status: "ANSWER" }
                            queueMicrotask(() => {
                              val.focus()
                              val.gotoLineEnd()
                            })
                          }}
                          initialValue={input()}
                          placeholder="Type your own answer"
                          placeholderColor={theme.textMuted}
                          minHeight={1}
                          maxHeight={6}
                          textColor={theme.text}
                          focusedTextColor={theme.text}
                          cursorColor={theme.primary}
                        />
                      </box>
                    </Show>
                    <Show when={!store.editing && input()}>
                      <box paddingLeft={3}>
                        <text fg={theme.textMuted}>{input()}</text>
                      </box>
                    </Show>
                  </box>
                </Show>
              </box>
            </Show>
          </box>
        </Show>

        <Show when={confirm()}>
          <Show when={tabbed()}>
            <box paddingLeft={1}>
              <text fg={theme.text}>Review</text>
            </box>
          </Show>
          <scrollbox
            maxHeight={Math.min(fields().length, Math.max(3, dimensions().height - 14))}
            scrollbarOptions={{ visible: false }}
            ref={(r: ScrollBoxRenderable) => (review = r)}
          >
            <For each={fields()}>
              {(item) => {
                const value = () => display(item, store.answers[item.key])
                const answered = () => {
                  const value = store.answers[item.key]
                  return value !== undefined
                }
                const missing = () => !answered() && item.required === true
                const invalid = () => validateValue(item, store.answers[item.key])
                return (
                  <box paddingLeft={1}>
                    <text>
                      <span style={{ fg: theme.textMuted }}>{truncate(fieldLabel(item), 40)}:</span>{" "}
                      <span
                        style={{ fg: invalid() || missing() ? theme.error : answered() ? theme.text : theme.textMuted }}
                      >
                        {invalid() ?? (answered() ? value() : missing() ? "(required)" : "(not answered)")}
                      </span>
                    </text>
                  </box>
                )
              }}
            </For>
          </scrollbox>
        </Show>
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
          <Show when={!single()}>
            <text fg={theme.text}>
              {"⇆"} <span style={{ fg: theme.textMuted }}>tab</span>
            </text>
          </Show>
          <Show when={!confirm() && !textual()}>
            <text fg={theme.text}>
              {"↑↓"} <span style={{ fg: theme.textMuted }}>select</span>
            </text>
          </Show>
          <Show when={confirm()}>
            <text fg={theme.text}>
              {"↑↓"} <span style={{ fg: theme.textMuted }}>scroll</span>
            </text>
          </Show>
          <text fg={theme.text}>
            enter{" "}
            <span style={{ fg: theme.textMuted }}>
              {confirm() ? "submit" : multi() ? "toggle" : single() ? "submit" : "confirm"}
            </span>
          </text>
          <text fg={theme.text}>
            esc <span style={{ fg: theme.textMuted }}>dismiss</span>
          </text>
        </box>
        <Show when={store.error}>
          <text fg={theme.error}>{store.error}</text>
        </Show>
      </box>
    </box>
  )
}
