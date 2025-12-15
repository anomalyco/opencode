import type { Question } from "@/question"

// Types
export interface Answer {
  value: string | string[] | boolean | null
  comment?: string
}

export type Answers = Record<string, Answer>

export interface QuestionDialogProps {
  question: Question.Info
  onSubmit: (answers: Answers) => void
  onCancel: () => void
  initialAnswers?: Answers
}

export interface SingleQuestionProps {
  item: Question.QuestionItem
  currentAnswer?: Answer
  onAnswer: (answer: Partial<Answer>) => void // Merges with current answer
  onCancel: () => void
}
