import { createEffect, createMemo, createSignal, For, onCleanup, Show, type ComponentProps, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { useData } from "../context"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useI18n } from "@opencode-ai/ui/context/i18n"
import { Markdown } from "../components/markdown"
import { ImagePreview } from "@opencode-ai/ui/image-preview"
import { getFilename } from "@opencode-ai/util/path"
import { AttachmentCard } from "./attachment-card"
import { CommentCard } from "./comment-card"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Icon } from "@opencode-ai/ui/icon"
import { Button } from "@opencode-ai/ui/button"
import { Card } from "@opencode-ai/ui/card"
import type {
  PromptAgentAttachment,
  PromptFileAttachment,
  SessionMessageAssistant,
  SessionMessageCompaction,
  SessionMessageUser,
} from "@opencode-ai/client/promise"
import type { SessionUserActions, SessionUserComment } from "../actions"
import { typeLabel } from "../components/message-file"

export async function writeClipboard(text: string): Promise<boolean> {
  const body = typeof document === "undefined" ? undefined : document.body
  if (body) {
    const textarea = document.createElement("textarea")
    textarea.value = text
    textarea.setAttribute("readonly", "")
    textarea.style.position = "fixed"
    textarea.style.opacity = "0"
    textarea.style.pointerEvents = "none"
    body.appendChild(textarea)
    textarea.select()
    const copied = document.execCommand("copy")
    body.removeChild(textarea)
    if (copied) return true
  }

  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard
  if (!clipboard?.writeText) return false
  return clipboard.writeText(text).then(
    () => true,
    () => false,
  )
}

function MessageActionButton(
  props: Pick<ComponentProps<"button">, "disabled" | "onMouseDown" | "onClick" | "aria-label"> & {
    icon: "check" | "copy" | "reset"
    label: JSX.Element
  },
) {
  const icon = () => (props.icon === "copy" ? "outline-copy" : props.icon)
  return (
    <Tooltip appearance="compact" value={props.label} placement="top" gutter={4}>
      <IconButton
        icon={<Icon name={icon()} size="small" />}
        size="normal"
        variant="ghost-muted"
        disabled={props.disabled}
        onMouseDown={props.onMouseDown}
        onClick={props.onClick}
        aria-label={props["aria-label"]}
      />
    </Tooltip>
  )
}

const TEXT_RENDER_PACE_MS = 24
const TEXT_RENDER_IMMEDIATE = 512
const TEXT_RENDER_SNAP = /[\s.,!?;:)\]]/

function step(size: number) {
  if (size <= 12) return 2
  if (size <= 48) return 4
  if (size <= 96) return 8
  return Math.min(256, Math.ceil(size / 4))
}

function next(text: string, start: number) {
  const end = Math.min(text.length, start + step(text.length - start))
  const max = Math.min(text.length, end + 8)
  for (let i = end; i < max; i++) {
    if (TEXT_RENDER_SNAP.test(text[i] ?? "")) return i + 1
  }
  return end
}

function createPacedValue(getValue: () => string, live?: () => boolean) {
  const [value, setValue] = createSignal(getValue())
  let shown = getValue()
  let timeout: ReturnType<typeof setTimeout> | undefined

  const clear = () => {
    if (!timeout) return
    clearTimeout(timeout)
    timeout = undefined
  }

  const sync = (text: string) => {
    shown = text
    setValue(text)
  }

  const run = () => {
    timeout = undefined
    const text = getValue()
    if (!live?.()) {
      sync(text)
      return
    }
    if (!text.startsWith(shown) || text.length <= shown.length) {
      sync(text)
      return
    }
    if (text.length - shown.length <= TEXT_RENDER_IMMEDIATE) {
      sync(text)
      return
    }
    const end = next(text, shown.length)
    sync(text.slice(0, end))
    if (end < text.length) timeout = setTimeout(run, TEXT_RENDER_PACE_MS)
  }

  createEffect(() => {
    const text = getValue()
    if (!live?.()) {
      clear()
      sync(text)
      return
    }
    if (!text.startsWith(shown) || text.length < shown.length) {
      clear()
      sync(text)
      return
    }
    if (text.length - shown.length <= TEXT_RENDER_IMMEDIATE) {
      clear()
      sync(text)
      return
    }
    if (text.length === shown.length || timeout) return
    timeout = setTimeout(run, TEXT_RENDER_PACE_MS)
  })

  onCleanup(() => {
    clear()
  })

  return value
}

function PacedMarkdown(props: { text: string; cacheKey: string; streaming: boolean }) {
  const value = createPacedValue(
    () => props.text,
    () => props.streaming,
  )

  return (
    <Show when={value()}>
      <Markdown text={value()} cacheKey={props.cacheKey} streaming={props.streaming} deferUntilReady />
    </Show>
  )
}

function UserMessageComments(props: { comments: SessionUserComment[]; bounded: boolean }) {
  const i18n = useI18n()
  const [state, setState] = createStore({ expanded: false })
  const comments = createMemo(() => (props.bounded && !state.expanded ? props.comments.slice(0, 5) : props.comments))

  return (
    <div data-slot="user-message-comments" data-bounded={props.bounded ? "true" : undefined}>
      <For each={comments()}>
        {(comment) => (
          <CommentCard
            comment={comment.comment}
            path={comment.path}
            selection={comment.selection}
            title={comment.comment}
            tooltip
            wide
          />
        )}
      </For>
      <Show when={props.bounded && props.comments.length > 5 && !state.expanded}>
        <Button size="small" variant="ghost-muted" onClick={() => setState("expanded", true)}>
          {i18n.t("ui.common.showMore")}
        </Button>
      </Show>
    </div>
  )
}

export function CurrentUserMessageDisplay(props: {
  sessionID: string
  message: SessionMessageUser
  text: string
  agent: string
  model: SessionMessageAssistant["model"]
  actions?: SessionUserActions
  comments?: SessionUserComment[]
}) {
  const data = useData()
  const dialog = useDialog()
  const i18n = useI18n()
  const [state, setState] = createStore({ copied: false, reverting: false })
  const attachments = createMemo(() => (props.message.files ?? []).filter((file) => !file.mention))
  const inlineFiles = createMemo(() => (props.message.files ?? []).filter((file) => !!file.mention))
  const agents = createMemo(() => props.message.agents ?? [])
  const comments = createMemo(() => props.comments ?? [])
  const model = createMemo(() => {
    const match = data.store.provider?.all?.get(props.model.providerID)
    return match?.models?.[props.model.id]?.name ?? props.model.id
  })
  const timefmt = createMemo(() => new Intl.DateTimeFormat(i18n.locale(), { timeStyle: "short" }))
  const metaHead = createMemo(() => {
    const agent = props.agent
    return [agent ? agent[0]?.toUpperCase() + agent.slice(1) : "", model()].filter(Boolean).join("\u00A0\u00B7\u00A0")
  })
  const stamp = createMemo(() => timefmt().format(props.message.time.created))
  const copy = async () => {
    if (!props.text || !(await writeClipboard(props.text))) return
    setState("copied", true)
    setTimeout(() => setState("copied", false), 2000)
  }
  const revert = async () => {
    if (!props.actions?.revert || state.reverting) return
    setState("reverting", true)
    try {
      await props.actions.revert({ sessionID: props.sessionID, messageID: props.message.id })
    } finally {
      setState("reverting", false)
    }
  }
  const renderAttachments = () => (
    <Show when={attachments().length > 0}>
      <div data-slot="user-message-attachments">
        <For each={attachments()}>
          {(file) => {
            const url = () => (file.source.type === "uri" ? file.source.uri : `data:${file.mime};base64,${file.data}`)
            const name = () => file.name ?? i18n.t("ui.message.attachment.alt")
            const image = () => file.mime.startsWith("image/")
            return (
              <Show
                when={!image()}
                fallback={
                  <div
                    data-slot="user-message-attachment"
                    data-type="image"
                    data-clickable="true"
                    onClick={() => dialog.show(() => <ImagePreview src={url()} alt={name()} />)}
                  >
                    <img data-slot="user-message-attachment-image" src={url()} alt={name()} />
                  </div>
                }
              >
                <AttachmentCard
                  title={getFilename(name())}
                  hover={name()}
                  clickable={!!props.actions?.openAttachment}
                  onClick={() => props.actions?.openAttachment?.(file)}
                >
                  {typeLabel(name(), file.mime, i18n.t("ui.common.file"))}
                </AttachmentCard>
              </Show>
            )
          }}
        </For>
      </div>
    </Show>
  )

  return (
    <div data-component="user-message" data-timeline-part-id={props.text ? `${props.message.id}:text:0` : undefined}>
      <Show
        when={props.text}
        fallback={
          <Show when={comments().length > 0}>
            <UserMessageComments comments={comments()} bounded={false} />
          </Show>
        }
      >
        <div data-slot="user-message-body">
          <div data-slot="user-message-text" dir="auto" data-comments={comments().length > 0 ? "true" : undefined}>
            <CurrentHighlightedText text={props.text} files={inlineFiles()} agents={agents()} />
            <Show when={comments().length > 0}>
              <UserMessageComments comments={comments()} bounded />
            </Show>
          </div>
        </div>
      </Show>
      {renderAttachments()}
      <Show when={props.text || comments().length > 0}>
        <div data-slot="user-message-copy-wrapper">
          <span data-slot="user-message-meta-wrap">
            <Show when={metaHead()}>
              <span data-slot="user-message-meta" class="text-12-regular text-text-weak cursor-default">
                {metaHead()}
              </span>
            </Show>
            <Show when={metaHead() && stamp()}>
              <span data-slot="user-message-meta-sep" class="text-12-regular text-text-weak cursor-default">
                {"\u00A0\u00B7\u00A0"}
              </span>
            </Show>
            <span data-slot="user-message-meta-tail" class="text-12-regular text-text-weak cursor-default">
              {stamp()}
            </span>
          </span>
          <Show when={props.actions?.revert}>
            <MessageActionButton
              icon="reset"
              label={i18n.t("ui.message.revertMessage")}
              disabled={state.reverting}
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.stopPropagation()
                void revert()
              }}
              aria-label={i18n.t("ui.message.revertMessage")}
            />
          </Show>
          <Show when={props.text}>
            <MessageActionButton
              icon={state.copied ? "check" : "copy"}
              label={state.copied ? i18n.t("ui.message.copied") : i18n.t("ui.message.copyMessage")}
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.stopPropagation()
                void copy()
              }}
              aria-label={state.copied ? i18n.t("ui.message.copied") : i18n.t("ui.message.copyMessage")}
            />
          </Show>
        </div>
      </Show>
    </div>
  )
}

function CurrentHighlightedText(props: {
  text: string
  files: PromptFileAttachment[]
  agents: PromptAgentAttachment[]
}) {
  const segments = createMemo(() => {
    const references = [
      ...props.files.flatMap((file) =>
        file.mention ? [{ start: file.mention.start, end: file.mention.end, type: "file" as const }] : [],
      ),
      ...props.agents.flatMap((agent) =>
        agent.mention ? [{ start: agent.mention.start, end: agent.mention.end, type: "agent" as const }] : [],
      ),
    ].sort((a, b) => a.start - b.start)
    const result: HighlightSegment[] = []
    let last = 0
    references.forEach((reference) => {
      if (reference.start < last) return
      if (reference.start > last) result.push({ text: props.text.slice(last, reference.start) })
      result.push({ text: props.text.slice(reference.start, reference.end), type: reference.type })
      last = reference.end
    })
    if (last < props.text.length) result.push({ text: props.text.slice(last) })
    return result
  })
  return <For each={segments()}>{(segment) => <span data-highlight={segment.type}>{segment.text}</span>}</For>
}

type HighlightSegment = { text: string; type?: "file" | "agent" }

export function MessageDivider(props: { label: string }) {
  return (
    <div data-component="compaction-part">
      <div data-slot="compaction-part-divider">
        <span data-slot="compaction-part-line" />
        <span data-slot="compaction-part-label" class="text-12-regular text-text-weak">
          {props.label}
        </span>
        <span data-slot="compaction-part-line" />
      </div>
    </div>
  )
}

export function SessionCompactionMessage(props: { message: SessionMessageCompaction; error: string }) {
  const i18n = useI18n()
  const summary = () => (props.message.status === "failed" ? "" : props.message.summary)
  const error = () => {
    if (props.message.status !== "failed" || props.message.error.type === "aborted") return ""
    return props.error
  }

  return (
    <div data-component="session-compaction-message">
      <MessageDivider label={i18n.t("ui.messagePart.compaction")} />
      <Show when={summary().trim()}>
        <div data-component="text-part" data-timeline-part-id={props.message.id}>
          <div data-slot="text-part-body">
            <PacedMarkdown
              text={summary()}
              cacheKey={props.message.id}
              streaming={props.message.status === "running"}
            />
          </div>
        </div>
      </Show>
      <Show when={error()}>
        <Card variant="error" class="error-card">
          {error()}
        </Card>
      </Show>
    </div>
  )
}

export function AssistantTextContent(props: {
  id: string
  text: string
  message: SessionMessageAssistant
  showCopy: boolean
  turnDurationMs?: number | null
}) {
  const data = useData()
  const i18n = useI18n()
  const numfmt = createMemo(() => new Intl.NumberFormat(i18n.locale()))
  const interrupted = () => {
    const type = props.message.error?.type.toLowerCase()
    return !!type && (type.includes("abort") || type.includes("interrupt"))
  }
  const model = createMemo(() => {
    const match = data.store.provider?.all?.get(props.message.model.providerID)
    return match?.models?.[props.message.model.id]?.name ?? props.message.model.id
  })
  const duration = createMemo(() => {
    const completed = props.message.time.completed
    const ms =
      props.turnDurationMs === null
        ? -1
        : typeof props.turnDurationMs === "number"
          ? props.turnDurationMs
          : typeof completed === "number"
            ? completed - props.message.time.created
            : -1
    if (!(ms >= 0)) return ""
    const total = Math.round(ms / 1000)
    if (total < 60) return i18n.t("ui.message.duration.seconds", { count: numfmt().format(total) })
    return i18n.t("ui.message.duration.minutesSeconds", {
      minutes: numfmt().format(Math.floor(total / 60)),
      seconds: numfmt().format(total % 60),
    })
  })
  const meta = createMemo(() => {
    const agent = props.message.agent
    return [
      agent ? agent[0]?.toUpperCase() + agent.slice(1) : "",
      model(),
      duration(),
      interrupted() ? i18n.t("ui.message.interrupted") : "",
    ]
      .filter(Boolean)
      .join(" \u00B7 ")
  })
  const [copied, setCopied] = createSignal(false)
  const copy = async () => {
    if (!(await writeClipboard(props.text))) return
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Show when={props.text}>
      <div data-component="text-part" data-timeline-part-id={props.id}>
        <div data-slot="text-part-body">
          <PacedMarkdown
            text={props.text}
            cacheKey={props.id}
            streaming={typeof props.message.time.completed !== "number"}
          />
        </div>
        <Show when={props.showCopy}>
          <div data-slot="text-part-copy-wrapper" data-interrupted={interrupted() ? "" : undefined}>
            <MessageActionButton
              icon={copied() ? "check" : "copy"}
              label={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copyResponse")}
              onMouseDown={(event) => event.preventDefault()}
              onClick={copy}
              aria-label={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copyResponse")}
            />
            <Show when={meta()}>
              <span data-slot="text-part-meta" class="text-12-regular text-text-weak cursor-default">
                {meta()}
              </span>
            </Show>
          </div>
        </Show>
      </div>
    </Show>
  )
}

export function AssistantReasoningContent(props: { id: string; text: string; streaming: boolean }) {
  return (
    <Show when={props.text}>
      <div data-component="reasoning-part" data-timeline-part-id={props.id}>
        <PacedMarkdown text={props.text} cacheKey={props.id} streaming={props.streaming} />
      </div>
    </Show>
  )
}
