import { TextareaRenderable, TextAttributes } from "@opentui/core"
import { useTheme, selectedForeground } from "@tui/context/theme"
import { createEffect, createMemo, createSignal, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useKeyboard } from "@opentui/solid"
import { useDialog, type DialogContext } from "@tui/ui/dialog"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import type { Question } from "@/question"

// Types
interface Answer {
  value: string | string[] | boolean | null
  comment?: string
}

type Answers = Record<string, Answer>

interface QuestionDialogProps {
  question: Question.Info
  onSubmit: (answers: Answers) => void
  onCancel: () => void
  initialAnswers?: Answers
}

interface SingleQuestionProps {
  item: Question.QuestionItem
  currentAnswer?: Answer
  onAnswer: (answer: Answer) => void
  onCancel: () => void
  onSubmitAll: (answer: Answer) => void
}

// Main DialogQuestion - shows list of all questions
export function DialogQuestion(props: QuestionDialogProps) {
  const dialog = useDialog()
  const [answers, setAnswers] = createStore<Answers>(props.initialAnswers ?? {})

  const questions = () => props.question.questions
  const answeredCount = () =>
    Object.keys(answers).filter((k) => answers[k]?.value !== undefined && answers[k]?.value !== null).length

  onMount(() => {
    dialog.setSize("medium")
  })

  function openQuestion(item: Question.QuestionItem) {
    const Component = {
      select: DialogQuestionSelect,
      "multi-select": DialogQuestionMultiSelect,
      confirm: DialogQuestionConfirm,
      text: DialogQuestionText,
    }[item.type]

    dialog.push(() => (
      <Component
        item={item}
        currentAnswer={answers[item.id]}
        onAnswer={(answer) => {
          setAnswers(item.id, answer)
          // Sync to initialAnswers if provided
          if (props.initialAnswers) {
            props.initialAnswers[item.id] = answer
          }
          dialog.pop()
        }}
        onCancel={() => dialog.pop()}
        onSubmitAll={(answer) => {
          setAnswers(item.id, answer)
          submit({ ...answers, [item.id]: answer })
        }}
      />
    ))
  }

  function submit(finalAnswers?: Answers) {
    props.onSubmit(finalAnswers ?? answers)
  }

  // Convert questions to DialogSelect options
  const selectOptions = createMemo<DialogSelectOption<Question.QuestionItem>[]>(() => {
    // Access all keys to subscribe to any changes
    const answerKeys = Object.keys(answers)

    return questions().map((item) => {
      const answer = answers[item.id]
      const answerPreview = formatAnswerPreview(item, answer)
      const comment = answer?.comment ? ` 💬 "${truncate(answer.comment, 30)}"` : ""

      return {
        title: item.question,
        value: item,
        description: answerPreview + comment,
        onSelect: (ctx) => openQuestion(item),
      }
    })
  })

  // Handle submission with ctrl+enter keybind
  useKeyboard((evt) => {
    if (evt.ctrl && evt.name === "return") {
      evt.preventDefault()
      submit()
      return
    }
  })

  return (
    <DialogSelect
      title={`Questions (${answeredCount()}/${questions().length} answered)`}
      options={selectOptions()}
      hideSearch={true}
      keybind={[
        {
          keybind: { name: "return", ctrl: false, meta: false, shift: false, super: false, leader: false },
          title: "open question",
          onTrigger: (option) => {
            if (option.onSelect) option.onSelect(dialog)
          },
        },
        {
          keybind: { name: "return", ctrl: true, meta: false, shift: false, super: false, leader: false },
          title: "submit",
          onTrigger: (option) => {
            submit()
            return false
          },
        },
      ]}
    />
  )
}

// Single Select Question Dialog
function DialogQuestionSelect(props: SingleQuestionProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const [comment, setComment] = createSignal<string | undefined>(props.currentAnswer?.comment)

  // Sort options with recommended first
  const sortedOptions = createMemo(() => {
    const opts = props.item.options ?? []
    return [...opts].sort((a, b) => (b.recommended ? 1 : 0) - (a.recommended ? 1 : 0))
  })

  // Find current selection value
  const currentValue = createMemo(() => props.currentAnswer?.value)

  onMount(() => {
    dialog.setSize("medium")
  })

  function openComment() {
    dialog.push(() => (
      <DialogQuestionComment
        value={comment()}
        onSave={(c) => {
          const trimmedComment = c.trim() || undefined
          setComment(trimmedComment)
          // Save comment to store immediately, keeping current value
          props.onAnswer({
            value: props.currentAnswer?.value ?? null,
            comment: trimmedComment,
          })
          // dialog.pop()
        }}
        onCancel={() => dialog.pop()}
      />
    ))
  }

  function confirmSelection(option: { value: string; label: string; recommended?: boolean }) {
    props.onAnswer({ value: option.value, comment: comment() })
  }

  function submitAll(option: { value: string; label: string; recommended?: boolean }) {
    props.onSubmitAll({ value: option.value, comment: comment() })
  }

  // Convert options to DialogSelectOption format
  const selectOptions = createMemo<DialogSelectOption<{ value: string; label: string; recommended?: boolean }>[]>(() =>
    sortedOptions().map((option) => ({
      title: option.label,
      value: option,
      footer: option.recommended ? "(Recommended)" : undefined,
      onSelect: () => confirmSelection(option),
    })),
  )

  // Show default as hint if present
  const defaultHint = createMemo(() => {
    if (typeof props.item.default === "string") {
      const opt = props.item.options?.find((o) => o.value === props.item.default)
      return opt?.label
    }
    return undefined
  })

  return (
    <>
      <Show when={defaultHint()}>
        <box paddingLeft={4} paddingRight={4} paddingTop={1}>
          <text fg={theme.textMuted}>Default: {defaultHint()}</text>
        </box>
      </Show>
      <DialogSelect
        title={props.item.question}
        options={selectOptions()}
        current={sortedOptions().find((o) => o.value === currentValue())}
        hideSearch={true}
        keybind={[
          {
            keybind: { name: "m", ctrl: false, meta: false, shift: false, super: false, leader: false },
            title: "add comment",
            onTrigger: () => openComment(),
          },
          {
            keybind: { name: "s", ctrl: false, meta: false, shift: false, super: false, leader: false },
            title: "submit all",
            onTrigger: (option) => submitAll(option.value),
          },
        ]}
      />
      <Show when={comment()}>
        <box paddingLeft={4} paddingRight={4}>
          <text fg={theme.textMuted}>💬 "{truncate(comment()!, 40)}"</text>
        </box>
      </Show>
    </>
  )
}

// Multi-Select Question Dialog
function DialogQuestionMultiSelect(props: SingleQuestionProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const [checked, setChecked] = createStore<Record<string, boolean>>({})
  const [comment, setComment] = createSignal<string | undefined>(props.currentAnswer?.comment)

  // Sort options with recommended first
  const sortedOptions = createMemo(() => {
    const opts = props.item.options ?? []
    return [...opts].sort((a, b) => (b.recommended ? 1 : 0) - (a.recommended ? 1 : 0))
  })

  // Initialize checked state from current answer
  createEffect(() => {
    if (Array.isArray(props.currentAnswer?.value)) {
      for (const v of props.currentAnswer.value) {
        setChecked(v, true)
      }
    }
  })

  onMount(() => {
    dialog.setSize("medium")
  })

  function openComment() {
    dialog.push(() => (
      <DialogQuestionComment
        value={comment()}
        onSave={(c) => {
          const trimmedComment = c.trim() || undefined
          setComment(trimmedComment)
          // Update comment in store without closing the question dialog
          props.onAnswer({
            value: props.currentAnswer?.value ?? [],
            comment: trimmedComment,
          })
          // dialog.pop()
        }}
        onCancel={() => dialog.pop()}
      />
    ))
  }

  function getSelectedValues(): string[] {
    return sortedOptions()
      .filter((o) => checked[o.value])
      .map((o) => o.value)
  }

  function confirmSelection() {
    props.onAnswer({ value: getSelectedValues(), comment: comment() })
  }

  function submitAll() {
    props.onSubmitAll({ value: getSelectedValues(), comment: comment() })
  }

  // Convert options to DialogSelectOption format
  const selectOptions = createMemo<DialogSelectOption<{ value: string; label: string; recommended?: boolean }>[]>(() =>
    sortedOptions().map((option) => ({
      title: option.label,
      value: option,
      footer: checked[option.value] ? "☑" : "☐",
      onSelect: () => {}, // Don't close on select
    })),
  )

  const selectedCount = createMemo(() => getSelectedValues().length)

  return (
    <>
      <box paddingLeft={4} paddingRight={4} paddingTop={1}>
        <text fg={theme.textMuted}>{selectedCount()} selected</text>
      </box>
      <DialogSelect
        title={props.item.question}
        options={selectOptions()}
        hideSearch={true}
        onSelect={() => confirmSelection()}
        keybind={[
          {
            keybind: { name: "space", ctrl: false, meta: false, shift: false, super: false, leader: false },
            title: "toggle",
            onTrigger: (option) => setChecked(option.value.value, !checked[option.value.value]),
          },
          {
            keybind: { name: "m", ctrl: false, meta: false, shift: false, super: false, leader: false },
            title: "add comment",
            onTrigger: () => openComment(),
          },
          {
            keybind: { name: "s", ctrl: false, meta: false, shift: false, super: false, leader: false },
            title: "submit all",
            onTrigger: () => submitAll(),
          },
        ]}
      />
      <Show when={comment()}>
        <box paddingLeft={4} paddingRight={4}>
          <text fg={theme.textMuted}>💬 "{truncate(comment()!, 40)}"</text>
        </box>
      </Show>
    </>
  )
}

// Confirm (Yes/No) Question Dialog
function DialogQuestionConfirm(props: SingleQuestionProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const [selected, setSelected] = createSignal<boolean | null>(
    typeof props.currentAnswer?.value === "boolean" ? props.currentAnswer.value : null,
  )
  const [comment, setComment] = createSignal<string | undefined>(props.currentAnswer?.comment)

  onMount(() => {
    dialog.setSize("medium")
  })

  function openComment() {
    dialog.push(() => (
      <DialogQuestionComment
        value={comment()}
        onSave={(c) => {
          const trimmedComment = c.trim() || undefined
          setComment(trimmedComment)
          // Update comment in store without closing the question dialog
          props.onAnswer({
            value: props.currentAnswer?.value ?? null,
            comment: trimmedComment,
          })
          // dialog.pop()
        }}
        onCancel={() => dialog.pop()}
      />
    ))
  }

  function confirmSelection() {
    if (selected() !== null) {
      props.onAnswer({ value: selected(), comment: comment() })
    }
  }

  function submitAll() {
    if (selected() !== null) {
      props.onSubmitAll({ value: selected(), comment: comment() })
    }
  }

  useKeyboard((evt) => {
    if (evt.name === "up" || evt.name === "left" || (evt.ctrl && evt.name === "p")) {
      setSelected(true)
      evt.preventDefault()
    } else if (evt.name === "down" || evt.name === "right" || (evt.ctrl && evt.name === "n")) {
      setSelected(false)
      evt.preventDefault()
    } else if (evt.name === "return" && !evt.ctrl) {
      confirmSelection()
      evt.preventDefault()
    } else if (evt.ctrl && evt.name === "return") {
      submitAll()
      evt.preventDefault()
    } else if (evt.name === "c" && !evt.ctrl) {
      openComment()
      evt.preventDefault()
    } else if (evt.name === "y") {
      setSelected(true)
      evt.preventDefault()
    } else if (evt.name === "n") {
      setSelected(false)
      evt.preventDefault()
    }
  })

  // Show default as hint
  const defaultHint = createMemo(() => {
    if (typeof props.item.default === "boolean") {
      return props.item.default ? "Yes" : "No"
    }
    return undefined
  })

  return (
    <box gap={1} paddingBottom={1}>
      <box paddingLeft={4} paddingRight={4}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            {props.item.question}
          </text>
          <text fg={theme.textMuted}>esc</text>
        </box>
        <Show when={defaultHint()}>
          <text fg={theme.textMuted}>Default: {defaultHint()}</text>
        </Show>
      </box>
      <box paddingLeft={3} paddingRight={3} flexDirection="row" gap={2}>
        <box
          paddingLeft={2}
          paddingRight={2}
          backgroundColor={selected() === true ? theme.primary : undefined}
          onMouseUp={() => {
            setSelected(true)
            confirmSelection()
          }}
        >
          <text
            fg={selected() === true ? selectedForeground(theme) : theme.text}
            attributes={selected() === true ? TextAttributes.BOLD : undefined}
          >
            Yes
          </text>
        </box>
        <box
          paddingLeft={2}
          paddingRight={2}
          backgroundColor={selected() === false ? theme.primary : undefined}
          onMouseUp={() => {
            setSelected(false)
            confirmSelection()
          }}
        >
          <text
            fg={selected() === false ? selectedForeground(theme) : theme.text}
            attributes={selected() === false ? TextAttributes.BOLD : undefined}
          >
            No
          </text>
        </box>
      </box>
      <Show when={comment()}>
        <box paddingLeft={4} paddingRight={4}>
          <text fg={theme.textMuted}>
            {"\uD83D\uDCAC"} "{truncate(comment()!, 40)}"
          </text>
        </box>
      </Show>
      <box paddingRight={2} paddingLeft={4} flexDirection="row" gap={2} flexShrink={0} paddingTop={1}>
        <text>
          <span style={{ fg: theme.text }}>
            <b>y/n</b>{" "}
          </span>
          <span style={{ fg: theme.textMuted }}>select</span>
        </text>
        <text>
          <span style={{ fg: theme.text }}>
            <b>enter</b>{" "}
          </span>
          <span style={{ fg: theme.textMuted }}>confirm</span>
        </text>
        <text>
          <span style={{ fg: theme.text }}>
            <b>c</b>{" "}
          </span>
          <span style={{ fg: theme.textMuted }}>comment</span>
        </text>
      </box>
    </box>
  )
}

// Text Input Question Dialog
function DialogQuestionText(props: SingleQuestionProps) {
  const placeholder = typeof props.item.default === "string" ? props.item.default : "Enter your response..."
  const initialValue = typeof props.currentAnswer?.value === "string" ? props.currentAnswer.value : ""

  return (
    <DialogPrompt
      title={props.item.question}
      placeholder={placeholder}
      value={initialValue}
      onConfirm={(value) => {
        const trimmedValue = value.trim()
        props.onAnswer({ value: trimmedValue || null })
      }}
      onCancel={() => props.onCancel()}
    />
  )
}

// Comment Dialog (nested)
function DialogQuestionComment(props: { value?: string; onSave: (comment: string) => void; onCancel: () => void }) {
  const { theme } = useTheme()

  return (
    <DialogPrompt
      title="Add Comment"
      description={() => <text fg={theme.textMuted}>Add additional context to your answer:</text>}
      placeholder="Optional comment..."
      value={props.value}
      onConfirm={(value) => props.onSave(value)}
      onCancel={() => props.onCancel()}
    />
  )
}

// Static method to show the dialog
DialogQuestion.show = (
  dialog: DialogContext,
  question: Question.Info,
): Promise<{ answers: Answers; cancelled: boolean }> => {
  // Create a persistent answers object that will be shared across re-renders
  const persistentAnswers: Answers = {}

  return new Promise((resolve) => {
    let resolved = false

    dialog.replace(
      () => (
        <DialogQuestion
          question={question}
          initialAnswers={persistentAnswers}
          onSubmit={(answers) => {
            if (resolved) return
            resolved = true
            resolve({ answers, cancelled: false })
            // Clear dialog after resolving to prevent onClose from firing
            setTimeout(() => dialog.clear(), 0)
          }}
          onCancel={() => {
            if (resolved) return
            resolved = true
            dialog.clear()
            resolve({ answers: {}, cancelled: true })
          }}
        />
      ),
      () => {
        if (resolved) return
        resolved = true
        resolve({ answers: {}, cancelled: true })
      },
    )
  })
}

// Helper functions
function formatAnswerPreview(item: Question.QuestionItem, answer?: Answer): string {
  if (!answer || answer.value === undefined || answer.value === null) {
    return "(not answered)"
  }

  if (item.type === "confirm") {
    return answer.value ? "Yes" : "No"
  }

  if (item.type === "multi-select" && Array.isArray(answer.value)) {
    if (answer.value.length === 0) return "(none selected)"
    const labels = answer.value
      .map((v) => item.options?.find((o) => o.value === v)?.label ?? v)
      .slice(0, 2)
      .join(", ")
    if (answer.value.length > 2) {
      return `${labels} +${answer.value.length - 2} more`
    }
    return labels
  }

  if (item.type === "select" && typeof answer.value === "string") {
    const option = item.options?.find((o) => o.value === answer.value)
    return option?.label ?? answer.value
  }

  if (typeof answer.value === "string") {
    return truncate(answer.value, 40)
  }

  return String(answer.value)
}

function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str
  return str.slice(0, maxLength - 3) + "..."
}
