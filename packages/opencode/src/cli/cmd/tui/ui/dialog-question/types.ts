import type { Question } from "@/question"

export interface Answer {
  value: string | string[] | boolean | null
  comment?: string
}

export type Answers = Record<string, Answer>

export interface QuestionDialogProps {
  question: Question.Info
  onSubmit: (answers: Answers) => void
  onCancel: () => void
}

export interface SingleQuestionProps {
  item: Question.QuestionItem
  currentAnswer?: Answer
  onAnswer: (answer: Answer) => void
  onCancel: () => void
  onSubmitAll: (answer: Answer) => void
}
