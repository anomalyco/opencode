// Question UI body for the direct-mode footer.
//
// Renders inside the footer when the reducer pushes a FooterView of type
// "question". Supports single-question and multi-question flows:
//
//   Single question: options list with up/down selection, digit shortcuts,
//   and optional custom text input.
//
//   Multi-question: tabbed interface where each question is a tab, plus a
//   final "Confirm" tab that shows all answers for review. Tab/shift-tab
//   or left/right to navigate between questions.
//
// All state logic lives in question.shared.ts as a pure state machine.
// This component just renders it and dispatches keyboard events.
/** @jsxImportSource @opentui/solid */
import type { TextareaRenderable } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { For, Show, createEffect, createMemo, createSignal } from "solid-js"
import type { QuestionRequest } from "@opencode-ai/sdk/v2"
import {
  createQuestionBodyState,
  questionConfirm,
  questionCustom,
  questionInfo,
  questionInput,
  questionMove,
  questionOther,
  questionPicked,
  questionReject,
  questionSave,
  questionSelect,
  questionSetEditing,
  questionSetSelected,
  questionSetSubmitting,
  questionSetTab,
  questionSingle,
  questionStoreCustom,
  questionSubmit,
  questionSync,
  questionTabs,
  questionTotal,
} from "./question.shared"
import type { RunFooterTheme } from "./theme"
import type { QuestionReject, QuestionReply } from "./types"

export function RunQuestionBody(props: {
  request: QuestionRequest
  theme: RunFooterTheme
  onReply: (input: QuestionReply) => void | Promise<void>
  onReject: (input: QuestionReject) => void | Promise<void>
}) {
  const dims = useTerminalDimensions()
  const [state, setState] = createSignal(createQuestionBodyState(props.request.id))
  const single = createMemo(() => questionSingle(props.request))
  const confirm = createMemo(() => questionConfirm(props.request, state()))
  const info = createMemo(() => questionInfo(props.request, state()))
  const input = createMemo(() => questionInput(state()))
  const other = createMemo(() => questionOther(props.request, state()))
  const picked = createMemo(() => questionPicked(state()))
  const disabled = createMemo(() => state().submitting)
  const narrow = createMemo(() => dims().width < 80)
  const verb = createMemo(() => {
    if (confirm()) {
      return "submit"
    }

    if (info()?.multiple) {
      return "toggle"
    }

    if (single()) {
      return "submit"
    }

    return "confirm"
  })
  let area: TextareaRenderable | undefined

  createEffect(() => {
    setState((prev) => questionSync(prev, props.request.id))
  })

  const setTab = (tab: number) => {
    setState((prev) => questionSetTab(prev, tab))
  }

  const move = (dir: -1 | 1) => {
    setState((prev) => questionMove(prev, props.request, dir))
  }

  const beginReply = async (input: QuestionReply) => {
    setState((prev) => questionSetSubmitting(prev, true))

    try {
      await props.onReply(input)
    } catch {
      setState((prev) => questionSetSubmitting(prev, false))
    }
  }

  const beginReject = async (input: QuestionReject) => {
    setState((prev) => questionSetSubmitting(prev, true))

    try {
      await props.onReject(input)
    } catch {
      setState((prev) => questionSetSubmitting(prev, false))
    }
  }

  const saveCustom = () => {
    const cur = state()
    const next = questionSave(cur, props.request)
    if (next.state !== cur) {
      setState(next.state)
    }

    if (!next.reply) {
      return
    }

    void beginReply(next.reply)
  }

  const choose = (selected: number) => {
    const base = state()
    const cur = questionSetSelected(base, selected)
    const next = questionSelect(cur, props.request)
    if (next.state !== base) {
      setState(next.state)
    }

    if (!next.reply) {
      return
    }

    void beginReply(next.reply)
  }

  const mark = (selected: number) => {
    setState((prev) => questionSetSelected(prev, selected))
  }

  const select = () => {
    const cur = state()
    const next = questionSelect(cur, props.request)
    if (next.state !== cur) {
      setState(next.state)
    }

    if (!next.reply) {
      return
    }

    void beginReply(next.reply)
  }

  const submit = () => {
    void beginReply(questionSubmit(props.request, state()))
  }

  const reject = () => {
    void beginReject(questionReject(props.request))
  }

  useKeyboard((event) => {
    const cur = state()
    if (cur.submitting) {
      event.preventDefault()
      return
    }

    if (cur.editing) {
      if (event.name === "escape") {
        setState((prev) => questionSetEditing(prev, false))
        event.preventDefault()
        return
      }

      if (event.name === "return" && !event.shift && !event.ctrl && !event.meta) {
        saveCustom()
        event.preventDefault()
      }
      return
    }

    if (!single() && (event.name === "left" || event.name === "h")) {
      setTab((cur.tab - 1 + questionTabs(props.request)) % questionTabs(props.request))
      event.preventDefault()
      return
    }

    if (!single() && (event.name === "right" || event.name === "l")) {
      setTab((cur.tab + 1) % questionTabs(props.request))
      event.preventDefault()
      return
    }

    if (!single() && event.name === "tab") {
      const dir = event.shift ? -1 : 1
      setTab((cur.tab + dir + questionTabs(props.request)) % questionTabs(props.request))
      event.preventDefault()
      return
    }

    if (questionConfirm(props.request, cur)) {
      if (event.name === "return") {
        submit()
        event.preventDefault()
        return
      }

      if (event.name === "escape") {
        reject()
        event.preventDefault()
      }
      return
    }

    const total = questionTotal(props.request, cur)
    const max = Math.min(total, 9)
    const digit = Number(event.name)
    if (!Number.isNaN(digit) && digit >= 1 && digit <= max) {
      choose(digit - 1)
      event.preventDefault()
      return
    }

    if (event.name === "up" || event.name === "k") {
      move(-1)
      event.preventDefault()
      return
    }

    if (event.name === "down" || event.name === "j") {
      move(1)
      event.preventDefault()
      return
    }

    if (event.name === "return") {
      select()
      event.preventDefault()
      return
    }

    if (event.name === "escape") {
      reject()
      event.preventDefault()
    }
  })

  createEffect(() => {
    if (!state().editing || !area || area.isDestroyed) {
      return
    }

    if (area.plainText !== input()) {
      area.setText(input())
      area.cursorOffset = input().length
    }

    queueMicrotask(() => {
      if (!area || area.isDestroyed || !state().editing) {
        return
      }

      area.focus()
      area.cursorOffset = area.plainText.length
    })
  })

  return (
    <box id="run-direct-footer-question-body" width="100%" height="100%" flexDirection="column">
      <box
        id="run-direct-footer-question-panel"
        flexDirection="column"
        gap={1}
        paddingLeft={1}
        paddingRight={3}
        paddingTop={1}
        flexGrow={1}
        flexShrink={1}
        backgroundColor={props.theme.surface}
      >
        <Show when={!single()}>
          <box id="run-direct-footer-question-tabs" flexDirection="row" gap={1} paddingLeft={1} flexShrink={0}>
            <For each={props.request.questions}>
              {(item, index) => {
                const active = () => state().tab === index()
                const answered = () => (state().answers[index()]?.length ?? 0) > 0
                return (
                  <box
                    id={`run-direct-footer-question-tab-${index()}`}
                    paddingLeft={1}
                    paddingRight={1}
                    backgroundColor={active() ? props.theme.highlight : props.theme.surface}
                    onMouseUp={() => {
                      if (!disabled()) setTab(index())
                    }}
                  >
                    <text fg={active() ? props.theme.surface : answered() ? props.theme.text : props.theme.muted}>
                      {item.header}
                    </text>
                  </box>
                )
              }}
            </For>
            <box
              id="run-direct-footer-question-tab-confirm"
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={confirm() ? props.theme.highlight : props.theme.surface}
              onMouseUp={() => {
                if (!disabled()) setTab(props.request.questions.length)
              }}
            >
              <text fg={confirm() ? props.theme.surface : props.theme.muted}>Confirm</text>
            </box>
          </box>
        </Show>

        <Show
          when={!confirm()}
          fallback={
            <box width="100%" flexGrow={1} flexShrink={1} paddingLeft={1}>
              <scrollbox
                width="100%"
                height="100%"
                verticalScrollbarOptions={{
                  trackOptions: {
                    backgroundColor: props.theme.surface,
                    foregroundColor: props.theme.line,
                  },
                }}
              >
                <box width="100%" flexDirection="column" gap={1}>
                  <box paddingLeft={1}>
                    <text fg={props.theme.text}>Review</text>
                  </box>
                  <For each={props.request.questions}>
                    {(item, index) => {
                      const value = () => state().answers[index()]?.join(", ") ?? ""
                      const answered = () => Boolean(value())
                      return (
                        <box paddingLeft={1}>
                          <text wrapMode="word">
                            <span style={{ fg: props.theme.muted }}>{item.header}:</span>{" "}
                            <span style={{ fg: answered() ? props.theme.text : props.theme.error }}>
                              {answered() ? value() : "(not answered)"}
                            </span>
                          </text>
                        </box>
                      )
                    }}
                  </For>
                </box>
              </scrollbox>
            </box>
          }
        >
          <box width="100%" flexGrow={1} flexShrink={1} paddingLeft={1} gap={1}>
            <box>
              <text fg={props.theme.text} wrapMode="word">
                {info()?.question}
                {info()?.multiple ? " (select all that apply)" : ""}
              </text>
            </box>

            <box flexGrow={1} flexShrink={1}>
              <scrollbox
                width="100%"
                height="100%"
                verticalScrollbarOptions={{
                  trackOptions: {
                    backgroundColor: props.theme.surface,
                    foregroundColor: props.theme.line,
                  },
                }}
              >
                <box width="100%" flexDirection="column">
                  <For each={info()?.options ?? []}>
                    {(item, index) => {
                      const active = () => state().selected === index()
                      const hit = () => state().answers[state().tab]?.includes(item.label) ?? false
                      return (
                        <box
                          id={`run-direct-footer-question-option-${index()}`}
                          flexDirection="column"
                          gap={0}
                          onMouseOver={() => {
                            if (!disabled()) {
                              mark(index())
                            }
                          }}
                          onMouseDown={() => {
                            if (!disabled()) {
                              mark(index())
                            }
                          }}
                          onMouseUp={() => {
                            if (!disabled()) {
                              choose(index())
                            }
                          }}
                        >
                          <box flexDirection="row">
                            <box backgroundColor={active() ? props.theme.line : undefined} paddingRight={1}>
                              <text fg={active() ? props.theme.highlight : props.theme.muted}>{`${index() + 1}.`}</text>
                            </box>
                            <box backgroundColor={active() ? props.theme.line : undefined}>
                              <text
                                fg={active() ? props.theme.highlight : hit() ? props.theme.success : props.theme.text}
                              >
                                {info()?.multiple ? `[${hit() ? "✓" : " "}] ${item.label}` : item.label}
                              </text>
                            </box>
                            <Show when={!info()?.multiple}>
                              <text fg={props.theme.success}>{hit() ? "✓" : ""}</text>
                            </Show>
                          </box>
                          <box paddingLeft={3}>
                            <text fg={props.theme.muted} wrapMode="word">
                              {item.description}
                            </text>
                          </box>
                        </box>
                      )
                    }}
                  </For>

                  <Show when={questionCustom(props.request, state())}>
                    <box
                      id="run-direct-footer-question-option-custom"
                      flexDirection="column"
                      gap={0}
                      onMouseOver={() => {
                        if (!disabled()) {
                          mark(info()?.options.length ?? 0)
                        }
                      }}
                      onMouseDown={() => {
                        if (!disabled()) {
                          mark(info()?.options.length ?? 0)
                        }
                      }}
                      onMouseUp={() => {
                        if (!disabled()) {
                          choose(info()?.options.length ?? 0)
                        }
                      }}
                    >
                      <box flexDirection="row">
                        <box backgroundColor={other() ? props.theme.line : undefined} paddingRight={1}>
                          <text
                            fg={other() ? props.theme.highlight : props.theme.muted}
                          >{`${(info()?.options.length ?? 0) + 1}.`}</text>
                        </box>
                        <box backgroundColor={other() ? props.theme.line : undefined}>
                          <text
                            fg={other() ? props.theme.highlight : picked() ? props.theme.success : props.theme.text}
                          >
                            {info()?.multiple
                              ? `[${picked() ? "✓" : " "}] Type your own answer`
                              : "Type your own answer"}
                          </text>
                        </box>
                        <Show when={!info()?.multiple}>
                          <text fg={props.theme.success}>{picked() ? "✓" : ""}</text>
                        </Show>
                      </box>
                      <Show
                        when={state().editing}
                        fallback={
                          <Show when={input()}>
                            <box paddingLeft={3}>
                              <text fg={props.theme.muted} wrapMode="word">
                                {input()}
                              </text>
                            </box>
                          </Show>
                        }
                      >
                        <box paddingLeft={3}>
                          <textarea
                            id="run-direct-footer-question-custom"
                            width="100%"
                            minHeight={1}
                            maxHeight={4}
                            wrapMode="word"
                            placeholder="Type your own answer"
                            placeholderColor={props.theme.muted}
                            textColor={props.theme.text}
                            focusedTextColor={props.theme.text}
                            backgroundColor={props.theme.surface}
                            focusedBackgroundColor={props.theme.surface}
                            cursorColor={props.theme.text}
                            focused={!disabled()}
                            onContentChange={() => {
                              if (!area || area.isDestroyed || disabled()) {
                                return
                              }

                              const text = area.plainText
                              setState((prev) => questionStoreCustom(prev, prev.tab, text))
                            }}
                            ref={(item) => {
                              area = item
                            }}
                          />
                        </box>
                      </Show>
                    </box>
                  </Show>
                </box>
              </scrollbox>
            </box>
          </box>
        </Show>
      </box>

      <box
        id="run-direct-footer-question-actions"
        flexDirection={narrow() ? "column" : "row"}
        flexShrink={0}
        gap={1}
        paddingLeft={2}
        paddingRight={3}
        paddingBottom={1}
        justifyContent={narrow() ? "flex-start" : "space-between"}
        alignItems={narrow() ? "flex-start" : "center"}
      >
        <Show
          when={!disabled()}
          fallback={
            <text fg={props.theme.muted} wrapMode="word">
              Waiting for question event...
            </text>
          }
        >
          <box
            flexDirection={narrow() ? "column" : "row"}
            gap={narrow() ? 1 : 2}
            flexShrink={0}
            width={narrow() ? "100%" : undefined}
          >
            <Show
              when={!state().editing}
              fallback={
                <>
                  <text fg={props.theme.text}>
                    enter <span style={{ fg: props.theme.muted }}>save</span>
                  </text>
                  <text fg={props.theme.text}>
                    esc <span style={{ fg: props.theme.muted }}>cancel</span>
                  </text>
                </>
              }
            >
              <Show when={!single()}>
                <text fg={props.theme.text}>
                  {"⇆"} <span style={{ fg: props.theme.muted }}>tab</span>
                </text>
              </Show>
              <Show when={!confirm()}>
                <text fg={props.theme.text}>
                  {"↑↓"} <span style={{ fg: props.theme.muted }}>select</span>
                </text>
              </Show>
              <text fg={props.theme.text}>
                enter <span style={{ fg: props.theme.muted }}>{verb()}</span>
              </text>
              <text fg={props.theme.text}>
                esc <span style={{ fg: props.theme.muted }}>dismiss</span>
              </text>
            </Show>
          </box>
        </Show>
      </box>
    </box>
  )
}
