import { createStore } from "solid-js/store"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { usePaste, useRenderer, useTerminalDimensions } from "@opentui/solid"
import {
  CliRenderEvents,
  decodePasteBytes,
  stripAnsiSequences,
  TextAttributes,
  type ScrollBoxRenderable,
  type TextareaRenderable,
} from "@opentui/core"
import open from "open"
import { useTheme, useThemes } from "../../context/theme"
import type { FormAnswer, FormField, FormValue } from "@opencode-ai/client"
import type { FormWithLocation } from "../../context/data"
import { useClient } from "../../context/client"
import { useClipboard } from "../../context/clipboard"
import { SplitBorder } from "../../ui/border"
import { useToast } from "../../ui/toast"
import { Keymap } from "../../context/keymap"
import { useConfig } from "../../config"
import { errorMessage } from "../../util/error"
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

export const FORM_MODE = "form"

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

export function FormPrompt(props: {
  form: FormWithLocation
  onReply?: (answer: FormAnswer) => void | Promise<void>
  onCancel?: () => void | Promise<void>
}) {
  const client = useClient()
  const themes = useThemes()
  const theme = useTheme("elevated")
  const themeMode = themes.mode
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const keymap = Keymap.use()
  const config = useConfig().data
  const clipboard = useClipboard()
  const toast = useToast()
  const configuredFields = props.form.fields.filter(isFormAnswerField)
  const initial = formInitialValues(props.form.fields)

  const [tabHover, setTabHover] = createSignal<number | "confirm" | null>(null)
  const [reviewHeight, setReviewHeight] = createSignal(1)
  const [reviewScrollable, setReviewScrollable] = createSignal(false)
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
  let measureReview: (() => void) | undefined

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
    const width = fields().reduce((sum, item) => sum + truncate(formLabel(item), 24).length + 3, "Submit".length + 3)
    return width <= dimensions().width - 8
  })
  const completed = (item: FormField) => {
    const value = store.answers[item.key]
    if (value === undefined) return false
    if (item.type === "external") return value === true
    return formValidateValue(item, value) === undefined
  }
  const answered = createMemo(() => fields().filter(completed).length)
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
  const configuredRows = createMemo(() => {
    const current = answerField()
    return current ? formRows(current) : []
  })
  const rows = createMemo(() => {
    const current = answerField()
    if (!current) return []
    const configured = configuredRows()
    const value = store.answers[current.key]
    if (current.type !== "multiselect" || !Array.isArray(value)) return configured
    const known = new Set(configured.map((row) => row.value))
    return [
      ...configured,
      ...value
        .filter((item) => !known.has(item) && item !== store.custom[current.key])
        .map((item) => ({ value: item, label: item, description: undefined })),
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
  const customChecked = createMemo(() => customPicked() || (multi() && other() && store.editing))
  const actionLabel = createMemo(() => {
    if (confirm()) return "submit"
    const external = externalField()
    if (external) {
      if (store.answers[external.key] === true) return "continue"
      return store.externalReady[external.key] ? "I finished" : "open link"
    }
    if (multi()) {
      if (other() && store.editing) return "done"
      if (other() && !input()) return "edit"
      return "toggle"
    }
    if (single()) return "submit"
    return "confirm"
  })

  createEffect(() => {
    if (measureReview) renderer.off(CliRenderEvents.FRAME, measureReview)
    if (!confirm()) {
      measureReview = undefined
      review = undefined
      setReviewScrollable(false)
      return
    }
    const limit = Math.max(3, dimensions().height - 14)
    const initial = Math.min(Math.max(1, fields().length), limit)
    Object.values(store.answers)
    setReviewHeight(initial)
    setReviewScrollable(false)
    measureReview = () => {
      measureReview = undefined
      const content = review?.scrollHeight ?? initial
      const height = Math.min(Math.max(1, content), limit)
      setReviewHeight(height)
      setReviewScrollable(content > height)
    }
    renderer.once(CliRenderEvents.FRAME, measureReview)
    renderer.requestRender()
  })

  onCleanup(() => {
    if (measureReview) renderer.off(CliRenderEvents.FRAME, measureReview)
  })

  onCleanup(
    keymap.intercept("key", ({ event, consume }) => {
      if (keymap.mode.current() !== FORM_MODE) return
      if (textual() || !other() || (store.editing && renderer.currentFocusedEditor === textarea)) return
      if (event.ctrl || event.meta || event.option || event.super || event.hyper) return
      if ((!store.editing && event.sequence === " ") || !/^[^\p{C}\p{Zl}\p{Zp}]$/u.test(event.sequence)) return
      const current = answerField()
      if (!current) return
      updateCustom(current, input() + event.sequence)
      if (!store.editing) setStore("editing", true)
      consume()
    }),
  )

  function answer(key: string, value: FormValue | undefined) {
    const field = fields().find((item) => item.key === key)
    setStore(
      "answers",
      key,
      Array.isArray(value) && value.length === 0 && field?.type === "multiselect" && !field.required
        ? undefined
        : value,
    )
    setStore("error", "")
  }

  function reply(answer: FormAnswer) {
    void Promise.resolve()
      .then(() =>
        props.onReply
          ? props.onReply(answer)
          : client.api.form.reply(
              { sessionID: props.form.sessionID, formID: props.form.id, answer },
              requestOptions(props.form),
            ),
      )
      .catch((error: unknown) => setStore("error", errorMessage(error)))
  }

  function replySingle(field: FormAnswerField, value: FormValue) {
    reply({ [field.key]: value })
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
    if (customValue !== undefined) setStore("custom", current.key, customValue)
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

  function updateCustom(current: FormAnswerField, value: string) {
    const previous = store.custom[current.key]
    if (previous === value) return
    setStore("custom", current.key, value)
    answer(
      current.key,
      current.type === "multiselect"
        ? formSetMultiselectCustom(store.answers[current.key], previous, value)
        : value || undefined,
    )
  }

  function selectTab(index: number) {
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

  usePaste((event) => {
    if (keymap.mode.current() !== FORM_MODE) return
    const current = answerField()
    if (!current || textual() || !custom() || confirm()) return
    event.preventDefault()
    setStore("selected", rows().length)
    updateCustom(current, input() + stripAnsiSequences(decodePasteBytes(event.bytes)).replace(/\r\n?/g, "\n"))
    setStore("editing", true)
  })

  function commitInput(text: string) {
    const current = answerField()
    if (!current) return false
    const isTextual = textual()
    const isMulti = multi()
    if (!text) {
      const value =
        !isTextual && isMulti
          ? formSetMultiselectCustom(store.answers[current.key], store.custom[current.key], "")
          : undefined
      if (isTextual || !isMulti) {
        const invalid = formValidateValue(current, value)
        if (invalid) {
          setStore("error", invalid)
          return false
        }
      }
      answer(current.key, value)
      setStore("custom", current.key, "")
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
    setStore("custom", current.key, configured ? "" : text)
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
    if (props.onCancel) {
      void props.onCancel()
      return
    }
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
    if (!current) return
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
    reply(
      Object.fromEntries(
        fields().flatMap((field) => {
          const value = store.answers[field.key]
          return value === undefined ? [] : [[field.key, value] as const]
        }),
      ),
    )
  }

  onMount(() => onCleanup(keymap.mode.push(FORM_MODE)))

  Keymap.createLayer(() => ({
    mode: FORM_MODE,
    priority: 1,
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
        title: textual() ? "Dismiss form" : "Close answer edit",
        group: "Form",
        run: () => {
          if (textual()) {
            cancel()
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
        bind: "up",
        title: "Leave answer edit",
        group: "Form",
        run: () => {
          if (textual() || !textarea || textarea.isDestroyed || store.selected === 0) return false
          if (textarea.scrollY + textarea.visualCursor.visualRow > 0) return false
          setStore("editing", false)
          setStore("selected", store.selected - 1)
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
                ...(multi()
                  ? [{ bind: "space", title: "Toggle answer", group: "Form", run: () => selectOption() }]
                  : []),
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
      backgroundColor={theme.background.default}
      border={["left"]}
      borderColor={theme.hue.interactive[themeMode() === "light" ? 800 : 200]}
      customBorderChars={SplitBorder.customBorderChars}
    >
      <box gap={1} paddingLeft={1} paddingRight={3} paddingTop={1} paddingBottom={1}>
        <box paddingLeft={1}>
          <text fg={theme.text.subdued}>{props.form.title}</text>
        </box>
        <Show when={message()}>
          <box paddingLeft={1}>
            <text fg={theme.text.default}>{message()}</text>
          </box>
        </Show>
        <Show when={!single() && !tabbed()}>
          <box flexDirection="row" gap={3} paddingLeft={1}>
            <text fg={theme.text.subdued}>
              {confirm() ? "Review" : `Field ${Math.min(store.tab, fields().length - 1) + 1} of ${fields().length}`}
            </text>
            <Show when={fields().length > 0}>
              <text fg={theme.text.subdued}>
                · {answered()}/{fields().length} completed
              </text>
            </Show>
          </box>
        </Show>
        <Show when={!single() && tabbed()}>
          <box flexDirection="row" paddingLeft={1}>
            <For each={fields()}>
              {(item, index) => {
                const isTab = () => index() === store.tab
                const color = () =>
                  isTab()
                    ? theme.text.default
                    : tabHover() === index()
                      ? theme.text.formfield.focused
                      : theme.text.subdued
                return (
                  <box
                    paddingRight={2}
                    backgroundColor={
                      isTab()
                        ? theme.background.formfield.selected
                        : tabHover() === index()
                          ? theme.background.formfield.focused
                          : theme.background.default
                    }
                    onMouseOver={() => setTabHover(index())}
                    onMouseOut={() => setTabHover(null)}
                    onMouseUp={() => {
                      if (renderer.getSelection()?.getSelectedText()) return
                      selectTabFromMouse(item)
                    }}
                  >
                    <text fg={color()} attributes={isTab() ? TextAttributes.BOLD : undefined}>
                      {truncate(formLabel(item), 24)}
                    </text>
                  </box>
                )
              }}
            </For>
            <box
              backgroundColor={
                confirm()
                  ? theme.background.formfield.selected
                  : tabHover() === "confirm"
                    ? theme.background.formfield.focused
                    : theme.background.default
              }
              onMouseOver={() => setTabHover("confirm")}
              onMouseOut={() => setTabHover(null)}
              onMouseUp={() => {
                if (renderer.getSelection()?.getSelectedText()) return
                selectTabFromMouse()
              }}
            >
              <text
                fg={
                  confirm()
                    ? theme.text.default
                    : tabHover() === "confirm"
                      ? theme.text.formfield.focused
                      : theme.text.subdued
                }
                attributes={confirm() ? TextAttributes.BOLD : undefined}
              >
                Submit
              </text>
            </box>
          </box>
        </Show>

        <Show when={!confirm() && externalField()}>
          {(external) => (
            <box paddingLeft={1} gap={1}>
              <Show when={external().title}>
                <text fg={theme.text.default}>{external().title}</text>
              </Show>
              <Show when={external().description}>
                <text fg={theme.text.subdued}>{external().description}</text>
              </Show>
              <text
                fg={theme.text.action.primary.default}
                onMouseUp={() => {
                  if (renderer.getSelection()?.getSelectedText()) return
                  openExternal()
                }}
              >
                {external().url}
              </text>
              <text
                fg={store.answers[external().key] === true ? theme.text.feedback.success.default : theme.text.subdued}
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
              <text fg={theme.text.default}>{answerField()!.description ?? formLabel(answerField()!)}</text>
            </box>
            <Show when={textual() ? answerField()!.key : undefined} keyed>
              <box paddingLeft={1}>
                <textarea
                  cursorStyle={config.cursor}
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
                  placeholderColor={theme.text.subdued}
                  minHeight={1}
                  maxHeight={6}
                  textColor={theme.text.default}
                  focusedTextColor={theme.text.default}
                  cursorColor={theme.text.default}
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
                            backgroundColor={active() ? theme.background.formfield.focused : theme.background.default}
                            paddingRight={1}
                          >
                            <text
                              fg={active() ? theme.text.formfield.focused : theme.text.subdued}
                            >{`${i() + 1}.`}</text>
                          </box>
                          <box
                            backgroundColor={active() ? theme.background.formfield.focused : theme.background.default}
                            flexDirection="row"
                          >
                            <Show when={multi()}>
                              <text
                                width={4}
                                flexShrink={0}
                                fg={
                                  active()
                                    ? theme.text.formfield.focused
                                    : picked()
                                      ? theme.text.formfield.selected
                                      : theme.text.subdued
                                }
                              >
                                [{picked() ? "✓" : " "}]
                              </text>
                            </Show>
                            <text fg={active() ? theme.text.formfield.focused : theme.text.formfield.default}>
                              {row.label}
                            </text>
                          </box>
                          <Show when={!multi()}>
                            <text fg={theme.text.formfield.selected}>{picked() ? " ✓" : ""}</text>
                          </Show>
                        </box>
                        <Show when={row.description}>
                          <box paddingLeft={multi() ? 7 : 3}>
                            <text fg={theme.text.subdued}>{row.description}</text>
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
                        backgroundColor={other() ? theme.background.formfield.focused : theme.background.default}
                        paddingRight={1}
                      >
                        <text fg={other() ? theme.text.formfield.focused : theme.text.subdued}>
                          {`${rows().length + 1}.`}
                        </text>
                      </box>
                      <box
                        flexDirection="row"
                        flexGrow={1}
                        backgroundColor={other() ? theme.background.formfield.focused : theme.background.default}
                      >
                        <Show when={multi()}>
                          <text
                            width={4}
                            flexShrink={0}
                            fg={
                              other()
                                ? theme.text.formfield.focused
                                : customChecked()
                                  ? theme.text.formfield.selected
                                  : theme.text.subdued
                            }
                          >
                            [{customChecked() ? "✓" : " "}]
                          </text>
                        </Show>
                        <Show
                          when={store.editing}
                          fallback={
                            <>
                              <text fg={other() ? theme.text.formfield.focused : theme.text.formfield.default}>
                                {input() || "Type your own answer"}
                              </text>
                              <Show when={!multi() && customPicked()}>
                                <text fg={theme.text.formfield.selected}>✓</text>
                              </Show>
                            </>
                          }
                        >
                          <textarea
                            flexGrow={1}
                            cursorStyle={config.cursor}
                            ref={(val: TextareaRenderable) => {
                              textarea = val
                              val.traits = { status: "ANSWER" }
                              queueMicrotask(() => {
                                val.setText(input())
                                val.focus()
                                val.gotoLineEnd()
                              })
                            }}
                            initialValue={input()}
                            placeholder="Type your own answer"
                            placeholderColor={theme.text.subdued}
                            minHeight={1}
                            maxHeight={6}
                            textColor={theme.text.formfield.focused}
                            focusedTextColor={theme.text.formfield.focused}
                            cursorColor={theme.text.formfield.focused}
                            onContentChange={(value) => {
                              const current = answerField()
                              if (!current || !textarea || textarea.isDestroyed) return
                              updateCustom(current, typeof value === "string" ? value : textarea.plainText)
                            }}
                          />
                        </Show>
                      </box>
                    </box>
                  </box>
                </Show>
              </box>
            </Show>
          </box>
        </Show>

        <Show when={confirm()}>
          <scrollbox
            height={reviewHeight()}
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
                        <span style={{ fg: theme.text.subdued }}>{truncate(formLabel(item), 40)}:</span>{" "}
                        <span
                          style={{
                            fg: acknowledged()
                              ? theme.text.feedback.success.default
                              : theme.text.feedback.error.default,
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
                      <span style={{ fg: theme.text.subdued }}>{truncate(formLabel(item), 40)}:</span>{" "}
                      <span
                        style={{
                          fg:
                            invalid() || missing()
                              ? theme.text.feedback.error.default
                              : answered()
                                ? theme.text.default
                                : theme.text.subdued,
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
            <text fg={theme.text.default}>
              {"⇆"} <span style={{ fg: theme.text.subdued }}>tab</span>
            </text>
          </Show>
          <Show when={!confirm() && !textual() && !externalField() && !store.editing}>
            <text fg={theme.text.default}>
              {"↑↓"} <span style={{ fg: theme.text.subdued }}>select</span>
            </text>
          </Show>
          <Show when={confirm() && reviewScrollable()}>
            <text fg={theme.text.default}>
              {"↑↓"} <span style={{ fg: theme.text.subdued }}>scroll</span>
            </text>
          </Show>
          <text
            fg={theme.text.default}
            onMouseUp={() => {
              if (renderer.getSelection()?.getSelectedText()) return
              if (confirm()) submit()
              if (externalField()) acknowledgeExternal()
            }}
          >
            enter <span style={{ fg: theme.text.subdued }}>{actionLabel()}</span>
          </text>
          <Show when={externalField()}>
            <text fg={theme.text.default} onMouseUp={copyExternal}>
              c <span style={{ fg: theme.text.subdued }}>copy</span>
            </text>
          </Show>
          <text fg={theme.text.default} onMouseUp={cancel}>
            esc <span style={{ fg: theme.text.subdued }}>{store.editing && !textual() ? "close" : "dismiss"}</span>
          </text>
        </box>
        <Show when={store.error}>
          <text fg={theme.text.feedback.error.default}>{store.error}</text>
        </Show>
      </box>
    </box>
  )
}
