import { createStore } from "solid-js/store"
import { createMemo, createSignal, For, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import type { TextareaRenderable } from "@opentui/core"
import { useKeybind } from "../../context/keybind"
import { tint, useTheme } from "../../context/theme"
import type { QuestionAnswer, QuestionRequest } from "@opencode-ai/sdk/v2"
import { useSDK } from "../../context/sdk"
import { FrameBorder } from "../../component/border"
import { useTextareaKeybindings } from "../../component/textarea-keybindings"
import { useDialog } from "../../ui/dialog"

export function QuestionPrompt(props: { request: QuestionRequest }) {
  const sdk = useSDK()
  const { theme } = useTheme()
  const keybind = useKeybind()
  const bindings = useTextareaKeybindings()

  const questions = createMemo(() => props.request.questions)
  const single = createMemo(() => questions().length === 1 && questions()[0]?.multiple !== true)
  const tabs = createMemo(() => (single() ? 1 : questions().length + 1)) // questions + confirm tab (no confirm for single select)
  const [tabHover, setTabHover] = createSignal<number | "confirm" | null>(null)
  const [store, setStore] = createStore({
    tab: 0,
    answers: [] as QuestionAnswer[],
    custom: [] as string[],
    selected: 0,
    editing: false,
  })

  let textarea: TextareaRenderable | undefined

  const question = createMemo(() => questions()[store.tab])
  const confirm = createMemo(() => !single() && store.tab === questions().length)
  const options = createMemo(() => question()?.options ?? [])
  const custom = createMemo(() => question()?.custom !== false)
  const other = createMemo(() => custom() && store.selected === options().length)
  const input = createMemo(() => store.custom[store.tab] ?? "")
  const multi = createMemo(() => question()?.multiple === true)
  const title = createMemo(() => (confirm() ? "Review your answers" : question()?.question ?? ""))
  const submitLabel = createMemo(() => (confirm() ? "submit" : multi() ? "toggle" : single() ? "submit" : "confirm"))
  const customPicked = createMemo(() => {
    const value = input()
    if (!value) return false
    return store.answers[store.tab]?.includes(value) ?? false
  })

  function submit() {
    const answers = questions().map((_, i) => store.answers[i] ?? [])
    void sdk.client.question.reply({
      requestID: props.request.id,
      answers,
    })
  }

  function reject() {
    void sdk.client.question.reject({
      requestID: props.request.id,
    })
  }

  function pick(answer: string, custom: boolean = false) {
    const answers = [...store.answers]
    answers[store.tab] = [answer]
    setStore("answers", answers)
    if (custom) {
      const inputs = [...store.custom]
      inputs[store.tab] = answer
      setStore("custom", inputs)
    }
    if (single()) {
      void sdk.client.question.reply({
        requestID: props.request.id,
        answers: [[answer]],
      })
      return
    }
    setStore("tab", store.tab + 1)
    setStore("selected", 0)
  }

  function toggle(answer: string) {
    const existing = store.answers[store.tab] ?? []
    const next = [...existing]
    const index = next.indexOf(answer)
    if (index === -1) next.push(answer)
    if (index !== -1) next.splice(index, 1)
    const answers = [...store.answers]
    answers[store.tab] = next
    setStore("answers", answers)
  }

  function moveTo(index: number) {
    setStore("selected", index)
  }

  function selectTab(index: number) {
    setStore("tab", index)
    setStore("selected", 0)
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
    const opt = options()[store.selected]
    if (!opt) return
    if (multi()) {
      toggle(opt.label)
      return
    }
    pick(opt.label)
  }

  const dialog = useDialog()

  useKeyboard((evt) => {
    // Skip processing if a dialog (e.g., command palette) is open
    if (dialog.stack.length > 0) return

    // When editing custom answer textarea
    if (store.editing && !confirm()) {
      if (evt.name === "escape") {
        evt.preventDefault()
        setStore("editing", false)
        return
      }
      if (keybind.match("input_clear", evt)) {
        evt.preventDefault()
        const text = textarea?.plainText ?? ""
        if (!text) {
          setStore("editing", false)
          return
        }
        textarea?.setText("")
        return
      }
      if (evt.name === "return") {
        evt.preventDefault()
        const text = textarea?.plainText?.trim() ?? ""
        const prev = store.custom[store.tab]

        if (!text) {
          if (prev) {
            const inputs = [...store.custom]
            inputs[store.tab] = ""
            setStore("custom", inputs)

            const answers = [...store.answers]
            answers[store.tab] = (answers[store.tab] ?? []).filter((x) => x !== prev)
            setStore("answers", answers)
          }
          setStore("editing", false)
          return
        }

        if (multi()) {
          const inputs = [...store.custom]
          inputs[store.tab] = text
          setStore("custom", inputs)

          const existing = store.answers[store.tab] ?? []
          const next = [...existing]
          if (prev) {
            const index = next.indexOf(prev)
            if (index !== -1) next.splice(index, 1)
          }
          if (!next.includes(text)) next.push(text)
          const answers = [...store.answers]
          answers[store.tab] = next
          setStore("answers", answers)
          setStore("editing", false)
          return
        }

        pick(text, true)
        setStore("editing", false)
        return
      }
      // Let textarea handle all other keys
      return
    }

    if (evt.name === "left" || evt.name === "h") {
      evt.preventDefault()
      selectTab((store.tab - 1 + tabs()) % tabs())
    }

    if (evt.name === "right" || evt.name === "l") {
      evt.preventDefault()
      selectTab((store.tab + 1) % tabs())
    }

    if (evt.name === "tab") {
      evt.preventDefault()
      const direction = evt.shift ? -1 : 1
      selectTab((store.tab + direction + tabs()) % tabs())
    }

    if (confirm()) {
      if (evt.name === "return") {
        evt.preventDefault()
        submit()
      }
      if (evt.name === "escape" || keybind.match("app_exit", evt)) {
        evt.preventDefault()
        reject()
      }
    } else {
      const opts = options()
      const total = opts.length + (custom() ? 1 : 0)
      const max = Math.min(total, 9)
      const digit = Number(evt.name)

      if (!Number.isNaN(digit) && digit >= 1 && digit <= max) {
        evt.preventDefault()
        const index = digit - 1
        moveTo(index)
        selectOption()
        return
      }

      if (evt.name === "up" || evt.name === "k") {
        evt.preventDefault()
        moveTo((store.selected - 1 + total) % total)
      }

      if (evt.name === "down" || evt.name === "j") {
        evt.preventDefault()
        moveTo((store.selected + 1) % total)
      }

      if (evt.name === "return") {
        evt.preventDefault()
        selectOption()
      }

      if (evt.name === "escape" || keybind.match("app_exit", evt)) {
        evt.preventDefault()
        reject()
      }
    }
  })

  return (
    <box
      backgroundColor="transparent"
      border={FrameBorder.border}
      borderColor={theme.border}
      customBorderChars={FrameBorder.customBorderChars}
    >
      <box gap={1} paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1}>
        <box
          border={["bottom"]}
          borderColor={theme.borderSubtle}
          customBorderChars={FrameBorder.customBorderChars}
          paddingLeft={1}
          paddingRight={1}
          paddingBottom={1}
          gap={1}
        >
          <Show when={!single()}>
            <box flexDirection="row" gap={2}>
              <For each={questions()}>
                {(q, index) => {
                  const isActive = () => index() === store.tab
                  const isAnswered = () => (store.answers[index()]?.length ?? 0) > 0
                  return (
                    <box
                      onMouseOver={() => setTabHover(index())}
                      onMouseOut={() => setTabHover(null)}
                      onMouseUp={() => selectTab(index())}
                    >
                      <text
                        fg={
                          isActive()
                            ? theme.secondary
                            : tabHover() === index()
                              ? tint(theme.textMuted, theme.text, 0.5)
                              : isAnswered()
                                ? theme.text
                                : theme.textMuted
                        }
                      >
                        {q.header}
                      </text>
                    </box>
                  )
                }}
              </For>
              <box
                onMouseOver={() => setTabHover("confirm")}
                onMouseOut={() => setTabHover(null)}
                onMouseUp={() => selectTab(questions().length)}
              >
                <text
                  fg={
                    confirm()
                      ? theme.secondary
                      : tabHover() === "confirm"
                        ? tint(theme.textMuted, theme.text, 0.5)
                        : theme.textMuted
                  }
                >
                  Review
                </text>
              </box>
            </box>
          </Show>
          <text fg={theme.text}>{title()}</text>
          <Show when={!confirm() && multi()}>
            <text fg={theme.textMuted}>Select all that apply.</text>
          </Show>
        </box>

        <Show when={!confirm()}>
          <box paddingLeft={1} paddingRight={1} gap={1}>
            <For each={options()}>
              {(opt, i) => {
                const active = () => i() === store.selected
                const picked = () => store.answers[store.tab]?.includes(opt.label) ?? false
                return (
                  <box
                    onMouseOver={() => moveTo(i())}
                    onMouseDown={() => moveTo(i())}
                    onMouseUp={() => selectOption()}
                  >
                    <box flexDirection="row" gap={1}>
                      <text fg={active() ? theme.secondary : theme.textMuted}>{active() ? "❯" : " "}</text>
                      <text fg={active() ? theme.secondary : picked() ? theme.success : theme.text}>
                        {`${i() + 1}. ${opt.label}`}
                      </text>
                      <Show when={picked()}>
                        <text fg={theme.success}>✓</text>
                      </Show>
                    </box>
                    <Show when={opt.description}>
                      <box paddingLeft={4}>
                        <text fg={theme.textMuted}>{opt.description}</text>
                      </box>
                    </Show>
                  </box>
                )
              }}
            </For>
            <Show when={custom()}>
              <box
                onMouseOver={() => moveTo(options().length)}
                onMouseDown={() => moveTo(options().length)}
                onMouseUp={() => selectOption()}
              >
                <box flexDirection="row" gap={1}>
                  <text fg={other() ? theme.secondary : theme.textMuted}>{other() ? "❯" : " "}</text>
                  <text fg={other() ? theme.secondary : customPicked() ? theme.success : theme.text}>
                    {`${options().length + 1}. Type your own answer`}
                  </text>
                  <Show when={customPicked()}>
                    <text fg={theme.success}>✓</text>
                  </Show>
                </box>
                <Show when={store.editing}>
                  <box paddingLeft={4}>
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
                      keyBindings={bindings()}
                    />
                  </box>
                </Show>
                <Show when={!store.editing && input()}>
                  <box paddingLeft={4}>
                    <text fg={theme.textMuted}>{input()}</text>
                  </box>
                </Show>
              </box>
            </Show>
          </box>
        </Show>

        <Show when={confirm() && !single()}>
          <box paddingLeft={1} paddingRight={1} gap={1}>
            <For each={questions()}>
              {(q, index) => {
                const value = () => store.answers[index()]?.join(", ") ?? ""
                const answered = () => Boolean(value())
                return (
                  <text>
                    <span style={{ fg: theme.textMuted }}>{q.header}:</span>{" "}
                    <span style={{ fg: answered() ? theme.text : theme.error }}>
                      {answered() ? value() : "(not answered)"}
                    </span>
                  </text>
                )
              }}
            </For>
          </box>
        </Show>
      </box>
      <box
        flexDirection="row"
        flexShrink={0}
        paddingLeft={2}
        paddingRight={2}
        paddingBottom={1}
      >
        <text fg={theme.textMuted}>
          <Show when={!single()}>⇆ tab • </Show>
          <Show when={!confirm()}>↑↓ to select • </Show>
          <span style={{ fg: theme.text }}>enter</span> to {submitLabel()} • <span style={{ fg: theme.text }}>esc</span>{" "}
          to dismiss
        </text>
      </box>
    </box>
  )
}
