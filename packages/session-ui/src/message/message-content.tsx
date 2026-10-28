import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Index,
  on,
  onCleanup,
  onMount,
  Show,
  untrack,
  type ComponentProps,
  type JSX,
} from "solid-js"
import { createStore } from "solid-js/store"
import { createMediaQuery } from "@solid-primitives/media"
import { useData } from "../context"
import { useDialog } from "@opencode/ui/context/dialog"
import { useI18n } from "@opencode/ui/context/i18n"
import { Markdown } from "../components/markdown"
import { linkSegments } from "../components/link-segments"
import { sessionReferenceText, setupSessionLinks } from "../components/markdown-session-links"
import { useMarkdown } from "../context/markdown"
import { useSources } from "../context/sources"
import { SourcesChip } from "../sources/sources-chip"
import type { TurnSources } from "../sources/sources"
import { ImagePreview } from "@opencode/ui/image-preview"
import { getFilename } from "@opencode/util/path"
import { AttachmentCard } from "./attachment-card"
import { CommentCard, commentCardTarget, quoteTooltip } from "./comment-card"
import { TimelineSeparator } from "../components/timeline-separator"
import { Tooltip } from "@opencode/ui/tooltip"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import { Icon } from "@opencode/ui/icon"
import { Button } from "@opencode/ui/button"
import { TextReveal } from "@opencode/ui/text-reveal"
import { TextShimmer } from "@opencode/ui/text-shimmer"
import { BasicTool } from "../components/basic-tool"
import { reasoningHeading } from "../timeline/projection"
import { Card } from "@opencode/ui/card"
import { springStyle } from "@opencode/ui/motion/solid"
import { userRunSpring, type UserRun } from "../timeline/user-runs"
import type {
  PromptAgentAttachment,
  PromptFileAttachment,
  SessionMessageAssistant,
  SessionMessageAssistantReasoning,
  SessionMessageCompaction,
  SessionMessageUser,
} from "@opencode/client/promise"
import type { SessionUserActions, SessionUserAttachmentReference, SessionUserComment } from "../actions"
import { agentLabel } from "./agent-label"
import { relativeTime, useNow } from "./relative-time"
import { attached, typeLabel } from "../components/message-file"

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

type MetaItem = { label: string; variant?: boolean }

const RELATIVE_TIME_KEYS = {
  minute: "ui.message.time.minutesAgo",
  hour: "ui.message.time.hoursAgo",
  day: "ui.message.time.daysAgo",
} as const

// The variant follows the model name without a separator and renders dimmer, so the model leads.
function modelItems(data: ReturnType<typeof useData>, model: SessionMessageAssistant["model"]): MetaItem[] {
  const name = data.store.provider?.all?.get(model.providerID)?.models?.[model.id]?.name ?? model.id

  if (!model.variant || model.variant === "default") return [{ label: name }]

  return [{ label: name }, { label: model.variant[0]?.toUpperCase() + model.variant.slice(1), variant: true }]
}

function MetaItems(props: { items: MetaItem[]; slot: "user-message" | "text-part" }) {
  return (
    <For each={props.items}>
      {(item, index) => (
        <>
          <Show when={index() > 0 && !item.variant}>
            <span data-slot={`${props.slot}-meta-separator`} aria-hidden="true">
              {"\u00B7"}
            </span>
          </Show>
          <span
            data-slot={`${props.slot}-meta-item`}
            data-variant={item.variant ? "" : undefined}
            dir={props.slot === "text-part" ? "auto" : undefined}
          >
            {item.label}
          </span>
        </>
      )}
    </For>
  )
}

function MessageActionButton(
  props: Pick<ComponentProps<"button">, "disabled" | "onMouseDown" | "onClick" | "aria-label"> & {
    icon: "check" | "copy" | "reset" | "fork" | "arrow-down-to-line" | "outline-trash"
    label: JSX.Element
    size?: "small" | "normal"
  },
) {
  const icon = () => (props.icon === "copy" ? "outline-copy" : props.icon)

  return (
    <Tooltip appearance="compact" value={props.label} placement="top" gutter={4}>
      <IconButton
        icon={<Icon name={icon()} size="small" />}
        size={props.size ?? "normal"}
        variant="ghost-muted"
        disabled={props.disabled}
        onMouseDown={props.onMouseDown}
        onClick={props.onClick}
        aria-label={props["aria-label"]}
      />
    </Tooltip>
  )
}

function UserMessageTransition(props: { active: boolean; children: JSX.Element }) {
  return (
    <span
      data-slot="user-message-transition"
      data-active={props.active}
      inert={!props.active}
      aria-hidden={!props.active}
    >
      <span data-slot="user-message-transition-inner">{props.children}</span>
    </span>
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
            comment={comment.comment ?? ""}
            target={commentCardTarget(comment)}
            title={comment.type === "quote" ? quoteTooltip(comment) : comment.comment}
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
  references?: SessionUserAttachmentReference[]
  voice?: boolean
  run?: UserRun
}) {
  const data = useData()
  const dialog = useDialog()
  const i18n = useI18n()

  const [state, setState] = createStore({ copied: false, reverting: false, forking: false, updating: false })

  const status = createMemo(() => props.actions?.pending?.status(props.message.id))
  const pending = createMemo(() => status() !== undefined && status() !== "queued")
  const waiting = createMemo(() => status() === "steering" || status() === "stranded")
  const attachments = createMemo(() => (props.message.files ?? []).filter(attached))
  const references = createMemo(() => props.references ?? [])
  const inlineFiles = createMemo(() => (props.message.files ?? []).filter((file) => !!file.mention))
  const agents = createMemo(() => props.message.agents ?? [])
  const comments = createMemo(() => props.comments ?? [])
  const numfmt = createMemo(() => new Intl.NumberFormat(i18n.locale()))
  const datefmt = createMemo(() => new Intl.DateTimeFormat(i18n.locale(), { dateStyle: "medium" }))
  const fulltimefmt = createMemo(() => new Intl.DateTimeFormat(i18n.locale(), { dateStyle: "full", timeStyle: "long" }))
  const now = useNow()

  // Mobile shows the current agent and model in the composer and switch notices, so repeating them per message is noise.
  const mobile = createMediaQuery("(max-width: 767px)")

  const labels = createMemo<MetaItem[]>(() => {
    const agent = agentLabel(props.agent, data.agents)

    return [...(agent ? [{ label: agent }] : []), ...modelItems(data, props.model)]
  })

  const metaLabels = createMemo(() => (mobile() ? [] : labels()))

  const stamp = createMemo(() => {
    const created = props.message.time.created
    const relative = relativeTime(created, now())

    if (relative.unit === "now") return i18n.t("ui.message.time.justNow")

    if (relative.unit === "date") return datefmt().format(created)

    return i18n.t(RELATIVE_TIME_KEYS[relative.unit], { count: numfmt().format(relative.count) })
  })


  // In a run, only the last message keeps the meta line; the others offer their actions beside the bubble.
  // Bubble corners tighten where two bubbles meet, as in the iOS app's grouped corners.
  const folded = createMemo(() => !!props.run?.below && !!props.text)

  const meetsAbove = createMemo(
    () => !!props.run?.above && !!props.text && attachments().length === 0 && references().length === 0,
  )

  const runPose = () => ({
    meta: folded() ? 0 : 1,
    top: meetsAbove() ? 1 : 0,
    bottom: folded() ? 1 : 0,
  })

  // The first paint is the resting pose; the spring's first write lands a frame later.
  const restingPose = untrack(runPose)

  let root: HTMLDivElement | undefined
  springStyle(
    () => root,
    runPose,
    (el, value) => {
      el.style.setProperty("--user-run-meta", `${value.meta}`)
      el.style.setProperty("--user-run-top", `${value.top}`)
      el.style.setProperty("--user-run-bottom", `${value.bottom}`)
      el.toggleAttribute("data-run-meta-hidden", value.meta === 0)
    },
    // Folding a meta line away is instant; the next message's line takes its place as that message grows in.
    { ...userRunSpring, snap: folded },
  )

  // Delivery drops the Pending footer at once rather than fading it like the hover reveal.
  createEffect(
    on(
      waiting,
      (now, before) => {
        if (now || !before || !root) return
        const element = root
        element.toggleAttribute("data-delivering", true)
        requestAnimationFrame(() => element.toggleAttribute("data-delivering", false))
      },
      { defer: true },
    ),
  )

  const copy = async (text: string) => {
    if (!text || !(await writeClipboard(text))) return
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

  const fork = async () => {
    if (!props.actions?.fork || state.forking) return
    setState("forking", true)

    try {
      await props.actions.fork({ sessionID: props.sessionID, messageID: props.message.id })
    } finally {
      setState("forking", false)
    }
  }

  const updatePending = async (action: "queue" | "remove") => {
    const actions = props.actions?.pending

    if (!actions || state.updating) return
    setState("updating", true)
    await actions[action]({ sessionID: props.sessionID, messageID: props.message.id })
    setState("updating", false)
  }

  const renderActions = () => (
    <span data-slot="user-message-actions">
      <Show when={props.actions?.pending}>
        <UserMessageTransition active={pending()}>
          <MessageActionButton
            icon="arrow-down-to-line"
            size="small"
            label={i18n.t("ui.message.moveToQueue")}
            disabled={state.updating}
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.stopPropagation()
              void updatePending("queue")
            }}
            aria-label={i18n.t("ui.message.moveToQueue")}
          />
          <MessageActionButton
            icon="outline-trash"
            size="small"
            label={i18n.t("ui.message.deletePending")}
            disabled={state.updating}
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.stopPropagation()
              void updatePending("remove")
            }}
            aria-label={i18n.t("ui.message.deletePending")}
          />
        </UserMessageTransition>
      </Show>
      <Show when={props.actions?.revert}>
        <UserMessageTransition active={!pending()}>
          <MessageActionButton
            icon="reset"
            size="small"
            label={i18n.t("ui.message.revertMessage")}
            disabled={state.reverting}
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.stopPropagation()
              void revert()
            }}
            aria-label={i18n.t("ui.message.revertMessage")}
          />
        </UserMessageTransition>
      </Show>
      <Show when={props.actions?.fork}>
        <UserMessageTransition active={!pending()}>
          <MessageActionButton
            icon="fork"
            size="small"
            label={i18n.t("ui.message.forkMessage")}
            disabled={state.forking}
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.stopPropagation()
              void fork()
            }}
            aria-label={i18n.t("ui.message.forkMessage")}
          />
        </UserMessageTransition>
      </Show>
      {/* Like the iOS app, a Voice message's copy also offers the full prompt the session received, on right click. */}
      <Show
        when={props.voice}
        fallback={
          <Show when={props.text}>
            <MessageActionButton
              icon={state.copied ? "check" : "copy"}
              size="small"
              label={state.copied ? i18n.t("ui.message.copied") : i18n.t("ui.message.copyMessage")}
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.stopPropagation()
                void copy(props.text)
              }}
              aria-label={state.copied ? i18n.t("ui.message.copied") : i18n.t("ui.message.copyMessage")}
            />
          </Show>
        }
      >
        <Menu.Context modal={false}>
          <Tooltip
            appearance="compact"
            value={state.copied ? i18n.t("ui.message.copied") : i18n.t("ui.message.copyMessage")}
            placement="top"
            gutter={4}
          >
            <Menu.Context.Trigger
              as={IconButton}
              icon={<Icon name={state.copied ? "check" : "outline-copy"} size="small" />}
              size="small"
              variant="ghost-muted"
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.stopPropagation()
                void copy(props.text)
              }}
              aria-label={state.copied ? i18n.t("ui.message.copied") : i18n.t("ui.message.copyMessage")}
            />
          </Tooltip>
          <Menu.Context.Portal>
            <Menu.Context.Content>
              <Menu.Item onSelect={() => void copy(props.text)}>{i18n.t("ui.message.copyMessage")}</Menu.Item>
              <Menu.Item onSelect={() => void copy(props.message.text)}>
                {i18n.t("ui.message.copyFullMessage")}
              </Menu.Item>
            </Menu.Context.Content>
          </Menu.Context.Portal>
        </Menu.Context>
      </Show>
    </span>
  )

  const renderAttachments = () => (
    <Show when={attachments().length > 0 || references().length > 0}>
      <div data-slot="user-message-attachments">
        <For each={references()}>
          {(file) => (
            <AttachmentCard title={file.name} hover={file.path}>
              {typeLabel(file.name, file.mime, i18n.t("ui.common.file"))}
            </AttachmentCard>
          )}
        </For>
        <Index each={attachments()}>
          {(file) => {
            const url = () => {
              const source = file().source

              return source.type === "uri" ? source.uri : `data:${file().mime};base64,${file().data}`
            }

            const name = () => file().name ?? i18n.t("ui.message.attachment.alt")
            const image = () => file().mime.startsWith("image/")

            return (
              <Show
                when={!image()}
                fallback={
                  <div
                    data-slot="user-message-attachment"
                    data-type="image"
                    data-clickable="true"
                    onClick={(event) => {
                      const origin = event.currentTarget
                      dialog.show(() => <ImagePreview src={url()} alt={name()} origin={origin} />)
                    }}
                  >
                    <img data-slot="user-message-attachment-image" src={url()} alt={name()} />
                  </div>
                }
              >
                <AttachmentCard
                  title={getFilename(name())}
                  hover={name()}
                  clickable={!!props.actions?.openAttachment}
                  onClick={() => props.actions?.openAttachment?.(file())}
                >
                  {typeLabel(name(), file().mime, i18n.t("ui.common.file"))}
                </AttachmentCard>
              </Show>
            )
          }}
        </Index>
      </div>
    </Show>
  )

  return (
    <div
      ref={root}
      data-component="user-message"
      data-pending={waiting() ? "true" : undefined}
      data-run-folded={folded() ? "" : undefined}
      data-run-meta-hidden={restingPose.meta === 0 ? "" : undefined}
      style={{
        "--user-run-meta": `${restingPose.meta}`,
        "--user-run-top": `${restingPose.top}`,
        "--user-run-bottom": `${restingPose.bottom}`,
      }}
      data-timeline-part-id={props.text ? `${props.message.id}:text:0` : undefined}
    >
      {renderAttachments()}
      <Show
        when={props.text}
        fallback={
          <Show when={comments().length > 0}>
            <UserMessageComments comments={comments()} bounded={false} />
          </Show>
        }
      >
        <div data-slot="user-message-body" data-voice={props.voice ? "true" : undefined}>
          <Show when={props.voice}>
            <div data-slot="user-message-voice" role="img" aria-label={i18n.t("ui.message.voice")}>
              <Tooltip appearance="compact" value={i18n.t("ui.message.voice")} placement="top" gutter={4}>
                <Icon name="outline-wave-audio" size="small" />
              </Tooltip>
            </div>
          </Show>
          <div data-slot="user-message-text" dir="auto" data-comments={comments().length > 0 ? "true" : undefined}>
            <CurrentHighlightedText text={props.text} files={inlineFiles()} agents={agents()} />
            <Show when={comments().length > 0}>
              <UserMessageComments comments={comments()} bounded />
            </Show>
          </div>
          <Show when={folded()}>
            <div data-slot="user-message-run-actions">{renderActions()}</div>
          </Show>
        </div>
      </Show>
      {/* Like the TUI, a pending steer of only attachments still offers its actions. */}
      <Show when={props.text || comments().length > 0 || pending()}>
        <div data-slot="user-message-copy-wrapper">
          <span data-slot="user-message-meta-wrap">
            <span data-slot="user-message-meta">
              <UserMessageTransition active={waiting()}>
                <span data-slot="user-message-pending" aria-hidden="true">
                  <Icon name="outline-steer" size="small" />
                </span>
                <span>{i18n.t("ui.message.pending")}</span>
                <Show when={metaLabels().length > 0}>
                  <span data-slot="user-message-meta-separator" aria-hidden="true">
                    {"\u00B7"}
                  </span>
                </Show>
              </UserMessageTransition>
              <Show when={metaLabels().length > 0}>
                <span data-slot="user-message-meta-label">
                  <MetaItems items={metaLabels()} slot="user-message" />
                </span>
              </Show>
              {/* A pending steer has not been sent, so Pending stands in for the time instead of reserving its width. */}
              <UserMessageTransition active={!waiting()}>
                <span data-slot="user-message-meta-tail">
                  <Show when={metaLabels().length > 0}>
                    <span data-slot="user-message-meta-separator" aria-hidden="true">
                      {"\u00B7"}
                    </span>
                  </Show>
                  <Tooltip
                    appearance="compact"
                    value={fulltimefmt().format(props.message.time.created)}
                    placement="top"
                    triggerTabIndex={0}
                    openDelay={800}
                  >
                    <time dir="auto" dateTime={new Date(props.message.time.created).toISOString()}>
                      {stamp()}
                    </time>
                  </Tooltip>
                </span>
              </UserMessageTransition>
            </span>
          </span>
          {renderActions()}
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

    // Plain text between references may contain URLs, which become links.
    const pushText = (text: string) =>
      result.push(
        ...linkSegments(text).map(
          (segment): HighlightSegment => ({
            text: segment.text,
            type: segment.href ? "link" : undefined,
          }),
        ),
      )

    let last = 0
    references.forEach((reference) => {
      if (reference.start < last) return

      if (reference.start > last) pushText(props.text.slice(last, reference.start))
      result.push({ text: props.text.slice(reference.start, reference.end), type: reference.type })
      last = reference.end
    })

    if (last < props.text.length) pushText(props.text.slice(last))

    return result
  })

  return (
    <For each={segments()}>
      {(segment) => (
        <Show
          when={segment.type === "link"}
          fallback={
            <span data-highlight={segment.type}>
              <Show
                when={segment.type && segment.text.startsWith("@")}
                fallback={<SessionReferenceText text={segment.text} />}
              >
                <span data-slot="user-message-mention-prefix">@</span>
                {segment.text.slice(1)}
              </Show>
            </span>
          }
        >
          <a data-slot="user-message-link" href={segment.text} target="_blank" rel="noopener noreferrer">
            {segment.text}
          </a>
        </Show>
      )}
    </For>
  )
}

type HighlightSegment = { text: string; type?: "file" | "agent" | "link" }

function SessionReferenceText(props: { text: string }) {
  const markdown = useMarkdown()
  const root = document.createElement("span")
  createEffect(() => root.replaceChildren(sessionReferenceText(props.text, (id) => markdown?.sessionTitle?.(id))))
  onCleanup(setupSessionLinks(root, () => markdown?.openSession))

  return root
}

/** A compaction the server admitted but has not started, drawn as the divider a started one opens with. */
export function SessionCompactionQueued() {
  const i18n = useI18n()

  return (
    <div data-component="session-compaction-message">
      <CompactionDivider label={i18n.t("ui.messagePart.compaction.queued")} />
    </div>
  )
}

function CompactionDivider(props: { label: string }) {
  return (
    <div class="py-2">
      <TimelineSeparator label={props.label} />
    </div>
  )
}

export function SessionCompactionMessage(props: { message: SessionMessageCompaction; error: string }) {
  const i18n = useI18n()
  const data = useData()
  const summary = () => (props.message.status === "failed" ? "" : props.message.summary)

  const error = () => {
    if (props.message.status !== "failed") return ""

    if (props.message.error.type === "aborted" || props.message.error.type === "compaction.interrupted") return ""

    return props.error
  }

  const compact = createMemo(
    () => new Intl.NumberFormat(i18n.locale(), { notation: "compact", maximumFractionDigits: 1 }),
  )

  // Usage of the compaction request itself; the resulting context size only shows on the next assistant step.
  const usage = () => {
    if (props.message.status === "running" || !props.message.tokens) return ""
    const tokens = props.message.tokens
    const input = tokens.input + tokens.cache.read + tokens.cache.write
    const output = tokens.output + tokens.reasoning

    if (input + output <= 0) return ""

    return i18n.t("ui.messagePart.compaction.usage", {
      input: compact().format(input),
      output: compact().format(output),
    })
  }

  const outcome = () => {
    if (props.message.status !== "failed")
      return props.message.status === "completed" && props.message.native?.messages
        ? "ui.messagePart.providerCompaction"
        : "ui.messagePart.compaction"

    if (props.message.error.type === "aborted") return "ui.messagePart.compaction.cancelled"

    if (props.message.error.type === "compaction.interrupted") return "ui.messagePart.compaction.interrupted"

    return "ui.messagePart.compaction.failed"
  }

  const label = createMemo(() => [i18n.t(outcome()), usage()].filter(Boolean).join(" · "))

  return (
    <Show
      when={!data.backgroundCompaction || props.message.reason === "manual" || props.message.status === "failed"}
      fallback={
        <QuietCompaction
          id={props.message.id}
          created={props.message.time.created}
          running={props.message.status === "running"}
          summary={summary()}
          usage={usage()}
        />
      }
    >
      <div data-component="session-compaction-message">
        <CompactionDivider label={i18n.t("ui.messagePart.compaction.started")} />
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
        <Show when={props.message.status === "running"}>
          <div role="status" class="py-2">
            <BasicTool
              icon="archive"
              trigger={{ title: i18n.t("ui.messagePart.compaction.running") }}
              status="running"
              locked
              hideDetails
            />
          </div>
        </Show>
        <Show when={props.message.status !== "running"}>
          <div class="py-2">
            <TimelineSeparator label={label()} />
          </div>
        </Show>
        <Show when={error()}>
          <Card variant="error" class="error-card">
            {error()}
          </Card>
        </Show>
      </div>
    </Show>
  )
}

/**
 * An automatic compaction, drawn as one divider that reads Compacting, then Compacted. Its height never changes, and
 * clicking it opens the summary.
 */
function QuietCompaction(props: { id: string; created: number; running: boolean; summary: string; usage: string }) {
  const i18n = useI18n()
  const [open, setOpen] = createSignal(false)
  // A new one waits out the grace (400 ms, matched in session-compaction.css) before showing Compacting; one that
  // ends inside it, as a precomputed summary does, only fades in as Compacted. One already running or finished when
  // the history loads shows without an entrance.
  const mounted = performance.now()
  const age = Date.now() - props.created

  const [enter, setEnter] = createSignal(
    props.running ? (age < 400 ? "grace" : undefined) : age < 1_000 ? "now" : undefined,
  )

  const expandable = () => !props.running && !!props.summary.trim()

  const label = createMemo(() =>
    splitEnding(i18n.t("ui.messagePart.compaction.running"), i18n.t("ui.messagePart.compaction.done")),
  )

  createEffect(() => {
    if (!props.running && enter() === "grace" && performance.now() - mounted < 400) setEnter("now")
  })

  return (
    <div data-component="session-compaction-message" data-quiet="" data-enter={enter()}>
      <div class="py-2">
        <button
          type="button"
          data-slot="session-compaction-divider"
          data-state={props.running ? "running" : "done"}
          class="flex h-8 w-full items-center gap-3 text-v2-text-text-faint"
          disabled={!expandable()}
          aria-busy={props.running}
          aria-expanded={expandable() ? open() : undefined}
          aria-controls={expandable() && open() ? `${props.id}-summary` : undefined}
          aria-label={props.running ? label().running : label().done}
          onClick={() => setOpen((value) => !value)}
        >
          <span data-slot="session-compaction-line" data-side="start" class="h-px min-w-0 flex-1">
            <span data-slot="session-compaction-light" />
          </span>
          <span
            data-slot="session-compaction-label"
            class="relative flex shrink-0 whitespace-nowrap text-[13px] font-[440] leading-text-compact tracking-[-0.04px]"
          >
            <span>{label().stem}</span>
            <span data-slot="session-compaction-ending" class="grid justify-items-start">
              <span data-slot="session-compaction-running">{label().ending.running}</span>
              <span data-slot="session-compaction-done">{label().ending.done}</span>
            </span>
            <span data-slot="session-compaction-glint" aria-hidden="true">
              <span data-slot="session-compaction-glint-stem">{label().stem}</span>
              <span data-slot="session-compaction-glint-ending">{label().ending.running}</span>
            </span>
          </span>
          <span data-slot="session-compaction-line" data-side="end" class="h-px min-w-0 flex-1">
            <span data-slot="session-compaction-light" />
          </span>
        </button>
      </div>
      <Show when={expandable() && open()}>
        <div id={`${props.id}-summary`} data-slot="session-compaction-summary">
          <div data-component="text-part" data-timeline-part-id={props.id}>
            <div data-slot="text-part-body">
              <PacedMarkdown text={props.summary} cacheKey={props.id} streaming={false} />
            </div>
          </div>
          <Show when={props.usage}>
            <div class="mt-2 text-[13px] leading-text-compact text-v2-text-text-faint tabular-nums">{props.usage}</div>
          </Show>
        </div>
      </Show>
    </div>
  )
}

/** Splits Compacting and Compacted at their shared stem, so only the ending changes when the compaction ends. */
function splitEnding(running: string, done: string) {
  const chars = [...running]
  const others = [...done]
  const at = chars.findIndex((char, index) => char !== others[index])
  const stem = chars.slice(0, at === -1 ? chars.length : at).join("")

  return { running, done, stem, ending: { running: running.slice(stem.length), done: done.slice(stem.length) } }
}

export function AssistantTextContent(props: {
  id: string
  text: string
  message: SessionMessageAssistant
  showCopy: boolean
  turnDurationMs?: number | null
  /** The finished turn's web searches and fetches, shown as a chip in its footer. */
  sources?: TurnSources
  onOpenSources?: () => void
}) {
  const data = useData()
  const i18n = useI18n()
  const sourcesHost = useSources()
  const numfmt = createMemo(() => new Intl.NumberFormat(i18n.locale()))
  // A footer that arrives after the reply rendered belongs to a turn that just finished, so its chip fades in.
  let rendered = false
  onMount(() => (rendered = true))
  const sources = () => (props.showCopy && sourcesHost?.enabled ? props.sources : undefined)

  const interrupted = () => {
    const type = props.message.error?.type.toLowerCase()

    return !!type && (type.includes("abort") || type.includes("interrupt"))
  }

  const labels = createMemo<MetaItem[]>(() => {
    const agent = agentLabel(props.message.agent, data.agents)

    return [...(agent ? [{ label: agent }] : []), ...modelItems(data, props.message.model)]
  })

  const duration = createMemo(() => {
    const completed = props.message.time.completed

    const ms =
      props.turnDurationMs === null
        ? -1
        : props.turnDurationMs !== undefined
          ? props.turnDurationMs
          : completed !== undefined
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

  // Mobile omits the per-response agent and model; see CurrentUserMessageDisplay.
  const mobile = createMediaQuery("(max-width: 767px)")

  const meta = createMemo<MetaItem[]>(() => [
    ...(mobile() ? [] : labels()),
    ...[duration(), interrupted() ? i18n.t("ui.message.interrupted") : ""].flatMap((label) =>
      label ? [{ label }] : [],
    ),
  ])

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
          <PacedMarkdown text={props.text} cacheKey={props.id} streaming={props.message.time.completed === undefined} />
        </div>
        <Show when={sources()} fallback={<Show when={props.showCopy}>{copyFooter()}</Show>}>
          {(value) => (
            <div data-slot="text-part-footer">
              <SourcesChip
                sources={value()}
                icons={sourcesHost?.icons ?? "letters"}
                appear={rendered}
                onOpen={() => props.onOpenSources?.()}
              />
              {copyFooter()}
            </div>
          )}
        </Show>
      </div>
    </Show>
  )

  function copyFooter() {
    return (
      <div data-slot="text-part-copy-wrapper" data-interrupted={interrupted() ? "" : undefined}>
        <MessageActionButton
          icon={copied() ? "check" : "copy"}
          size="small"
          label={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copyResponse")}
          onMouseDown={(event) => event.preventDefault()}
          onClick={copy}
          aria-label={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copyResponse")}
        />
        <Show when={meta().length > 0}>
          <span data-slot="text-part-meta">
            <MetaItems items={meta()} slot="text-part" />
          </span>
        </Show>
      </div>
    )
  }
}

export function AssistantReasoningContent(props: {
  id: string
  content: SessionMessageAssistantReasoning
  streaming: boolean
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onContentRendered?: () => void
}) {
  const i18n = useI18n()
  const [state, setState] = createStore<{ open?: boolean }>({})
  const open = () => props.open ?? state.open ?? props.defaultOpen ?? false
  const heading = createMemo(() => (props.streaming ? reasoningHeading(props.content.text) : ""))

  const duration = createMemo(() => {
    const time = props.content.time

    if (time?.completed === undefined) return undefined
    const total = Math.max(0, Math.round((time.completed - time.created) / 1000))
    const numfmt = new Intl.NumberFormat(i18n.locale())

    if (total < 60) return i18n.t("ui.message.duration.seconds", { count: numfmt.format(total) })

    return i18n.t("ui.message.duration.minutesSeconds", {
      minutes: numfmt.format(Math.floor(total / 60)),
      seconds: numfmt.format(total % 60),
    })
  })

  return (
    <div data-component="reasoning-part" data-timeline-part-id={props.id}>
      <BasicTool
        icon="mcp"
        status={props.streaming ? "running" : "completed"}
        compact
        hasContent
        allowOpenWhilePending
        hideDetails={!props.content.text.trim()}
        open={open()}
        onOpenChange={(value) => {
          setState("open", value)
          props.onOpenChange?.(value)
          props.onContentRendered?.()
        }}
        trigger={
          <div data-slot="basic-tool-tool-info-structured">
            <div data-slot="basic-tool-tool-info-main">
              <span data-slot="basic-tool-tool-title">
                <TextShimmer
                  text={i18n.t(props.streaming ? "ui.sessionTurn.status.thinking" : "ui.message.thought")}
                  active={props.streaming}
                />
              </span>
              <Show
                when={props.streaming && !open()}
                fallback={
                  <Show when={!props.streaming && duration()}>
                    {(value) => <span data-slot="basic-tool-tool-subtitle">{value()}</span>}
                  </Show>
                }
              >
                <span data-slot="basic-tool-tool-subtitle">
                  <TextReveal text={heading()} />
                </span>
              </Show>
            </div>
          </div>
        }
      >
        <PacedMarkdown text={props.content.text} cacheKey={props.id} streaming={props.streaming} />
      </BasicTool>
    </div>
  )
}
