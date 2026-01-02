import { createStore } from "solid-js/store"
import { createMemo, For, Match, Show, Switch } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { useTheme } from "../../context/theme"
import type { AskUserRequest, AskUserQuestion, AskUserAnswer } from "@opencode-ai/sdk/v2"
import { useSDK } from "../../context/sdk"
import { SplitBorder } from "../../component/border"

interface AnswerState {
  selectedIndices: number[]
  otherText: string
}

export function AskUserPrompt(props: { request: AskUserRequest }) {
  const sdk = useSDK()
  const { theme } = useTheme()
  const questions = createMemo(() => props.request.questions)

  const [store, setStore] = createStore<{
    currentQuestion: number
    answers: AnswerState[]
    showReview: boolean
    otherInputActive: boolean
  }>({
    currentQuestion: 0,
    answers: questions().map(() => ({ selectedIndices: [], otherText: "" })),
    showReview: false,
    otherInputActive: false,
  })

  const currentQ = createMemo(() => questions()[store.currentQuestion])
  const currentAnswer = createMemo(() => store.answers[store.currentQuestion])
  const optionCount = createMemo(() => (currentQ()?.options.length ?? 0) + 1)

  const isComplete = createMemo(() => {
    return store.answers.every((answer, idx) => {
      const q = questions()[idx]
      if (answer.selectedIndices.includes(q.options.length)) {
        return answer.otherText.trim().length > 0
      }
      return answer.selectedIndices.length > 0
    })
  })

  function toggleOption(optionIndex: number) {
    const q = currentQ()
    if (!q) return

    const isOther = optionIndex === q.options.length

    if (q.multiSelect) {
      setStore("answers", store.currentQuestion, "selectedIndices", (prev) => {
        if (prev.includes(optionIndex)) {
          return prev.filter((i) => i !== optionIndex)
        }
        return [...prev, optionIndex]
      })
    } else {
      setStore("answers", store.currentQuestion, "selectedIndices", [optionIndex])
    }

    if (isOther) {
      setStore("otherInputActive", true)
    } else {
      setStore("otherInputActive", false)
    }
  }

  function nextQuestion() {
    if (store.currentQuestion < questions().length - 1) {
      setStore("currentQuestion", store.currentQuestion + 1)
      setStore("otherInputActive", false)
    } else {
      setStore("showReview", true)
    }
  }

  function prevQuestion() {
    if (store.showReview) {
      setStore("showReview", false)
    } else if (store.currentQuestion > 0) {
      setStore("currentQuestion", store.currentQuestion - 1)
      setStore("otherInputActive", false)
    }
  }

  function submit() {
    const answers: AskUserAnswer[] = store.answers.map((answer, idx) => {
      const q = questions()[idx]
      const hasOther = answer.selectedIndices.includes(q.options.length)
      return {
        questionIndex: idx,
        selectedIndices: answer.selectedIndices.filter((i) => i < q.options.length),
        ...(hasOther && answer.otherText.trim() ? { otherText: answer.otherText.trim() } : {}),
      }
    })

    sdk.client.askuser.reply({
      requestID: props.request.id,
      reply: { answers },
    })
  }

  useKeyboard((evt) => {
    if (store.otherInputActive) {
      if (evt.name === "escape") {
        evt.preventDefault()
        setStore("otherInputActive", false)
        return
      }
      if (evt.name === "return") {
        evt.preventDefault()
        if (currentAnswer().otherText.trim()) {
          nextQuestion()
        }
        return
      }
      if (evt.name === "backspace") {
        evt.preventDefault()
        setStore("answers", store.currentQuestion, "otherText", (prev) => prev.slice(0, -1))
        return
      }
      if (evt.sequence && evt.sequence.length === 1 && !evt.ctrl && !evt.meta) {
        evt.preventDefault()
        setStore("answers", store.currentQuestion, "otherText", (prev) => prev + evt.sequence)
        return
      }
      return
    }

    if (store.showReview) {
      if (evt.name === "return" && isComplete()) {
        evt.preventDefault()
        submit()
        return
      }
      if (evt.name === "left" || evt.name === "h" || evt.name === "escape") {
        evt.preventDefault()
        prevQuestion()
        return
      }
      return
    }

    if (evt.name === "left" || evt.name === "h") {
      evt.preventDefault()
      prevQuestion()
      return
    }

    if (evt.name === "right" || evt.name === "l") {
      evt.preventDefault()
      nextQuestion()
      return
    }

    if (evt.name === "tab") {
      evt.preventDefault()
      if (evt.shift) {
        prevQuestion()
      } else {
        nextQuestion()
      }
      return
    }

    const numKey = parseInt(evt.sequence ?? "", 10)
    if (numKey >= 1 && numKey <= optionCount()) {
      evt.preventDefault()
      toggleOption(numKey - 1)
      return
    }

    if (evt.name === "return") {
      evt.preventDefault()
      if (currentAnswer().selectedIndices.length > 0) {
        nextQuestion()
      }
      return
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
        <box flexDirection="row" gap={1} paddingLeft={1}>
          <text fg={theme.accent}>{"?"}</text>
          <text fg={theme.text}>Question</text>
        </box>

        <QuestionTabs
          questions={questions()}
          currentIndex={store.currentQuestion}
          answers={store.answers}
          showReview={store.showReview}
        />

        <Switch>
          <Match when={store.showReview}>
            <ReviewScreen questions={questions()} answers={store.answers} />
          </Match>
          <Match when={currentQ()}>
            <QuestionView
              question={currentQ()!}
              answer={currentAnswer()}
              otherInputActive={store.otherInputActive}
            />
          </Match>
        </Switch>
      </box>

      <box
        flexDirection="row"
        flexShrink={0}
        gap={1}
        paddingTop={1}
        paddingLeft={2}
        paddingRight={3}
        paddingBottom={1}
        backgroundColor={theme.backgroundElement}
        justifyContent="space-between"
      >
        <Switch>
          <Match when={store.showReview}>
            <box flexDirection="row" gap={1}>
              <box
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={isComplete() ? theme.accent : theme.backgroundMenu}
              >
                <text fg={isComplete() ? theme.backgroundPanel : theme.textMuted}>Submit</text>
              </box>
              <box paddingLeft={1} paddingRight={1} backgroundColor={theme.backgroundMenu}>
                <text fg={theme.textMuted}>Back</text>
              </box>
            </box>
          </Match>
          <Match when={store.otherInputActive}>
            <box flexDirection="row" gap={1}>
              <text fg={theme.textMuted}>Type your response, then press Enter</text>
            </box>
          </Match>
          <Match when={true}>
            <box flexDirection="row" gap={1}>
              <For each={[1, 2, 3, 4].slice(0, optionCount())}>
                {(num) => (
                  <box paddingLeft={1} paddingRight={1} backgroundColor={theme.backgroundMenu}>
                    <text fg={theme.textMuted}>{num}</text>
                  </box>
                )}
              </For>
            </box>
          </Match>
        </Switch>

        <box flexDirection="row" gap={2}>
          <Show when={!store.otherInputActive}>
            <text fg={theme.text}>
              {"⇆"} <span style={{ fg: theme.textMuted }}>navigate</span>
            </text>
          </Show>
          <text fg={theme.text}>
            enter <span style={{ fg: theme.textMuted }}>{store.showReview ? "submit" : "confirm"}</span>
          </text>
        </box>
      </box>
    </box>
  )
}

function QuestionTabs(props: {
  questions: AskUserQuestion[]
  currentIndex: number
  answers: AnswerState[]
  showReview: boolean
}) {
  const { theme } = useTheme()

  const isAnswered = (idx: number) => {
    const answer = props.answers[idx]
    const q = props.questions[idx]
    if (answer.selectedIndices.includes(q.options.length)) {
      return answer.otherText.trim().length > 0
    }
    return answer.selectedIndices.length > 0
  }

  return (
    <box flexDirection="row" gap={1} paddingLeft={1}>
      <For each={props.questions}>
        {(q, idx) => {
          const active = () => !props.showReview && idx() === props.currentIndex
          const answered = () => isAnswered(idx())
          return (
            <box
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={active() ? theme.accent : theme.backgroundElement}
            >
              <text fg={active() ? theme.backgroundPanel : answered() ? theme.text : theme.textMuted}>
                {answered() ? "✓" : "○"} {q.header}
              </text>
            </box>
          )
        }}
      </For>
      <Show when={props.questions.length > 0}>
        <box
          paddingLeft={1}
          paddingRight={1}
          backgroundColor={props.showReview ? theme.accent : theme.backgroundElement}
        >
          <text fg={props.showReview ? theme.backgroundPanel : theme.textMuted}>Submit</text>
        </box>
      </Show>
    </box>
  )
}

function QuestionView(props: { question: AskUserQuestion; answer: AnswerState; otherInputActive: boolean }) {
  const { theme } = useTheme()
  const q = () => props.question

  return (
    <box paddingLeft={1} gap={1}>
      <text fg={theme.text}>{q().question}</text>
      <box>
        <For each={q().options}>
          {(option, idx) => {
            const selected = () => props.answer.selectedIndices.includes(idx())
            const icon = () => (q().multiSelect ? (selected() ? "☑" : "☐") : selected() ? "●" : "○")
            return (
              <box flexDirection="row" gap={1}>
                <text fg={selected() ? theme.accent : theme.textMuted}>{idx() + 1}.</text>
                <text fg={selected() ? theme.text : theme.textMuted}>
                  {icon()} {option.label}
                </text>
                <Show when={option.description}>
                  <text fg={theme.textMuted}>- {option.description}</text>
                </Show>
              </box>
            )
          }}
        </For>
        <OtherOption
          index={q().options.length}
          selected={props.answer.selectedIndices.includes(q().options.length)}
          otherText={props.answer.otherText}
          inputActive={props.otherInputActive}
          multiSelect={q().multiSelect}
        />
      </box>
    </box>
  )
}

function OtherOption(props: {
  index: number
  selected: boolean
  otherText: string
  inputActive: boolean
  multiSelect: boolean
}) {
  const { theme } = useTheme()
  const icon = () => (props.multiSelect ? (props.selected ? "☑" : "☐") : props.selected ? "●" : "○")

  return (
    <box>
      <box flexDirection="row" gap={1}>
        <text fg={props.selected ? theme.accent : theme.textMuted}>{props.index + 1}.</text>
        <text fg={props.selected ? theme.text : theme.textMuted}>{icon()} Other...</text>
      </box>
      <Show when={props.selected}>
        <box paddingLeft={3} flexDirection="row">
          <text fg={theme.accent}>{">"} </text>
          <text fg={theme.text}>
            {props.otherText}
            <Show when={props.inputActive}>
              <span style={{ bg: theme.accent, fg: theme.backgroundPanel }}> </span>
            </Show>
          </text>
        </box>
      </Show>
    </box>
  )
}

function ReviewScreen(props: { questions: AskUserQuestion[]; answers: AnswerState[] }) {
  const { theme } = useTheme()

  return (
    <box paddingLeft={1} gap={1}>
      <text fg={theme.text}>Review your answers:</text>
      <box>
        <For each={props.questions}>
          {(q, idx) => {
            const answer = () => props.answers[idx()]
            const selectedLabels = () => {
              const labels: string[] = []
              for (const i of answer().selectedIndices) {
                if (i < q.options.length) {
                  labels.push(q.options[i].label)
                }
              }
              if (answer().selectedIndices.includes(q.options.length) && answer().otherText.trim()) {
                labels.push(`Other: "${answer().otherText.trim()}"`)
              }
              return labels
            }

            return (
              <box>
                <text fg={theme.textMuted}>{q.header}:</text>
                <text fg={theme.text} paddingLeft={2}>
                  {selectedLabels().join(", ") || "(no answer)"}
                </text>
              </box>
            )
          }}
        </For>
      </box>
    </box>
  )
}
