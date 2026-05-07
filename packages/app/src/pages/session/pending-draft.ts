import type { Part, SessionPendingDraft } from "@opencode-ai/sdk/v2/client"
import type { LineComment } from "@/context/comments"
import type { FileSelection } from "@/context/file"
import { decodeFilePath, stripFileProtocol, stripQueryAndHash } from "@/context/file/path"
import type { ContextItem, FileContextItem, Prompt } from "@/context/prompt"
import type { FollowupDraft } from "@/components/prompt-input/submit"
import { buildCommandRequestParts, buildRequestParts } from "@/components/prompt-input/build-request-parts"
import { Identifier } from "@/utils/id"
import { checksum } from "@opencode-ai/util/encode"
import { extractPromptFromParts } from "@/utils/prompt"
import { readCommentMetadata } from "@/utils/comment-note"
import { batch } from "solid-js"

const draftText = (prompt: Prompt) => prompt.map((part) => ("content" in part ? part.content : "")).join("")
const draftImages = (prompt: Prompt) =>
  prompt.filter((part): part is Extract<Prompt[number], { type: "image" }> => part.type === "image")

export function pendingDraftPreview(prompt: Prompt, attachmentName: string) {
  const text = prompt
    .map((part) => {
      if (part.type === "image") return `[image:${part.filename}]`
      if (part.type === "file") return `[file:${part.path}]`
      if (part.type === "agent") return `@${part.name}`
      return part.content
    })
    .join("")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => !!line)

  if (text) return text
  return `[${attachmentName}]`
}

const pendingModelKey = (value: string | { providerID: string; modelID: string } | undefined) => {
  if (!value) return
  if (typeof value !== "string") return value
  const divider = value.indexOf("/")
  if (divider <= 0 || divider >= value.length - 1) return
  return {
    providerID: value.slice(0, divider),
    modelID: value.slice(divider + 1),
  }
}

const pendingSelectionFromUrl = (url: string): FileSelection | undefined => {
  const queryIndex = url.indexOf("?")
  if (queryIndex === -1) return undefined
  const params = new URLSearchParams(url.slice(queryIndex + 1))
  const startLine = Number(params.get("start"))
  const endLine = Number(params.get("end"))
  if (!Number.isFinite(startLine) || !Number.isFinite(endLine)) return undefined
  return {
    startLine,
    endLine,
    startChar: 0,
    endChar: 0,
  }
}

const pendingPathFromUrl = (url: string) => {
  const decoded = decodeFilePath(stripQueryAndHash(stripFileProtocol(url)))
  return decoded.replace(/^\/([A-Za-z]:)/, "$1")
}

const pendingAbsolutePath = (directory: string | undefined, path: string) => {
  if (!directory) return path
  if (path.startsWith("/")) return path
  if (/^[A-Za-z]:[\\/]/.test(path) || /^[A-Za-z]:$/.test(path)) return path
  if (path.startsWith("\\\\") || path.startsWith("//")) return path
  return `${directory.replace(/[\\/]+$/, "")}/${path}`
}

const pendingCommentMention = /(^|[\s([{"'])@(\S+)/g

const pendingCommentMentionPaths = (comment: string) => {
  return Array.from(comment.matchAll(pendingCommentMention)).flatMap((match) => {
    const path = (match[2] ?? "").replace(/[.,!?;:)}\]"']+$/, "")
    if (!path) return []
    return [path]
  })
}

const pendingContextKey = (path: string, selection?: FileSelection, comment?: string, commentID?: string) => {
  const serialized = JSON.stringify({
    path,
    startLine: selection?.startLine,
    endLine: selection?.endLine,
    comment: comment?.trim() || undefined,
    commentID,
  })
  return checksum(serialized) ?? serialized
}

const pendingPromptPartKey = (part: Prompt[number]) =>
  checksum(
    JSON.stringify({
      type: part.type,
      content: "content" in part ? part.content : undefined,
      path: part.type === "file" ? part.path : undefined,
      selection: part.type === "file" ? part.selection : undefined,
      name: part.type === "agent" ? part.name : undefined,
      filename: part.type === "image" ? part.filename : undefined,
      mime: part.type === "image" ? part.mime : undefined,
      dataUrl: part.type === "image" ? part.dataUrl : undefined,
    }),
  )

type PendingPromptPart = SessionPendingDraft["composer"]["prompt"][number]
type PendingContextItem = SessionPendingDraft["composer"]["context"][number]

const cloneSelection = (selection?: Pick<FileSelection, "startLine" | "startChar" | "endLine" | "endChar">) => {
  if (!selection) return undefined
  return {
    startLine: selection.startLine,
    startChar: selection.startChar,
    endLine: selection.endLine,
    endChar: selection.endChar,
  }
}

const clonePromptPart = (part: Prompt[number] | PendingPromptPart): Prompt[number] => {
  switch (part.type) {
    case "text":
      return {
        type: "text",
        content: part.content,
        start: part.start,
        end: part.end,
      }
    case "image":
      return {
        type: "image",
        id: part.id,
        filename: part.filename,
        mime: part.mime,
        dataUrl: part.dataUrl,
      }
    case "agent":
      return {
        type: "agent",
        content: part.content,
        start: part.start,
        end: part.end,
        name: part.name,
      }
    case "file": {
      const next: Extract<Prompt[number], { type: "file" }> = {
        type: "file",
        content: part.content,
        start: part.start,
        end: part.end,
        path: part.path,
      }
      if (part.selection) next.selection = cloneSelection(part.selection)
      return next
    }
  }
  throw new Error(`Unsupported prompt part type: ${(part as { type?: string }).type ?? "unknown"}`)
}

const clonePrompt = (prompt: readonly (Prompt[number] | PendingPromptPart)[]) => prompt.map(clonePromptPart)

const cloneContextItemValue = (
  item: (ContextItem & { key?: string }) | PendingContextItem,
): Omit<ContextItem & { key: string }, "key"> => {
  const next: Omit<ContextItem & { key: string }, "key"> = {
    type: "file",
    path: item.path,
  }
  if (item.selection) next.selection = cloneSelection(item.selection)
  if (item.comment !== undefined) next.comment = item.comment
  if (item.commentID !== undefined) next.commentID = item.commentID
  if (item.commentOrigin !== undefined) next.commentOrigin = item.commentOrigin
  if (item.preview !== undefined) next.preview = item.preview
  return next
}

const cloneContextItem = (item: (ContextItem & { key: string }) | PendingContextItem) => ({
  key: item.key,
  ...cloneContextItemValue(item),
})

const cloneContextItems = (items: readonly ((ContextItem & { key: string }) | PendingContextItem)[]) =>
  items.map(cloneContextItem)

const promptContextFromPendingParts = (parts: Part[], options?: { includeFileParts?: boolean; directory?: string }) => {
  const items = new Map<string, FileContextItem & { key: string }>()
  const commentFileSelections = new Set<string>()
  const commentMentionPaths = new Set<string>()
  const samePathSelection = (
    leftPath: string,
    leftSelection?: FileSelection,
    rightPath?: string,
    rightSelection?: FileSelection,
  ) =>
    leftPath === rightPath &&
    leftSelection?.startLine === rightSelection?.startLine &&
    leftSelection?.startChar === rightSelection?.startChar &&
    leftSelection?.endLine === rightSelection?.endLine &&
    leftSelection?.endChar === rightSelection?.endChar

  const ensure = (path: string, selection?: FileSelection, comment?: string, commentID?: string) => {
    const key = pendingContextKey(path, selection, comment, commentID)
    const existing = items.get(key)
    if (existing) return existing
    const next: FileContextItem & { key: string } = {
      key,
      type: "file",
      path,
      selection,
    }
    items.set(key, next)
    return next
  }

  for (const part of parts) {
    if (part.type === "text") {
      const meta = readCommentMetadata(part.metadata)
      if (!meta) continue
      commentFileSelections.add(pendingContextKey(pendingAbsolutePath(options?.directory, meta.path), meta.selection))
      for (const mentionPath of pendingCommentMentionPaths(meta.comment)) {
        commentMentionPaths.add(pendingAbsolutePath(options?.directory, mentionPath))
      }
      const item = ensure(meta.path, meta.selection, meta.comment, meta.commentID)
      item.comment = meta.comment
      item.commentID = meta.commentID
      item.preview = meta.preview
      item.commentOrigin = meta.origin
      continue
    }

    if (part.type !== "file") continue
    if (options?.includeFileParts === false) continue
    if (part.url.startsWith("data:")) continue
    if (part.source?.text) continue
    const path = pendingPathFromUrl(part.url)
    const selection = pendingSelectionFromUrl(part.url)
    if (commentFileSelections.has(pendingContextKey(path, selection))) continue
    if (!selection && commentMentionPaths.has(path)) continue
    if ([...items.values()].some((item) => samePathSelection(item.path, item.selection, path, selection))) continue
    ensure(path, selection)
  }

  return [...items.values()]
}

const pendingRequestPrompt = (parts: unknown[] | undefined, directory: string, attachmentName: string) =>
  extractPromptFromParts((parts ?? []) as Part[], {
    directory,
    attachmentName,
  }).filter(
    (part, _index, list) => !(part.type === "text" && !part.content && list.some((item) => item.type !== "text")),
  )

const historyCommentsFromContext = (
  context: ReturnType<typeof promptContextFromPendingParts>,
  existingComments?: readonly Pick<LineComment, "id" | "file" | "selection" | "time">[],
) => {
  const byID = new Map((existingComments ?? []).map((item) => [`${item.file}\n${item.id}`, item] as const))
  return context.flatMap((item, index) => {
    const comment = item.comment?.trim()
    const selection = item.selection
    if (!comment || !selection) return []

    const existing = item.commentID ? byID.get(`${item.path}\n${item.commentID}`) : undefined
    return [
      {
        id: item.commentID ?? item.key,
        file: item.path,
        selection: existing?.selection ?? {
          start: Math.min(selection.startLine, selection.endLine),
          end: Math.max(selection.startLine, selection.endLine),
        },
        comment,
        time: existing?.time ?? Date.now() + index,
      } satisfies LineComment,
    ]
  })
}

export function fromRequestParts(input: {
  parts: Part[]
  directory: string
  attachmentName: string
  existingComments?: readonly Pick<LineComment, "id" | "file" | "selection" | "time">[]
}) {
  const context = promptContextFromPendingParts(input.parts, { directory: input.directory })
  return {
    prompt: pendingRequestPrompt(input.parts, input.directory, input.attachmentName) as Prompt,
    context,
    comments: historyCommentsFromContext(context, input.existingComments),
  }
}

type RestoredComposerState = ReturnType<typeof fromRequestParts>

export function clearPromptContextItems(items: readonly { key: string }[], remove: (key: string) => void) {
  for (const item of items) {
    remove(item.key)
  }
}

export function restorePromptContextItems(
  items: readonly RestoredComposerState["context"][number][],
  add: (item: Omit<RestoredComposerState["context"][number], "key">) => void,
) {
  for (const item of items) {
    add(cloneContextItemValue(item))
  }
}

export function restoreComposerFromRequestParts(input: {
  parts: unknown[] | undefined
  directory: string
  attachmentName: string
  existingComments?: readonly Pick<LineComment, "id" | "file" | "selection" | "time">[]
  currentContextItems: () => readonly { key: string }[]
  removeContext: (key: string) => void
  addContext: (item: Omit<RestoredComposerState["context"][number], "key">) => void
  replaceComments: (comments: RestoredComposerState["comments"]) => void
  setPrompt: (prompt: Prompt) => void
}) {
  if (!input.parts) return false
  const restored = fromRequestParts({
    parts: input.parts as Part[],
    directory: input.directory,
    attachmentName: input.attachmentName,
    existingComments: input.existingComments,
  })
  batch(() => {
    clearPromptContextItems(input.currentContextItems(), input.removeContext)
    input.replaceComments(restored.comments)
    restorePromptContextItems(restored.context, input.addContext)
    input.setPrompt(restored.prompt)
  })
  return true
}

export function toPendingDraft(input: {
  draft: FollowupDraft
  commandNames: readonly string[]
  attachmentName: string
}) {
  const { draft, commandNames, attachmentName } = input
  const text = draftText(draft.prompt)
  const images = draftImages(draft.prompt)
  const preview = pendingDraftPreview(draft.prompt, attachmentName)
  const composerState = {
    prompt: clonePrompt(draft.prompt),
    context: cloneContextItems(draft.context),
  }

  if (text.startsWith("/")) {
    const [cmdName, ...args] = text.split(" ")
    const commandName = cmdName.slice(1)
    const preserveCommand = draft.pendingBaseDraft?.kind === "command"
    if (commandNames.includes(commandName) || preserveCommand) {
      const { requestParts } = buildCommandRequestParts({
        prompt: draft.prompt.filter((part) => part.type !== "text"),
        context: draft.context,
        images,
        messageID: Identifier.ascending("message"),
        sessionID: draft.sessionID,
        sessionDirectory: draft.sessionDirectory,
      })
      return {
        kind: "command",
        preview,
        composer: composerState,
        request: {
          command: commandName,
          arguments: args.join(" "),
          agent: draft.agent,
          model: `${draft.model.providerID}/${draft.model.modelID}`,
          variant: draft.variant,
          parts: requestParts,
        },
      } satisfies SessionPendingDraft
    }
  }

  const messageID = Identifier.ascending("message")
  const { requestParts } = buildRequestParts({
    prompt: draft.prompt,
    context: draft.context,
    images,
    text,
    messageID,
    sessionID: draft.sessionID,
    sessionDirectory: draft.sessionDirectory,
  })

  return {
    kind: "prompt",
    preview,
    composer: composerState,
    request: {
      agent: draft.agent,
      model: draft.model,
      variant: draft.variant,
      parts: requestParts,
    },
  } satisfies SessionPendingDraft
}

export function fromPendingDraft(input: { draft: SessionPendingDraft; directory: string; attachmentName: string }) {
  const { draft, directory, attachmentName } = input
  const requestAgent =
    draft.kind === "command" ? (draft.request.agent ?? draft.request.resolved?.agent) : draft.request.agent
  const requestModel =
    draft.kind === "command"
      ? (pendingModelKey(draft.request.model) ?? draft.request.resolved?.model)
      : pendingModelKey(draft.request.model)
  const requestVariant =
    draft.kind === "command" ? (draft.request.variant ?? draft.request.resolved?.variant) : draft.request.variant

  if (draft.kind === "prompt" && draft.composer.context.length === 0) {
    const restored = fromRequestParts({
      parts: draft.request.parts as Part[],
      directory,
      attachmentName,
    })
    return {
      prompt: restored.prompt,
      context: restored.context,
      agent: requestAgent,
      model: requestModel,
      variant: requestVariant,
    }
  }

  if (draft.kind === "command" && (draft.request.parts?.length ?? 0) > 0) {
    const prompt = clonePrompt(draft.composer.prompt)
    const recoveredPrompt = pendingRequestPrompt(draft.request.parts, directory, attachmentName).filter(
      (part): part is Exclude<Prompt[number], { type: "text" }> => part.type !== "text",
    )
    const seenPromptParts = new Set(prompt.map((part) => pendingPromptPartKey(part)))
    const missingPromptParts = recoveredPrompt.filter((part) => !seenPromptParts.has(pendingPromptPartKey(part)))
    const context = cloneContextItems(draft.composer.context)
    const seenContext = new Set(
      context.map((item) => pendingContextKey(item.path, item.selection, item.comment, item.commentID)),
    )
    const missingContext = promptContextFromPendingParts(draft.request.parts as Part[], {
      includeFileParts: false,
      directory,
    }).filter((item) => {
      const key = pendingContextKey(item.path, item.selection, item.comment, item.commentID)
      if (seenContext.has(key)) return false
      seenContext.add(key)
      return true
    })
    return {
      prompt: [...prompt, ...missingPromptParts] as Prompt,
      context: [...context, ...missingContext],
      agent: requestAgent,
      model: requestModel,
      variant: requestVariant,
    }
  }

  return {
    prompt: clonePrompt(draft.composer.prompt),
    context: cloneContextItems(draft.composer.context),
    agent: requestAgent,
    model: requestModel,
    variant: requestVariant,
  }
}
