import type { QuestionAnswer, QuestionRequest } from "@opencode-ai/sdk/v2"

export type QuestionImage = {
  type: "image"
  id: string
  mime: string
  url: string
  filename?: string
}

export function questionAttachments(images: QuestionImage[] | undefined) {
  return (images ?? []).map((item) => ({
    type: "image" as const,
    id: item.id,
    filename: item.filename ?? "image",
    mime: item.mime,
    dataUrl: item.url,
  }))
}

export function questionAnswered(
  answers: QuestionAnswer | undefined,
  custom: string | undefined,
  on: boolean | undefined,
  images: QuestionImage[] | undefined,
) {
  if ((answers?.length ?? 0) > 0) return true
  if (on !== true) return false
  if ((custom ?? "").trim().length > 0) return true
  return (images?.length ?? 0) > 0
}

export function questionReply(
  questions: QuestionRequest["questions"],
  answers: QuestionAnswer[],
  images: QuestionImage[][],
): QuestionAnswer[] {
  return questions.map((_, i) => [
    ...(answers[i] ?? []),
    ...(images[i] ?? []).map((item) => ({
      type: "image" as const,
      mime: item.mime,
      url: item.url,
      filename: item.filename,
    })),
  ])
}
