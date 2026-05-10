import { getFilename } from "@opencode-ai/core/util/path"
import { type AgentPartInput, type FilePartInput, type Part, type TextPartInput } from "@opencode-ai/sdk/v2/client"
import type { BrowserAnnotation } from "@/context/browser-types"
import type { FileSelection } from "@/context/file"
import { encodeFilePath } from "@/context/file/path"
import type { AgentPart, FileAttachmentPart, ImageAttachmentPart, Prompt } from "@/context/prompt"
import { Identifier } from "@/utils/id"
import { createCommentMetadata, formatCommentNote } from "@/utils/comment-note"

type PromptRequestPart = (TextPartInput | FilePartInput | AgentPartInput) & { id: string }

type ContextFile = {
  key: string
  type: "file"
  path: string
  selection?: FileSelection
  comment?: string
  commentID?: string
  commentOrigin?: "review" | "file"
  preview?: string
}

type BuildRequestPartsInput = {
  prompt: Prompt
  context: ContextFile[]
  images: ImageAttachmentPart[]
  annotations?: BrowserAnnotation[]
  text: string
  messageID: string
  sessionID: string
  sessionDirectory: string
  browserIntegratedToolsEnabled?: boolean
  browserIntegratedToolsAvailable?: boolean
}

type AnnotationContext = {
  id: string
  pageUrl: string
  pageTitle: string
  userComment: string
  selector: string
  role?: string
  accessibleName?: string
  visibleText?: string
  boundingBox: BrowserAnnotation["element"]["boundingBox"]
  screenshotCrop?: string
  nearbyDomSanitized?: string
}

const ANNOTATION_VISIBLE_TEXT_LIMIT = 100
const ANNOTATION_DOM_LIMIT = 200
const ANNOTATION_SCREENSHOT_CROP_LIMIT = 4096
const browserMention = /(^|[\s([{"'])(@|\/)browser(?=$|[\s,!?;)}\]"'])/i
const browserToolsNote =
  "Integrated browser tools are available because the user mentioned @browser or /browser. The integrated browser should be preferred over Playwright/external browsers for navigation, inspection, screenshots, console, and page interaction. Use browser_navigate, browser_inspect, browser_click, browser_type, browser_screenshot, browser_console_messages, browser_console_clear, browser_back, browser_forward, and browser_reload when relevant."
const browserToolsDisabledNote =
  "Integrated browser tools are disabled in Settings. Do not claim or assume integrated browser tools are available; use other available tools or ask the user to enable them if needed."
const browserToolsUnavailableNote =
  "Integrated browser tools are unavailable in this environment. Do not claim or assume integrated browser tools are available or preferred; use other available tools or ask the user to open the desktop app with browser support if needed."

const absolute = (directory: string, path: string) => {
  if (path.startsWith("/")) return path
  if (/^[A-Za-z]:[\\/]/.test(path) || /^[A-Za-z]:$/.test(path)) return path
  if (path.startsWith("\\\\") || path.startsWith("//")) return path
  return `${directory.replace(/[\\/]+$/, "")}/${path}`
}

const fileQuery = (selection: FileSelection | undefined) =>
  selection ? `?start=${selection.startLine}&end=${selection.endLine}` : ""

const mention = /(^|[\s([{"'])@(\S+)/g

const parseCommentMentions = (comment: string) => {
  return Array.from(comment.matchAll(mention)).flatMap((match) => {
    const path = (match[2] ?? "").replace(/[.,!?;:)}\]"']+$/, "")
    if (!path) return []
    return [path]
  })
}

const isFileAttachment = (part: Prompt[number]): part is FileAttachmentPart => part.type === "file"
const isAgentAttachment = (part: Prompt[number]): part is AgentPart => part.type === "agent"
const bounded = (value: string | undefined, limit: number) => value?.trim().slice(0, limit) || undefined
const boundedScreenshotCrop = (value: string | undefined) => {
  if (!value) return
  return value.length <= ANNOTATION_SCREENSHOT_CROP_LIMIT ? value : undefined
}

const compactAnnotation = (annotation: BrowserAnnotation) => {
  return {
    id: annotation.id,
    pageUrl: annotation.pageUrl,
    pageTitle: annotation.pageTitle,
    userComment: annotation.userComment,
    selector: annotation.element.selector,
    role: annotation.element.role,
    accessibleName: annotation.element.accessibleName?.trim() || undefined,
    visibleText: bounded(annotation.element.visibleText, ANNOTATION_VISIBLE_TEXT_LIMIT),
    boundingBox: annotation.element.boundingBox,
    screenshotCrop: boundedScreenshotCrop(annotation.preview.screenshotCrop),
    nearbyDomSanitized: bounded(annotation.context.nearbyDomSanitized, ANNOTATION_DOM_LIMIT),
  } satisfies AnnotationContext
}

const createAnnotationMetadata = (annotations: BrowserAnnotation[]) => ({
  opencodeAnnotations: {
    count: annotations.length,
    compact: annotations.map(compactAnnotation),
  },
})

const createBrowserToolsMetadata = (enabled: boolean, available: boolean) => ({
  opencodeBrowserTools: { enabled, available },
})

const formatAnnotationNote = (annotations: AnnotationContext[]) => {
  const count = annotations.length
  return `The user attached ${count} browser annotation${count === 1 ? "" : "s"} as compact JSON context. Use browser.annotation.get_detail with an annotation id if you need more detail.\n${JSON.stringify(annotations)}`
}

const toOptimisticPart = (part: PromptRequestPart, sessionID: string, messageID: string): Part => {
  if (part.type === "text") {
    return {
      id: part.id,
      type: "text",
      text: part.text,
      synthetic: part.synthetic,
      ignored: part.ignored,
      time: part.time,
      metadata: part.metadata,
      sessionID,
      messageID,
    }
  }
  if (part.type === "file") {
    return {
      id: part.id,
      type: "file",
      mime: part.mime,
      filename: part.filename,
      url: part.url,
      source: part.source,
      sessionID,
      messageID,
    }
  }
  return {
    id: part.id,
    type: "agent",
    name: part.name,
    source: part.source,
    sessionID,
    messageID,
  }
}

export function buildRequestParts(input: BuildRequestPartsInput) {
  const requestParts: PromptRequestPart[] = [
    {
      id: Identifier.ascending("part"),
      type: "text",
      text: input.text,
    },
  ]

  const files = input.prompt.filter(isFileAttachment).map((attachment) => {
    const path = absolute(input.sessionDirectory, attachment.path)
    return {
      id: Identifier.ascending("part"),
      type: "file",
      mime: "text/plain",
      url: `file://${encodeFilePath(path)}${fileQuery(attachment.selection)}`,
      filename: getFilename(attachment.path),
      source: {
        type: "file",
        text: {
          value: attachment.content,
          start: attachment.start,
          end: attachment.end,
        },
        path,
      },
    } satisfies PromptRequestPart
  })

  const agents = input.prompt.filter(isAgentAttachment).map((attachment) => {
    return {
      id: Identifier.ascending("part"),
      type: "agent",
      name: attachment.name,
      source: {
        value: attachment.content,
        start: attachment.start,
        end: attachment.end,
      },
    } satisfies PromptRequestPart
  })

  const used = new Set(files.map((part) => part.url))
  const context = input.context.flatMap((item) => {
    const path = absolute(input.sessionDirectory, item.path)
    const url = `file://${encodeFilePath(path)}${fileQuery(item.selection)}`
    const comment = item.comment?.trim()
    if (!comment && used.has(url)) return []
    used.add(url)

    const filePart = {
      id: Identifier.ascending("part"),
      type: "file",
      mime: "text/plain",
      url,
      filename: getFilename(item.path),
    } satisfies PromptRequestPart

    if (!comment) return [filePart]

    const mentions = parseCommentMentions(comment).flatMap((path) => {
      const url = `file://${encodeFilePath(absolute(input.sessionDirectory, path))}`
      if (used.has(url)) return []
      used.add(url)
      return [
        {
          id: Identifier.ascending("part"),
          type: "file",
          mime: "text/plain",
          url,
          filename: getFilename(path),
        } satisfies PromptRequestPart,
      ]
    })

    return [
      {
        id: Identifier.ascending("part"),
        type: "text",
        text: formatCommentNote({ path: item.path, selection: item.selection, comment }),
        synthetic: true,
        metadata: createCommentMetadata({
          path: item.path,
          selection: item.selection,
          comment,
          preview: item.preview,
          origin: item.commentOrigin,
        }),
      } satisfies PromptRequestPart,
      filePart,
      ...mentions,
    ]
  })

  const images = input.images.map((attachment) => {
    return {
      id: Identifier.ascending("part"),
      type: "file",
      mime: attachment.mime,
      url: attachment.dataUrl,
      filename: attachment.filename,
    } satisfies PromptRequestPart
  })

  const annotations = input.annotations?.length
    ? [
        {
          id: Identifier.ascending("part"),
          type: "text",
          text: formatAnnotationNote(input.annotations.map(compactAnnotation)),
          synthetic: true,
          metadata: createAnnotationMetadata(input.annotations),
        } satisfies PromptRequestPart,
      ]
    : []

  const browserIntegratedToolsEnabled = input.browserIntegratedToolsEnabled ?? true
  const browserIntegratedToolsAvailable = browserIntegratedToolsEnabled && input.browserIntegratedToolsAvailable === true
  const browserHint = browserMention.test(input.text)
    ? [
        {
          id: Identifier.ascending("part"),
          type: "text",
          text: !browserIntegratedToolsEnabled
            ? browserToolsDisabledNote
            : browserIntegratedToolsAvailable
              ? browserToolsNote
              : browserToolsUnavailableNote,
          synthetic: true,
          metadata: createBrowserToolsMetadata(browserIntegratedToolsEnabled, browserIntegratedToolsAvailable),
        } satisfies PromptRequestPart,
      ]
    : []

  requestParts.push(...browserHint, ...files, ...context, ...annotations, ...agents, ...images)

  return {
    requestParts,
    optimisticParts: requestParts.map((part) => toOptimisticPart(part, input.sessionID, input.messageID)),
  }
}
