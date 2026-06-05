import type { QuestionAnswer, QuestionRequest } from "@opencode-ai/sdk/v2"
import type { ImageAttachmentPart } from "@/context/prompt"

export type QuestionImage = ImageAttachmentPart

function extractBase64(url: string): string {
  // Recursively strip all data URL prefixes to get pure base64
  const comma = url.indexOf(",")
  if (comma === -1) return url
  const body = url.slice(comma + 1)
  if (!body.startsWith("data:")) return body
  return extractBase64(body)
}

function dataUrl(url: string, mime: string) {
  // If already a complete data URL, extract and rebuild
  if (url.startsWith("data:")) {
    const base64 = extractBase64(url)
    return `data:${mime};base64,${base64}`
  }
  // If pure base64, add prefix
  return `data:${mime};base64,${url}`
}

export function questionAttachments(images: QuestionImage[] | undefined) {
  return (images ?? []).map((item) => ({
    type: "image" as const,
    id: item.id,
    filename: item.filename,
    mime: item.mime,
    dataUrl: item.dataUrl,
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
    ...(images[i] ?? []).map((item) => {
      const url = dataUrl(item.dataUrl, item.mime)
      return {
        type: "image" as const,
        mime: item.mime,
        url,
        filename: item.filename,
      }
    }),
  ])
}

export function questionRequestNotFound(error: unknown, requestID: string) {
  const cause = error instanceof Error ? error.cause : undefined
  const body =
    cause && typeof cause === "object" && "body" in cause
      ? (cause as { body?: unknown }).body
      : error && typeof error === "object"
        ? error
        : undefined

  if (body && typeof body === "object") {
    const tag = "_tag" in body ? (body as { _tag?: unknown })._tag : undefined
    const id = "requestID" in body ? (body as { requestID?: unknown }).requestID : undefined
    if (tag === "QuestionNotFoundError" && id === requestID) return true
  }

  const message = error instanceof Error ? error.message : typeof error === "string" ? error : ""
  return message === `Question request not found: ${requestID}`
}

export function permissionRequestNotFound(error: unknown, requestID: string) {
  const cause = error instanceof Error ? error.cause : undefined
  const body =
    cause && typeof cause === "object" && "body" in cause
      ? (cause as { body?: unknown }).body
      : error && typeof error === "object"
        ? error
        : undefined

  if (body && typeof body === "object") {
    const tag = "_tag" in body ? (body as { _tag?: unknown })._tag : undefined
    const id = "requestID" in body ? (body as { requestID?: unknown }).requestID : undefined
    if (tag === "PermissionNotFoundError" && id === requestID) return true
  }

  const message = error instanceof Error ? error.message : typeof error === "string" ? error : ""
  return message === `Permission request not found: ${requestID}`
}
