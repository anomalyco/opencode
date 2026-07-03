import { createMemo, createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import type { FormAnswer, FormFormInfo, FormUrlInfo, LocationRef } from "@opencode-ai/sdk/v2"
import type { TextareaRenderable } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { selectedForeground, tint, useTheme } from "../../context/theme"
import { useSDK } from "../../context/sdk"
import { SplitBorder } from "../../ui/border"
import { useBindings, useOpencodeModeStack } from "../../keymap"
import { useTuiConfig } from "../../config"
import { errorMessage } from "../../util/error"
import { Locale } from "../../util/locale"

const FORM_MODE = "form"

type FormField = FormFormInfo["fields"][number]
type PromptForm = FormFormInfo | FormUrlInfo
type FieldOption = { value: string; label: string; description?: string; custom?: boolean }
type FieldTab = { type: "field"; index: number } | { type: "ellipsis"; key: string }

export function FormPrompt(props: { request: PromptForm; location?: LocationRef }) {
  const sdk = useSDK()
  const { theme } = useTheme()
  const renderer = useRenderer()
  const tuiConfig = useTuiConfig()
  const modeStack = useOpencodeModeStack()
  const [tabHover, setTabHover] = createSignal<number | "confirm" | null>(null)
  const [settling, setSettling] = createSignal<"reply" | "cancel">()
  const [settleError, setSettleError] = createSignal<string>()
  const [store, setStore] = createStore({
    tab: 0,
    selected: 0,
    editing: false,
    text: {} as Record<string, string>,
    boolean: {} as Record<string, boolean>,
    multiselect: {} as Record<string, string[]>,
    custom: {} as Record<string, string>,
  })
  let textarea: TextareaRenderable | undefined

  const fields = createMemo(() => (props.request.mode === "form" ? props.request.fields : []))
  const single = createMemo(() => fields().length === 1 && fields()[0]?.type !== "multiselect")
  const compactTabs = createMemo(() => {
    const items = fields()
    return items.length > 5 || items.some((item) => fieldLabel(item).length > 18)
  })
  const fieldTabItems = createMemo(() => fieldTabs(fields(), store.tab, compactTabs()))
  const answeredCount = createMemo(() => fields().filter((item) => fieldText(item).length > 0).length)
  const tabs = createMemo(() => (single() ? 1 : fields().length + 1))
  const confirm = createMemo(() => !single() && store.tab === fields().length)
  const field = createMemo(() => fields()[store.tab])
  const options = createMemo(() => fieldOptions(field()))
  const currentText = createMemo(() => fieldText(field()))
  const footerAction = createMemo(() => {
    if (confirm() || props.request.mode === "url") return "submit"
    if (field()?.type === "multiselect") return "toggle"
    if (options().length > 0) return single() ? "submit" : "confirm"
    return "type"
  })

  function submit() {
    const result = props.request.mode === "url" ? { answer: {} } : buildAnswer(fields())
    if ("error" in result) {
      setSettleError(result.error)
      return
    }
    settle("reply", () =>
      sdk.client.v2.session.form.reply(
        {
          sessionID: props.request.sessionID,
          formID: props.request.id,
          location: locationQuery(props.location),
          formReply: { answer: result.answer },
        },
        { throwOnError: true },
      ),
    )
  }

  function cancel() {
    settle("cancel", () =>
      sdk.client.v2.session.form.cancel(
        {
          sessionID: props.request.sessionID,
          formID: props.request.id,
          location: locationQuery(props.location),
        },
        { throwOnError: true },
      ),
    )
  }

  function settle(kind: "reply" | "cancel", run: () => Promise<unknown>) {
    if (settling()) return
    setSettling(kind)
    setSettleError(undefined)
    void run()
      .catch((error) => setSettleError(errorMessage(error)))
      .finally(() => setSettling(undefined))
  }

  function selectTab(index: number) {
    setStore("tab", index)
    setStore("selected", selectedOptionIndex(fields()[index]))
    setStore("editing", false)
  }

  function moveTo(index: number) {
    setStore("selected", index)
  }

  function moveOption(count: number, index: number) {
    if (count === 0) return
    moveTo((index + count) % count)
  }

  function choose() {
    const item = field()
    if (!item) {
      submit()
      return
    }
    if (item.type === "boolean") {
      setStore("boolean", item.key, store.selected === 1)
      if (single()) {
        submit()
        return
      }
      nextTab()
      return
    }
    if (item.type === "string" && fieldOptions(item).length) {
      const option = fieldOptions(item)[store.selected]
      if (!option) return
      if (option.custom) {
        setStore("editing", true)
        return
      }
      setStore("text", item.key, option.value)
      if (single()) {
        submit()
        return
      }
      nextTab()
      return
    }
    if (item.type === "multiselect") {
      const option = fieldOptions(item)[store.selected]
      if (!option) return
      if (option.custom) {
        const value = store.custom[item.key]
        if (value && (store.multiselect[item.key] ?? item.default ?? []).includes(value)) {
          setStore("multiselect", item.key, toggle(store.multiselect[item.key] ?? item.default ?? [], value))
          return
        }
        setStore("editing", true)
        return
      }
      const existing = store.multiselect[item.key] ?? item.default ?? []
      setStore("multiselect", item.key, toggle(existing, option.value))
      return
    }
    setStore("editing", true)
  }

  function nextTab() {
    selectTab(Math.min(store.tab + 1, fields().length))
  }

  function fieldText(item: FormField | undefined) {
    if (!item) return ""
    if (item.type === "boolean") return String(store.boolean[item.key] ?? item.default ?? false)
    if (item.type === "multiselect") return (store.multiselect[item.key] ?? item.default ?? []).join(", ")
    return store.text[item.key] ?? (item.default === undefined ? "" : String(item.default))
  }

  function selectedOptionIndex(item: FormField | undefined) {
    const choices = fieldOptions(item)
    if (!item || choices.length === 0 || item.type === "multiselect") return 0
    const index = choices.findIndex((option) => option.value === fieldText(item))
    if (index >= 0) return index
    const customIndex = choices.findIndex((option) => option.custom === true)
    return customIndex >= 0 && (store.custom[item.key] || fieldText(item)) ? customIndex : 0
  }

  function buildAnswer(items: FormField[]): { answer: FormAnswer } | { error: string } {
    const result = items.reduce<{ answer: FormAnswer; error?: string }>(
      (state, item) => {
        if (state.error) return state
        if (!isActive(item, state.answer)) return state
        if (item.type === "boolean") {
          if (store.boolean[item.key] !== undefined || item.default !== undefined || item.required) {
            return {
              ...state,
              answer: { ...state.answer, [item.key]: store.boolean[item.key] ?? item.default ?? false },
            }
          }
          return state
        }
        if (item.type === "multiselect") {
          const value = store.multiselect[item.key] ?? item.default ?? []
          if (value.length > 0 || item.required) {
            return { ...state, answer: { ...state.answer, [item.key]: value } }
          }
          return state
        }
        const text = fieldText(item).trim()
        if (!text) {
          if (item.required) return { ...state, answer: { ...state.answer, [item.key]: "" } }
          return state
        }
        if (item.type === "number" || item.type === "integer") {
          const value = Number(text)
          if (!Number.isFinite(value)) return { ...state, error: `Expected number for ${fieldLabel(item)}` }
          if (item.type === "integer" && !Number.isInteger(value))
            return { ...state, error: `Expected integer for ${fieldLabel(item)}` }
          return { ...state, answer: { ...state.answer, [item.key]: value } }
        }
        return { ...state, answer: { ...state.answer, [item.key]: text } }
      },
      { answer: {} },
    )
    if (result.error) return { error: result.error }
    return { answer: result.answer }
  }

  onMount(() => {
    setStore("selected", selectedOptionIndex(field()))
    const popMode = modeStack.push(FORM_MODE)
    onCleanup(popMode)
  })

  useBindings(() => ({
    mode: FORM_MODE,
    enabled: store.editing,
    commands: [
      {
        name: "form.clear",
        title: "Clear form input",
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
        desc: "Cancel edit",
        group: "Form",
        cmd: () => setStore("editing", false),
      },
      ...tuiConfig.keybinds.get("prompt.clear"),
      {
        key: "return",
        desc: "Save input",
        group: "Form",
        cmd: () => {
          const item = field()
          if (!item) return
          const text = textarea?.plainText?.trim() ?? ""
          if (item.type === "multiselect") {
            const previous = store.custom[item.key]
            const existing = store.multiselect[item.key] ?? item.default ?? []
            const withoutPrevious = previous ? existing.filter((value) => value !== previous) : existing
            setStore(
              "multiselect",
              item.key,
              text && !withoutPrevious.includes(text) ? [...withoutPrevious, text] : withoutPrevious,
            )
            setStore("custom", item.key, text)
            setStore("editing", false)
            return
          }
          setStore("text", item.key, text)
          setStore("custom", item.key, text)
          setStore("editing", false)
          if (single()) {
            submit()
            return
          }
          nextTab()
        },
      },
    ],
  }))

  useBindings(() => {
    const item = field()
    const count = optionCount(item)
    return {
      mode: FORM_MODE,
      enabled: !store.editing,
      commands: [
        {
          name: "app.exit",
          title: "Cancel form",
          category: "Form",
          run: cancel,
        },
      ],
      bindings: [
        { key: "left", desc: "Previous field", group: "Form", cmd: () => selectTab((store.tab - 1 + tabs()) % tabs()) },
        { key: "h", desc: "Previous field", group: "Form", cmd: () => selectTab((store.tab - 1 + tabs()) % tabs()) },
        { key: "right", desc: "Next field", group: "Form", cmd: () => selectTab((store.tab + 1) % tabs()) },
        { key: "l", desc: "Next field", group: "Form", cmd: () => selectTab((store.tab + 1) % tabs()) },
        {
          key: "tab",
          desc: "Next field",
          group: "Form",
          cmd: ({ event }: { event: { shift: boolean } }) => {
            selectTab((store.tab + (event.shift ? -1 : 1) + tabs()) % tabs())
          },
        },
        ...Array.from({ length: Math.min(count, 9) }, (_, index) => ({
          key: String(index + 1),
          desc: `Select option ${index + 1}`,
          group: "Form",
          cmd: () => {
            moveTo(index)
            choose()
          },
        })),
        ...(count > 0
          ? [
              { key: "up", desc: "Previous option", group: "Form", cmd: () => moveOption(count, store.selected - 1) },
              { key: "k", desc: "Previous option", group: "Form", cmd: () => moveOption(count, store.selected - 1) },
              { key: "down", desc: "Next option", group: "Form", cmd: () => moveOption(count, store.selected + 1) },
              { key: "j", desc: "Next option", group: "Form", cmd: () => moveOption(count, store.selected + 1) },
            ]
          : []),
        {
          key: "return",
          desc: confirm() || props.request.mode === "url" ? "Submit form" : count > 0 ? "Select" : "Edit",
          group: "Form",
          cmd: choose,
        },
        { key: "escape", desc: "Cancel form", group: "Form", cmd: cancel },
        ...tuiConfig.keybinds.get("app.exit"),
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
        <Switch>
          <Match when={props.request.mode === "url"}>
            <box paddingLeft={1} gap={1}>
              <text fg={theme.text}>{props.request.title ?? "Open URL request"}</text>
              <Show when={formMessage(props.request)}>
                <text fg={theme.textMuted} wrapMode="word">
                  {formMessage(props.request)}
                </text>
              </Show>
              <text fg={theme.textMuted}>Open this URL, complete the request, then press enter:</text>
              <text fg={theme.secondary}>{props.request.mode === "url" ? props.request.url : ""}</text>
            </box>
          </Match>
          <Match when={props.request.mode === "form"}>
            <Show when={props.request.mode === "form" && props.request.title}>
              <box paddingLeft={1}>
                <text fg={theme.text} wrapMode="word">
                  {props.request.mode === "form" ? props.request.title : ""}
                </text>
              </box>
            </Show>
            <Show when={formMessage(props.request)}>
              <box paddingLeft={1}>
                <text fg={theme.textMuted} wrapMode="word">
                  {formMessage(props.request)}
                </text>
              </box>
            </Show>
            <Show when={!single()}>
              <box flexDirection="row" gap={1} paddingLeft={1}>
                <For each={fieldTabItems()}>
                  {(tab) => {
                    if (tab.type === "ellipsis")
                      return (
                        <box paddingLeft={1} paddingRight={1}>
                          <text fg={theme.textMuted} wrapMode="none">
                            ...
                          </text>
                        </box>
                      )
                    const item = () => fields()[tab.index]
                    const active = () => tab.index === store.tab
                    const answered = () => fieldText(item()).length > 0
                    const title = () => (compactTabs() ? String(tab.index + 1) : Locale.truncate(fieldLabel(item()), 18))
                    return (
                      <box
                        paddingLeft={1}
                        paddingRight={1}
                        backgroundColor={
                          active()
                            ? theme.accent
                            : tabHover() === tab.index
                              ? theme.backgroundElement
                              : theme.backgroundPanel
                        }
                        onMouseOver={() => setTabHover(tab.index)}
                        onMouseOut={() => setTabHover(null)}
                        onMouseUp={() => {
                          if (renderer.getSelection()?.getSelectedText()) return
                          selectTab(tab.index)
                        }}
                      >
                        <text
                          fg={
                            active() ? selectedForeground(theme, theme.accent) : answered() ? theme.text : theme.textMuted
                          }
                          wrapMode="none"
                        >
                          {title()}
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
                    selectTab(fields().length)
                  }}
                >
                  <text fg={confirm() ? selectedForeground(theme, theme.accent) : theme.textMuted} wrapMode="none">
                    {compactTabs() ? "Review" : "Confirm"}
                  </text>
                </box>
              </box>
            </Show>
            <Show when={compactTabs() && !confirm()}>
              <box paddingLeft={1}>
                <text fg={theme.textMuted} wrapMode="none">
                  {`Field ${store.tab + 1} of ${fields().length} - ${answeredCount()} answered`}
                </text>
              </box>
            </Show>
            <Show when={!confirm()}>
              <FieldEditor
                field={field()}
                selected={store.selected}
                value={currentText()}
                customValue={field() ? store.custom[field()!.key] : ""}
                editing={store.editing}
                options={options()}
                picked={(value) => picked(field(), value)}
                moveTo={moveTo}
                choose={choose}
                textarea={(value) => {
                  textarea = value
                }}
              />
            </Show>
            <Show when={confirm()}>
              <box paddingLeft={1}>
                <text fg={theme.text}>Review</text>
              </box>
              <box>
                <For each={fields()}>
                  {(item) => {
                    const value = () => fieldText(item)
                    return (
                      <box paddingLeft={1}>
                        <text>
                          <span style={{ fg: theme.textMuted }}>{fieldLabel(item)}:</span>{" "}
                          <span style={{ fg: value() ? theme.text : theme.error }}>{value() || "(not answered)"}</span>
                        </text>
                      </box>
                    )
                  }}
                </For>
              </box>
            </Show>
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
          <Show when={props.request.mode === "form" && !single()}>
            <text fg={theme.text}>
              {"⇆"} <span style={{ fg: theme.textMuted }}>tab</span>
            </text>
          </Show>
          <Show when={props.request.mode === "form" && !confirm() && optionCount(field()) > 0}>
            <text fg={theme.text}>
              {"↑↓"} <span style={{ fg: theme.textMuted }}>select</span>
            </text>
          </Show>
          <text fg={theme.text}>
            enter <span style={{ fg: theme.textMuted }}>{footerAction()}</span>
          </text>
          <text fg={theme.text}>
            esc <span style={{ fg: theme.textMuted }}>cancel</span>
          </text>
          <Show when={settling()}>
            <text fg={theme.textMuted}>{settling() === "cancel" ? "Cancelling..." : "Submitting..."}</text>
          </Show>
          <Show when={settleError()}>
            <text fg={theme.error}>{settleError()}</text>
          </Show>
        </box>
      </box>
    </box>
  )

  function picked(item: FormField | undefined, value: string) {
    if (!item) return false
    if (value === CUSTOM_OPTION_VALUE) return Boolean(store.custom[item.key])
    if (item.type === "multiselect") return (store.multiselect[item.key] ?? item.default ?? []).includes(value)
    return fieldText(item) === value
  }
}

function FieldEditor(props: {
  field?: FormField
  selected: number
  value: string
  customValue: string
  editing: boolean
  options: FieldOption[]
  picked: (value: string) => boolean
  moveTo: (index: number) => void
  choose: () => void
  textarea: (value: TextareaRenderable) => void
}) {
  const { theme } = useTheme()
  return (
    <box paddingLeft={1} gap={1}>
      <text fg={theme.text}>{fieldLabel(props.field)}</text>
      <Show when={fieldDescription(props.field)}>
        <text fg={theme.textMuted}>{props.field?.description}</text>
      </Show>
      <Switch>
        <Match when={props.options.length > 0}>
          <For each={props.options}>
            {(option, index) => {
              const active = () => index() === props.selected
              const picked = () => props.picked(option.value)
              const multi = () => props.field?.type === "multiselect"
              return (
                <box
                  onMouseOver={() => props.moveTo(index())}
                  onMouseDown={() => props.moveTo(index())}
                  onMouseUp={() => props.choose()}
                >
                  <box flexDirection="row">
                    <box backgroundColor={active() ? theme.backgroundElement : undefined} paddingRight={1}>
                      <text
                        fg={active() ? tint(theme.textMuted, theme.secondary, 0.6) : theme.textMuted}
                      >{`${index() + 1}.`}</text>
                    </box>
                    <box backgroundColor={active() ? theme.backgroundElement : undefined}>
                      <text fg={active() ? theme.secondary : picked() ? theme.success : theme.text}>
                        {multi() ? `[${picked() ? "✓" : " "}] ${option.label}` : option.label}
                      </text>
                    </box>
                    <Show when={!multi()}>
                      <text fg={theme.success}>{picked() ? " ✓" : ""}</text>
                    </Show>
                  </box>
                  <Show when={option.description}>
                    <box paddingLeft={3}>
                      <text fg={theme.textMuted}>{option.description}</text>
                    </box>
                  </Show>
                </box>
              )
            }}
          </For>
          <Show when={props.editing}>
            <box paddingLeft={3}>
              <FormTextarea value={props.customValue} placeholder="Type custom value" textarea={props.textarea} />
            </box>
          </Show>
          <Show when={!props.editing && props.customValue}>
            <box paddingLeft={3}>
              <text fg={theme.textMuted}>{props.customValue}</text>
            </box>
          </Show>
        </Match>
        <Match when={props.editing}>
          <FormTextarea value={props.value} placeholder="Type value" textarea={props.textarea} />
        </Match>
        <Match when={true}>
          <text fg={props.value ? theme.text : theme.textMuted}>{props.value || "Press enter to type"}</text>
        </Match>
      </Switch>
    </box>
  )
}

function FormTextarea(props: { value: string; placeholder: string; textarea: (value: TextareaRenderable) => void }) {
  const { theme } = useTheme()
  return (
    <textarea
      ref={(value: TextareaRenderable) => {
        props.textarea(value)
        value.traits = { status: "FORM" }
        queueMicrotask(() => {
          value.focus()
          value.gotoLineEnd()
        })
      }}
      initialValue={props.value}
      placeholder={props.placeholder}
      placeholderColor={theme.textMuted}
      minHeight={1}
      maxHeight={6}
      textColor={theme.text}
      focusedTextColor={theme.text}
      cursorColor={theme.primary}
    />
  )
}

function fieldTabs(fields: FormField[], active: number, compact: boolean): FieldTab[] {
  if (!compact) return fields.map((_, index) => ({ type: "field", index }))
  if (fields.length <= 7) return fields.map((_, index) => ({ type: "field", index }))

  const last = fields.length - 1
  const start = Math.max(0, Math.min(active - 2, last - 4))
  const window = Array.from({ length: 5 }, (_, offset) => start + offset).filter((index) => index <= last)
  const indexes = [...new Set([0, ...window, last])].toSorted((a, b) => a - b)

  return indexes.flatMap((index, position): FieldTab[] => {
    const previous = indexes[position - 1]
    const tab: FieldTab = { type: "field", index }
    if (previous !== undefined && index - previous > 1) return [{ type: "ellipsis", key: `${previous}-${index}` }, tab]
    return [tab]
  })
}

function fieldOptions(field: FormField | undefined) {
  if (!field) return []
  if (field.type === "boolean")
    return [
      { value: "false", label: "No" },
      { value: "true", label: "Yes" },
    ]
  if (field.type === "string") return withCustomOption(field.options ?? [], field.custom)
  if (field.type === "multiselect") return withCustomOption(field.options, field.custom)
  return []
}

const CUSTOM_OPTION_VALUE = "__custom__"

function withCustomOption(options: FieldOption[], custom: boolean | undefined): FieldOption[] {
  if (options.length > 0 && custom !== true) return options
  return [...options, { value: CUSTOM_OPTION_VALUE, label: "Type custom value", custom: true }]
}

function formMessage(form: PromptForm) {
  const message = form.metadata?.message
  return typeof message === "string" && message !== form.title ? message : undefined
}

function optionCount(field: FormField | undefined) {
  return fieldOptions(field).length
}

function fieldLabel(field: FormField | undefined) {
  return field?.title ?? field?.description ?? field?.key ?? "Form"
}

function fieldDescription(field: FormField | undefined) {
  if (!field?.description || field.description === fieldLabel(field)) return undefined
  return field.description
}

function isActive(field: FormField, answer: FormAnswer) {
  if (!field.when) return true
  const value = answer[field.when.key]
  if (field.when.op === "eq") return value === field.when.value
  return value !== field.when.value
}

function toggle(values: readonly string[], value: string) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]
}

function locationQuery(ref?: LocationRef) {
  return ref ? { directory: ref.directory, workspace: ref.workspaceID } : undefined
}
