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
import { formatAnswerPreview, truncate } from "./utils"
import type { QuestionDialogProps, Answers } from "./types"

export function DialogQuestion(props: QuestionDialogProps) {
  const dialog = useDialog()
  const [answers, setAnswers] = createStore<Answers>({})

  const questions = () => props.question.questions
  const answeredCount = () =>
    Object.keys(answers).filter((k) => answers[k]?.value !== undefined && answers[k]?.value !== null).length

  console.log("[DialogQuestion] Mounting with", questions().length, "questions")

  onMount(() => {
    console.log("[DialogQuestion] onMount called")
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

  const selectOptions = createMemo<DialogSelectOption<Question.QuestionItem>[]>(() =>
    questions().map((item) => {
      const answer = answers[item.id]
      const answerPreview = formatAnswerPreview(item, answer)
      const comment = answer?.comment ? ` 💬 "${truncate(answer.comment, 30)}"` : ""

      return {
        title: item.question,
        value: item,
        description: answerPreview + comment,
        onSelect: () => openQuestion(item),
      }
    }),
  )

  useKeyboard((evt) => {
    if (questions().length === 1) return
    if (evt.ctrl && evt.name === "return") {
      submit()
      evt.preventDefault()
    }
  })

  return (
    <DialogSelect
      title={`Questions (${answeredCount()}/${questions().length} answered)`}
      options={selectOptions()}
      onSelect={(option) => option.onSelect?.(dialog)}
      hideSearch={true}
    />
  )
}

DialogQuestion.show = (
  dialog: DialogContext,
  question: Question.Info,
): Promise<{ answers: Answers; cancelled: boolean }> => {
  console.log("[DialogQuestion.show] Called with question:", question.id, "questions count:", question.questions.length)
  return new Promise((resolve) => {
    dialog.replace(
      () => (
        <DialogQuestion
          question={question}
          onSubmit={(answers) => {
            console.log("[DialogQuestion.show] onSubmit called")
            dialog.clear()
            resolve({ answers, cancelled: false })
          }}
          onCancel={() => {
            console.log("[DialogQuestion.show] onCancel called")
            dialog.clear()
            resolve({ answers: {}, cancelled: true })
          }}
        />
      ),
      () => {
        console.log("[DialogQuestion.show] onClose callback called")
        resolve({ answers: {}, cancelled: true })
      },
    )
  })
}
