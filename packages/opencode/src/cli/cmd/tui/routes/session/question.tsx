import { createStore } from "solid-js/store"
import { createMemo, For, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import type { TextareaRenderable } from "@opentui/core"
import { useKeybind } from "../../context/keybind"
import { useTheme } from "../../context/theme"
import type { QuestionRequest } from "@opencode-ai/sdk/v2"
import { useSDK } from "../../context/sdk"
import { SplitBorder } from "../../component/border"
import { useTextareaKeybindings } from "../../component/textarea-keybindings"
import { useDialog } from "../../ui/dialog"

export function QuestionPrompt(props: { request: QuestionRequest }) {
  const sdk = useSDK()
  const { theme } = useTheme()
  const keybind = useKeybind()
  const bindings = useTextareaKeybindings()

  const questions = createMemo(() => props.request.questions)
  const single = createMemo(() => questions().length === 1)
  const tabs = createMemo(() => (single() ? 1 : questions().length + 1)) // questions + confirm tab (no confirm for single)
  const [store, setStore] = createStore({
    tab: 0,
    answers: [] as string[],
    custom: [] as string[],
    selected: 0,
    editing: false,
  })

  let textarea: TextareaRenderable | undefined

  const question = createMemo(() => questions()[store.tab])
  const confirm = createMemo(() => !single() && store.tab === questions().length)
  const options = createMemo(() => question()?.options ?? [])
  const other = createMemo(() => store.selected === options().length)
  const input = createMemo(() => store.custom[store.tab] ?? "")

  function submit() {
    // Fill in empty answers with empty strings
    const answers = questions().map((_, i) => store.answers[i] ?? "")
    sdk.client.question.reply({
      requestID: props.request.id,
      answers,
    })
  }

  function reject() {
    sdk.client.question.reject({
      requestID: props.request.id,
    })
  }

  function pick(answer: string, custom: boolean = false) {
    const answers = [...store.answers]
    answers[store.tab] = answer
    setStore("answers", answers)
    if (custom) {
      const inputs = [...store.custom]
      inputs[store.tab] = answer
      setStore("custom", inputs)
    }
    if (single()) {
      sdk.client.question.reply({
        requestID: props.request.id,
        answers: [answer],
      })
      return
    }
    setStore("tab", store.tab + 1)
    setStore("selected", 0)
  }

  const dialog = useDialog()

  useKeyboard((evt) => {
    // When editing "Other" textarea
    if (store.editing && !confirm()) {
      if (evt.name === "escape") {
        evt.preventDefault()
        setStore("editing", false)
        return
      }
      if (evt.name === "return") {
        evt.preventDefault()
        const text = textarea?.plainText?.trim()
        if (text) {
          pick(text, true)
          setStore("editing", false)
        }
        return
      }
      // Let textarea handle all other keys
      return
    }

    if (evt.name === "left" || evt.name === "h") {
      evt.preventDefault()
      const next = (store.tab - 1 + tabs()) % tabs()
      setStore("tab", next)
      setStore("selected", 0)
    }

    if (evt.name === "right" || evt.name === "l") {
      evt.preventDefault()
      const next = (store.tab + 1) % tabs()
      setStore("tab", next)
      setStore("selected", 0)
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
      const total = opts.length + 1 // options + "Other"

      if (evt.name === "up" || evt.name === "k") {
        evt.preventDefault()
        setStore("selected", (store.selected - 1 + total) % total)
      }

      if (evt.name === "down" || evt.name === "j") {
        evt.preventDefault()
        setStore("selected", (store.selected + 1) % total)
      }

      if (evt.name === "return") {
        evt.preventDefault()
        if (other()) {
          setStore("editing", true)
        } else {
          const opt = opts[store.selected]
          if (opt) {
            pick(opt.label)
          }
        }
      }

      if (evt.name === "escape" || keybind.match("app_exit", evt)) {
        evt.preventDefault()
        reject()
      }
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
        <Show when={!single()}>
          <box flexDirection="row" gap={1} paddingLeft={1}>
            <For each={questions()}>
              {(q, index) => {
                const isActive = () => index() === store.tab
                const isAnswered = () => store.answers[index()] !== undefined
                return (
                  <box
                    paddingLeft={1}
                    paddingRight={1}
                    backgroundColor={isActive() ? theme.accent : theme.backgroundElement}
                  >
                    <text fg={isActive() ? theme.selectedListItemText : isAnswered() ? theme.text : theme.textMuted}>
                      {q.header}
                    </text>
                  </box>
                )
              }}
            </For>
            <box paddingLeft={1} paddingRight={1} backgroundColor={confirm() ? theme.accent : theme.backgroundElement}>
              <text fg={confirm() ? theme.selectedListItemText : theme.textMuted}>Confirm</text>
            </box>
          </box>
        </Show>

        <Show when={!confirm()}>
          <box paddingLeft={1} gap={1}>
            <box>
              <text fg={theme.text}>{question()?.question}</text>
            </box>
            <box>
              <For each={options()}>
                {(opt, i) => {
                  const active = () => i() === store.selected
                  const picked = () => store.answers[store.tab] === opt.label
                  return (
                    <box>
                      <box flexDirection="row" gap={1}>
                        <box backgroundColor={active() ? theme.backgroundElement : undefined}>
                          <text fg={active() ? theme.secondary : picked() ? theme.success : theme.text}>
                            {i() + 1}. {opt.label}
                          </text>
                        </box>
                        <text fg={theme.success}>{picked() ? "✓" : ""}</text>
                      </box>
                      <box paddingLeft={3}>
                        <text fg={theme.textMuted}>{opt.description}</text>
                      </box>
                    </box>
                  )
                }}
              </For>
              <box>
                <box flexDirection="row" gap={1}>
                  <box backgroundColor={other() ? theme.backgroundElement : undefined}>
                    <text fg={other() ? theme.secondary : input() ? theme.success : theme.text}>
                      {options().length + 1}. Type your own answer
                    </text>
                  </box>
                  <text fg={theme.success}>{input() ? "✓" : ""}</text>
                </box>
                <Show when={store.editing}>
                  <box paddingLeft={3}>
                    <textarea
                      ref={(val: TextareaRenderable) => (textarea = val)}
                      focused
                      placeholder="Type your own answer"
                      textColor={theme.text}
                      focusedTextColor={theme.text}
                      cursorColor={theme.primary}
                      keyBindings={bindings()}
                    />
                  </box>
                </Show>
                <Show when={!store.editing && input()}>
                  <box paddingLeft={3}>
                    <text fg={theme.textMuted}>{input()}</text>
                  </box>
                </Show>
              </box>
            </box>
          </box>
        </Show>

        <Show when={confirm() && !single()}>
          <box paddingLeft={1}>
            <text fg={theme.text}>Review</text>
          </box>
          <For each={questions()}>
            {(q, index) => {
              const answer = () => store.answers[index()]
              return (
                <box flexDirection="row" gap={1} paddingLeft={1}>
                  <text fg={theme.textMuted}>{q.header}:</text>
                  <text fg={answer() ? theme.text : theme.error}>{answer() ?? "(not answered)"}</text>
                </box>
              )
            }}
          </For>
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
          <Show when={!confirm()}>
            <text fg={theme.text}>
              {"↑↓"} <span style={{ fg: theme.textMuted }}>select</span>
            </text>
          </Show>
          <text fg={theme.text}>
            enter <span style={{ fg: theme.textMuted }}>{confirm() ? "submit" : single() ? "submit" : "confirm"}</span>
          </text>
          <text fg={theme.text}>
            esc <span style={{ fg: theme.textMuted }}>dismiss</span>
          </text>
        </box>
      </box>
    </box>
  )
}
