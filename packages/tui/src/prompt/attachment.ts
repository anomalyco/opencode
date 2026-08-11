import type { PromptInput } from "@opencode-ai/schema"

type PromptFile = PromptInput.FileAttachment
type PromptFileIdentity = Pick<PromptFile, "uri" | "name" | "description">
type ProjectedFile = Readonly<{
  data: string
  mime: string
  source: { type: string }
  name?: string
  description?: string
  mention?: { text: string }
}>

function attachmentKind(uri: string) {
  if (uri.startsWith("data:image/")) return "Image"
  if (uri.startsWith("data:application/pdf;")) return "PDF"
  return undefined
}

function attachmentMetadata(file: PromptFileIdentity) {
  return JSON.stringify([file.name ?? null, file.description ?? null])
}

export function deduplicatePromptImages(files: readonly PromptFile[] | undefined) {
  if (!files || files.length < 2) return files
  const seen = new Map<string, Set<string>>()
  return files.filter((file) => {
    if (!file.uri.startsWith("data:image/")) return true
    const metadata = attachmentMetadata(file)
    const matches = seen.get(file.uri)
    if (matches?.has(metadata)) return false
    if (matches) matches.add(metadata)
    if (!matches) seen.set(file.uri, new Set([metadata]))
    return true
  })
}

export function preserveMentionlessPromptAttachments(
  files: readonly PromptFile[] | undefined,
  mentioned: PromptFile[],
) {
  return [...mentioned, ...(files?.filter((file) => !file.mention) ?? [])]
}

export function deduplicateVisibleImages<T extends ProjectedFile>(files: readonly T[]) {
  const seen = new Map<string, Set<string>>()
  return files.filter((file) => {
    if (!file.mime.startsWith("image/") || file.source.type !== "inline" || !file.mention?.text) return true
    const metadata = JSON.stringify([file.mime, file.name ?? null, file.description ?? null, file.mention.text])
    const matches = seen.get(file.data)
    if (matches?.has(metadata)) return false
    if (matches) matches.add(metadata)
    if (!matches) seen.set(file.data, new Set([metadata]))
    return true
  })
}

export function promptAttachmentLabel(files: readonly PromptFile[] | undefined, file: PromptFileIdentity) {
  const kind = attachmentKind(file.uri)
  if (!kind) throw new Error(`Unsupported inline attachment: ${file.uri}`)
  const metadata = attachmentMetadata(file)
  const existing =
    kind === "Image"
      ? files?.find(
          (candidate) =>
            candidate.uri === file.uri && attachmentMetadata(candidate) === metadata && candidate.mention?.text,
        )?.mention?.text
      : undefined
  if (existing) return existing

  const pattern = new RegExp(`^\\[${kind} (\\d+)\\]$`)
  const count =
    files?.reduce((highest, candidate) => {
      const match = candidate.mention?.text.match(pattern)
      return match ? Math.max(highest, Number(match[1])) : highest
    }, 0) ?? 0
  return `[${kind} ${count + 1}]`
}
