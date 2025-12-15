import { createMemo, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { useKeyboard } from "@opentui/solid"
import { useDialog, type DialogContext } from "@tui/ui/dialog"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import type { Question } from "@/question"
import { DialogQuestionSelect } from "./dialog-question-select"
import { DialogQuestionMultiSelect } from "./dialog-question-multi-select"
import { DialogQuestionConfirm } from "./dialog-question-confirm"
import { DialogQuestionText } from "./dialog-question-text"
import { formatAnswerPreview, truncate } from "./helpers"
import type { Answers, QuestionDialogProps } from "./types"

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
        onAnswer={(partialAnswer) => {
          // Merge partial answer with existing answer
          const mergedAnswer = {
            ...answers[item.id],
            ...partialAnswer,
          }
          setAnswers(item.id, mergedAnswer)
          // Sync to initialAnswers if provided
          if (props.initialAnswers) {
            props.initialAnswers[item.id] = mergedAnswer
          }
        }}
        onCancel={() => dialog.pop()}
      />
    ))
  }

  function submit(finalAnswers?: Answers) {
    props.onSubmit(finalAnswers ?? answers)
  }

  // Convert questions to DialogSelect options
  const selectOptions = createMemo<DialogSelectOption<Question.QuestionItem>[]>(() => {
    // Access all keys to subscribe to any changes
    Object.keys(answers)

    return questions().map((item) => {
      const answer = answers[item.id]
      const answerPreview = formatAnswerPreview(item, answer)
      const comment = answer?.comment ? ` 💬 "${truncate(answer.comment, 30)}"` : ""

      return {
        title: item.question,
        value: item,
        description: answerPreview + comment,
        onSelect: () => openQuestion(item),
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
          onTrigger: () => {
            submit()
            return false
          },
        },
      ]}
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
