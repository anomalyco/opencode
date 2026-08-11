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

function deduplicateByIdentity<T>(
  items: readonly T[],
  identity: (item: T) => { metadata: string; payload: string } | undefined,
) {
  const seen = new Map<string, string[]>()
  return items.filter((item) => {
    const key = identity(item)
    if (!key) return true
    const matches = seen.get(key.metadata)
    if (matches?.includes(key.payload)) return false
    if (matches) matches.push(key.payload)
    if (!matches) seen.set(key.metadata, [key.payload])
    return true
  })
}

export function deduplicatePromptImages(files: readonly PromptFile[] | undefined) {
  if (!files || files.length < 2) return files
  return deduplicateByIdentity(files, (file) =>
    file.uri.startsWith("data:image/") && file.mention?.text
      ? {
          metadata: JSON.stringify([attachmentMetadata(file), file.mention.text]),
          payload: file.uri,
        }
      : undefined,
  )
}

export function preserveMentionlessPromptAttachments(
  files: readonly PromptFile[] | undefined,
  mentioned: PromptFile[],
) {
  if (!files) return mentioned
  const tracked = mentioned.values()
  return files.flatMap((file) => {
    if (!file.mention?.text) return [file]
    const next = tracked.next()
    return next.done ? [] : [next.value]
  })
}

export function deduplicateVisibleImages<T extends ProjectedFile>(files: readonly T[]) {
  return deduplicateByIdentity(files, (file) =>
    file.mime.startsWith("image/") && file.source.type === "inline" && file.mention?.text
      ? {
          metadata: JSON.stringify([file.mime, file.name ?? null, file.description ?? null, file.mention.text]),
          payload: file.data,
        }
      : undefined,
  )
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
