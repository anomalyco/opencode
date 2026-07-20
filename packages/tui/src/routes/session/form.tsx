import { createStore } from "solid-js/store"
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import type { ScrollBoxRenderable, TextareaRenderable } from "@opentui/core"
import open from "open"
import { useTheme } from "../../context/theme"
import type { FormField, FormValue } from "@opencode-ai/client"
import type { FormWithLocation } from "../../context/data"
import { useClient } from "../../context/client"
import { useClipboard } from "../../context/clipboard"
import { SplitBorder } from "../../ui/border"
import { useToast } from "../../ui/toast"
import { Keymap } from "../../context/keymap"
import {
  formCustom,
  formDisplayValue,
  formInitialValues,
  formLabel,
  formRows,
  formSelected,
  formSetMultiselectCustom,
  formTextual,
  formToggleMultiselect,
  formValidateValue,
  isFormAnswerField,
} from "../../util/form"
import type { FormAnswerField } from "../../util/form"

const FORM_MODE = "form"

function truncate(label: string, max: number) {
  return label.length > max ? label.slice(0, max - 1).trimEnd() + "…" : label
}

function requestOptions(form: FormWithLocation) {
  if (form.sessionID !== "global" || !form.location) return undefined
  return {
    headers: {
      "x-opencode-directory": encodeURIComponent(form.location.directory),
      ...(form.location.workspaceID ? { "x-opencode-workspace": form.location.workspaceID } : {}),
    },
  }
}

export function FormPrompt(props: { form: FormWithLocation }) {
  const client = useClient()
  const { themeV2 } = useTheme().contextual("elevated")
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const keymap = Keymap.use()
  const clipboard = useClipboard()
  const toast = useToast()
  const configuredFields = props.form.fields.filter(isFormAnswerField)
  const initial = formInitialValues(props.form.fields)

  const [tabHover, setTabHover] = createSignal<number | "confirm" | null>(null)
  const [store, setStore] = createStore({
    tab: 0,
    answers: initial.answers,
    custom: initial.custom,
    externalReady: {} as Record<string, boolean>,
    selected: formSelected(configuredFields[0], configuredFields[0]?.default),
    editing: false,
    error: "",
  })

  let textarea: TextareaRenderable | undefined
  let review: ScrollBoxRenderable | undefined

  const message = createMemo(() => {
    const value = props.form.metadata?.["message"]
    return typeof value === "string" ? value : undefined
  })
  const fields = createMemo(() => {
    const answers: Record<string, FormValue | undefined> = {}
    return props.form.fields.filter((field) => {
      if (field.type === "external") return true
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
    if (list.length !== 1) return false
    const field = list[0]
    if (field.type === "external") return false
    return field.type === "boolean" || (field.type === "string" && field.options !== undefined)
  })
  const tabs = createMemo(() => (single() ? 1 : fields().length + 1))
  const tabbed = createMemo(() => {
    const width = fields().reduce((sum, item) => sum + truncate(formLabel(item), 24).length + 3, "Confirm".length + 3)
    return width <= dimensions().width - 8
  })
  const answered = createMemo(
    () =>
      fields().filter((item) => {
        const value = store.answers[item.key]
        return value !== undefined
      }).length,
  )
  const field = createMemo(() => fields()[store.tab])
  const answerField = createMemo(() => {
    const current = field()
    return current && isFormAnswerField(current) ? current : undefined
  })
  const externalField = createMemo(() => {
    const current = field()
    return current?.type === "external" ? current : undefined
  })
  const confirm = createMemo(() => !single() && store.tab >= fields().length)
  const rows = createMemo(() => {
    const current = answerField()
    if (!current) return []
    const configured = formRows(current)
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
    return formTextual(answerField())
  })
  const custom = createMemo(() => {
    return formCustom(answerField())
  })
  const multi = createMemo(() => answerField()?.type === "multiselect")
  const actionLabel = createMemo(() => {
    if (confirm()) return "submit"
    const external = externalField()
    if (external) {
      if (store.answers[external.key] === true) return "continue"
      return store.externalReady[external.key] ? "I finished" : "open link"
    }
    if (multi()) return "toggle"
    if (single()) return "submit"
    return "confirm"
  })
  const placeholder = createMemo(() => {
    const current = answerField()
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
  const input = createMemo(() => store.custom[answerField()?.key ?? ""] ?? "")
  const customPicked = createMemo(() => {
    const value = input()
    if (!value) return false
    const answer = store.answers[answerField()?.key ?? ""]
    if (Array.isArray(answer)) return answer.includes(value)
    return answer === value
  })

  function answer(key: string, value: FormValue | undefined) {
    setStore("answers", { ...store.answers, [key]: value })
    setStore("error", "")
  }

  function replySingle(field: FormAnswerField, value: FormValue) {
    client.api.form
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
    const current = answerField()
    if (!current) return
    const invalid = formValidateValue(current, value)
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
    const current = answerField()
    if (!current) return
    answer(current.key, formToggleMultiselect(store.answers[current.key], value))
  }

  function validateCurrent() {
    if (confirm()) return true
    const current = answerField()
    if (!current) return true
    const invalid = formValidateValue(current, store.answers[current.key])
    if (!invalid) return true
    setStore("error", invalid)
    return false
  }

  function selectTab(index: number) {
    if (!confirm() && index > store.tab && !validateCurrent()) return
    const next = fields()[index]
    setStore("tab", index)
    setStore("selected", next && isFormAnswerField(next) ? formSelected(next, store.answers[next.key]) : 0)
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
    const current = answerField()
    if (!current) return false
    const isTextual = textual()
    const isMulti = multi()
    if (!text) {
      const previous = store.custom[current.key]
      const existing = store.answers[current.key]
      const values = Array.isArray(existing) ? existing.filter((value) => value !== previous) : []
      const value = !isTextual && isMulti && Array.isArray(existing) ? values : undefined
      const invalid = formValidateValue(current, value)
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
      const invalid = formValidateValue(current, value)
      if (invalid) {
        setStore("error", invalid)
        return false
      }
      answer(current.key, value)
    }

    if (isTextual && current.type === "string") {
      const invalid = formValidateValue(current, text)
      if (invalid) {
        setStore("error", invalid)
        return false
      }
      answer(current.key, text)
    }

    if (!isTextual && isMulti) {
      answer(current.key, formSetMultiselectCustom(store.answers[current.key], store.custom[current.key], text))
    }

    if (!isTextual && !isMulti) {
      const invalid = formValidateValue(current, text)
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

  function selectTabFromMouse(target?: FormField) {
    const targetIndex = () => {
      const index = target ? fields().findIndex((field) => field === target) : fields().length
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

  function cancel() {
    void client.api.form.cancel({ sessionID: props.form.sessionID, formID: props.form.id }, requestOptions(props.form))
  }

  function openExternal() {
    const current = externalField()
    if (!current) return
    setStore("error", "")
    void open(current.url)
      .then(() => setStore("externalReady", { ...store.externalReady, [current.key]: true }))
      .catch(() => setStore("error", "Could not open the browser. Copy the URL and continue manually."))
  }

  function copyExternal() {
    const current = externalField()
    if (!current || !clipboard.write) return
    void clipboard
      .write(current.url)
      .then(() => {
        setStore("externalReady", { ...store.externalReady, [current.key]: true })
        toast.show({ message: "Copied URL to clipboard", variant: "info" })
      })
      .catch(toast.error)
  }

  function acknowledgeExternal() {
    const current = externalField()
    if (!current) return
    if (store.answers[current.key] === true) {
      selectTab(store.tab + 1)
      return
    }
    if (!store.externalReady[current.key]) {
      openExternal()
      return
    }
    answer(current.key, true)
    selectTab(store.tab + 1)
  }

  function submit() {
    const unacknowledged = fields().find((field) => field.type === "external" && store.answers[field.key] !== true)
    if (unacknowledged) {
      setStore("error", `External action must be acknowledged: ${formLabel(unacknowledged)}`)
      return
    }
    const invalid = fields()
      .filter(isFormAnswerField)
      .find((field) => formValidateValue(field, store.answers[field.key]))
    if (invalid) {
      setStore("error", formValidateValue(invalid, store.answers[invalid.key]) ?? "Invalid answer")
      return
    }
    client.api.form
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
          typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
            ? error.message
            : "Invalid answer",
        )
      })
  }

  onMount(() => onCleanup(keymap.mode.push(FORM_MODE)))

  Keymap.createLayer(() => ({
    mode: FORM_MODE,
    enabled: (store.editing || textual()) && !confirm(),
    commands: [
      {
        id: "prompt.clear",
        title: "Clear answer edit",
        group: "Form",
        run() {
          const text = textarea?.plainText ?? ""
          if (!text) {
            setStore("editing", false)
            return
          }
          textarea?.setText("")
        },
      },
      {
        bind: "escape",
        title: "Cancel answer edit",
        group: "Form",
        run: () => {
          if (textual()) {
            void client.api.form.cancel(
              { sessionID: props.form.sessionID, formID: props.form.id },
              requestOptions(props.form),
            )
            return
          }
          setStore("editing", false)
        },
      },
      {
        bind: "tab",
        title: "Next field",
        group: "Form",
        run: () => {
          const text = textarea?.plainText?.trim() ?? ""
          submitInput(text)
        },
      },
      {
        bind: "shift+tab",
        title: "Previous field",
        group: "Form",
        run: () => {
          const text = textarea?.plainText?.trim() ?? ""
          submitInput(text, -1)
        },
      },
      {
        bind: "return",
        title: "Submit answer edit",
        group: "Form",
        run: () => {
          const text = textarea?.plainText?.trim() ?? ""
          const current = answerField()
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

  Keymap.createLayer(() => {
    const total = rows().length + (custom() ? 1 : 0)
    const max = Math.min(total, 9)
    const external = externalField()

    return {
      mode: FORM_MODE,
      enabled: !store.editing && !textual(),
      commands: [
        {
          id: "app.exit",
          title: "Dismiss form",
          group: "Form",
          run: cancel,
        },
        {
          bind: "left",
          title: "Previous field",
          group: "Form",
          run: () => selectTab((store.tab - 1 + tabs()) % tabs()),
        },
        {
          bind: "h",
          title: "Previous field",
          group: "Form",
          run: () => selectTab((store.tab - 1 + tabs()) % tabs()),
        },
        { bind: "right", title: "Next field", group: "Form", run: () => selectTab((store.tab + 1) % tabs()) },
        { bind: "l", title: "Next field", group: "Form", run: () => selectTab((store.tab + 1) % tabs()) },
        {
          bind: "tab",
          title: "Next field",
          group: "Form",
          run: () => selectTab((store.tab + 1) % tabs()),
        },
        {
          bind: "shift+tab",
          title: "Previous field",
          group: "Form",
          run: () => selectTab((store.tab - 1 + tabs()) % tabs()),
        },
        ...(external
          ? [
              {
                bind: "return",
                title:
                  store.answers[external.key] === true
                    ? "Continue"
                    : store.externalReady[external.key]
                      ? "Confirm completion"
                      : "Open link",
                group: "Form",
                run: acknowledgeExternal,
              },
              { bind: "c", title: "Copy link", group: "Form", run: copyExternal },
              { bind: "escape", title: "Dismiss form", group: "Form", run: cancel },
            ]
          : confirm()
            ? [
                {
                  bind: "return",
                  title: "Submit form",
                  group: "Form",
                  run: submit,
                },
                {
                  bind: "escape",
                  title: "Dismiss form",
                  group: "Form",
                  run: cancel,
                },
                { bind: "up", title: "Scroll review", group: "Form", run: () => review?.scrollBy(-1) },
                { bind: "k", title: "Scroll review", group: "Form", run: () => review?.scrollBy(-1) },
                { bind: "down", title: "Scroll review", group: "Form", run: () => review?.scrollBy(1) },
                { bind: "j", title: "Scroll review", group: "Form", run: () => review?.scrollBy(1) },
              ]
            : [
                ...Array.from({ length: max }, (_, index) => ({
                  bind: String(index + 1),
                  title: `Select answer ${index + 1}`,
                  group: "Form",
                  run: () => {
                    setStore("selected", index)
                    selectOption()
                  },
                })),
                {
                  bind: "up",
                  title: "Previous answer",
                  group: "Form",
                  run: () => setStore("selected", (store.selected - 1 + total) % total),
                },
                {
                  bind: "k",
                  title: "Previous answer",
                  group: "Form",
                  run: () => setStore("selected", (store.selected - 1 + total) % total),
                },
                {
                  bind: "down",
                  title: "Next answer",
                  group: "Form",
                  run: () => setStore("selected", (store.selected + 1) % total),
                },
                {
                  bind: "j",
                  title: "Next answer",
                  group: "Form",
                  run: () => setStore("selected", (store.selected + 1) % total),
                },
                { bind: "return", title: "Select answer", group: "Form", run: () => selectOption() },
                {
                  bind: "escape",
                  title: "Dismiss form",
                  group: "Form",
                  run: cancel,
                },
              ]),
      ],
    }
  })

  return (
    <box
      backgroundColor={themeV2.background()}
      border={["left"]}
      borderColor={themeV2.hue.accent(500)}
      customBorderChars={SplitBorder.customBorderChars}
    >
      <box gap={1} paddingLeft={1} paddingRight={3} paddingTop={1} paddingBottom={1}>
        <box paddingLeft={1}>
          <text fg={themeV2.text.subdued()}>{props.form.title}</text>
        </box>
        <Show when={message()}>
          <box paddingLeft={1}>
            <text fg={themeV2.text()}>{message()}</text>
          </box>
        </Show>
        <Show when={!single() && !tabbed()}>
          <box flexDirection="row" gap={1} paddingLeft={1}>
            <text fg={themeV2.text.subdued()}>
              {confirm() ? "Review" : `Field ${Math.min(store.tab, fields().length - 1) + 1} of ${fields().length}`}
            </text>
            <Show when={fields().length > 0}>
              <text fg={themeV2.text.subdued()}>
                · {answered()}/{fields().length} completed
              </text>
            </Show>
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
                    paddingRight={2}
                    backgroundColor={
                      isTab()
                        ? themeV2.background.formfield("selected")
                        : tabHover() === index()
                          ? themeV2.background.formfield("focused")
                          : themeV2.background()
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
                        isTab()
                          ? themeV2.text.formfield("selected")
                          : tabHover() === index()
                            ? themeV2.text.formfield("focused")
                            : isAnswered()
                              ? themeV2.text()
                              : themeV2.text.subdued()
                      }
                    >
                      {truncate(formLabel(item), 24)}
                    </text>
                  </box>
                )
              }}
            </For>
            <box
              backgroundColor={
                confirm()
                  ? themeV2.background.formfield("selected")
                  : tabHover() === "confirm"
                    ? themeV2.background.formfield("focused")
                    : themeV2.background()
              }
              onMouseOver={() => setTabHover("confirm")}
              onMouseOut={() => setTabHover(null)}
              onMouseUp={() => {
                if (renderer.getSelection()?.getSelectedText()) return
                selectTabFromMouse()
              }}
            >
              <text fg={themeV2.text.formfield(confirm() ? "selected" : "default")}>Confirm</text>
            </box>
          </box>
        </Show>

        <Show when={!confirm() && externalField()}>
          {(external) => (
            <box paddingLeft={1} gap={1}>
              <Show when={external().title}>
                <text fg={themeV2.text()}>{external().title}</text>
              </Show>
              <Show when={external().description}>
                <text fg={themeV2.text.subdued()}>{external().description}</text>
              </Show>
              <text
                fg={themeV2.background.action()}
                onMouseUp={() => {
                  if (renderer.getSelection()?.getSelectedText()) return
                  openExternal()
                }}
              >
                {external().url}
              </text>
              <text
                fg={
                  store.answers[external().key] === true
                    ? themeV2.text.feedback.success()
                    : themeV2.text.subdued()
                }
              >
                {store.answers[external().key] === true
                  ? "✓ Acknowledged"
                  : store.externalReady[external().key]
                    ? "Complete the external action, then press enter to confirm."
                    : "Open or copy the URL, complete the external action, then confirm."}
              </text>
            </box>
          )}
        </Show>

        <Show when={!confirm() && answerField()}>
          <box paddingLeft={1} gap={1}>
            <box>
              <text fg={themeV2.text()}>
                {answerField()!.description ?? formLabel(answerField()!)}
                {answerField()!.required ? " (required)" : ""}
                {multi() ? " (select all that apply)" : ""}
              </text>
            </box>
            <Show when={textual() ? answerField()!.key : undefined} keyed>
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
                  initialValue={
                    input() || formDisplayValue(answerField()!, store.answers[answerField()!.key], "(none)")
                  }
                  placeholder={placeholder()}
                  placeholderColor={themeV2.text.subdued()}
                  minHeight={1}
                  maxHeight={6}
                  textColor={themeV2.text()}
                  focusedTextColor={themeV2.text()}
                  cursorColor={themeV2.text()}
                />
              </box>
            </Show>
            <Show when={!textual()}>
              <box>
                <For each={rows()}>
                  {(row, i) => {
                    const active = () => i() === store.selected
                    const picked = () => {
                      const value = store.answers[answerField()?.key ?? ""]
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
                          <box
                            backgroundColor={
                              active() ? themeV2.background.formfield("focused") : themeV2.background()
                            }
                            paddingRight={1}
                          >
                            <text fg={themeV2.text.formfield(active() ? "focused" : "default")}>
                              {`${i() + 1}.`}
                            </text>
                          </box>
                          <box
                            backgroundColor={
                              active() ? themeV2.background.formfield("focused") : themeV2.background()
                            }
                          >
                            <text
                              fg={themeV2.text.formfield(
                                active() ? "focused" : picked() ? "selected" : "default",
                              )}
                            >
                              {multi() ? `[${picked() ? "✓" : " "}] ${row.label}` : row.label}
                            </text>
                          </box>
                          <Show when={!multi()}>
                            <text fg={themeV2.text.formfield("selected")}>{picked() ? " ✓" : ""}</text>
                          </Show>
                        </box>
                        <Show when={row.description}>
                          <box paddingLeft={3}>
                            <text fg={themeV2.text.subdued()}>{row.description}</text>
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
                      <box
                        backgroundColor={other() ? themeV2.background.formfield("focused") : themeV2.background()}
                        paddingRight={1}
                      >
                        <text fg={themeV2.text.formfield(other() ? "focused" : "default")}>
                          {`${rows().length + 1}.`}
                        </text>
                      </box>
                      <box
                        backgroundColor={other() ? themeV2.background.formfield("focused") : themeV2.background()}
                      >
                        <text
                          fg={
                            other()
                              ? themeV2.text.formfield("focused")
                              : customPicked()
                                ? themeV2.text.feedback.success()
                                : themeV2.text()
                          }
                        >
                          {multi() ? `[${customPicked() ? "✓" : " "}] Type your own answer` : "Type your own answer"}
                        </text>
                      </box>
                      <Show when={!multi()}>
                        <text fg={themeV2.text.feedback.success()}>{customPicked() ? " ✓" : ""}</text>
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
                          placeholderColor={themeV2.text.subdued()}
                          minHeight={1}
                          maxHeight={6}
                          textColor={themeV2.text()}
                          focusedTextColor={themeV2.text()}
                          cursorColor={themeV2.text()}
                        />
                      </box>
                    </Show>
                    <Show when={!store.editing && input()}>
                      <box paddingLeft={3}>
                        <text fg={themeV2.text.subdued()}>{input()}</text>
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
              <text fg={themeV2.text()}>Review</text>
            </box>
          </Show>
          <scrollbox
            maxHeight={Math.min(fields().length, Math.max(3, dimensions().height - 14))}
            scrollbarOptions={{ visible: false }}
            ref={(r: ScrollBoxRenderable) => (review = r)}
          >
            <For each={fields()}>
              {(item) => {
                if (item.type === "external") {
                  const acknowledged = () => store.answers[item.key] === true
                  return (
                    <box paddingLeft={1}>
                      <text>
                        <span style={{ fg: themeV2.text.subdued() }}>{truncate(formLabel(item), 40)}:</span>{" "}
                        <span
                          style={{
                            fg: acknowledged()
                              ? themeV2.text.feedback.success()
                              : themeV2.text.feedback.error(),
                          }}
                        >
                          {acknowledged() ? "Acknowledged" : "(acknowledgement required)"}
                        </span>
                      </text>
                    </box>
                  )
                }
                const value = () => formDisplayValue(item, store.answers[item.key], "(none)")
                const answered = () => store.answers[item.key] !== undefined
                const missing = () => !answered() && item.required === true
                const invalid = () => formValidateValue(item, store.answers[item.key])
                return (
                  <box paddingLeft={1}>
                    <text>
                      <span style={{ fg: themeV2.text.subdued() }}>{truncate(formLabel(item), 40)}:</span>{" "}
                      <span
                        style={{
                          fg:
                            invalid() || missing()
                              ? themeV2.text.feedback.error()
                              : answered()
                                ? themeV2.text()
                                : themeV2.text.subdued(),
                        }}
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
            <text fg={themeV2.text()}>
              {"⇆"} <span style={{ fg: themeV2.text.subdued() }}>tab</span>
            </text>
          </Show>
          <Show when={!confirm() && !textual() && !externalField()}>
            <text fg={themeV2.text()}>
              {"↑↓"} <span style={{ fg: themeV2.text.subdued() }}>select</span>
            </text>
          </Show>
          <Show when={confirm() && fields().length > 0}>
            <text fg={themeV2.text()}>
              {"↑↓"} <span style={{ fg: themeV2.text.subdued() }}>scroll</span>
            </text>
          </Show>
          <text
            fg={themeV2.text()}
            onMouseUp={() => {
              if (renderer.getSelection()?.getSelectedText()) return
              if (confirm()) submit()
              if (externalField()) acknowledgeExternal()
            }}
          >
            enter <span style={{ fg: themeV2.text.subdued() }}>{actionLabel()}</span>
          </text>
          <Show when={externalField() && clipboard.write}>
            <text fg={themeV2.text()} onMouseUp={copyExternal}>
              c <span style={{ fg: themeV2.text.subdued() }}>copy</span>
            </text>
          </Show>
          <text fg={themeV2.text()} onMouseUp={cancel}>
            esc <span style={{ fg: themeV2.text.subdued() }}>dismiss</span>
          </text>
        </box>
        <Show when={store.error}>
          <text fg={themeV2.text.feedback.error()}>{store.error}</text>
        </Show>
      </box>
    </box>
  )
}
