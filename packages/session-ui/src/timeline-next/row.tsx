import type {
  SessionMessageAssistant,
  SessionMessageInfo,
  SessionMessageUser,
  SessionStatus,
} from "@opencode/client/promise"
import { useI18n } from "@opencode/ui/context/i18n"
import { SessionTurn } from "@opencode/util/session-turn"
import { Predicate } from "effect"
import {
  For,
  Match,
  Show,
  Switch,
  createComputed,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  untrack,
  type Accessor,
  type JSX,
} from "solid-js"
import { DiffChanges } from "@opencode/ui/diff-changes"
import { Icon } from "@opencode/ui/icon"
import { Spring, frameLoop, prefersReducedMotion } from "@opencode/ui/motion"
import { springStyle } from "@opencode/ui/motion/solid"
import { Dynamic } from "solid-js/web"
import type { SessionUserActions, SessionUserAttachmentReference, SessionUserComment } from "../actions"
import { useData } from "../context"
import { useSources } from "../context/sources"
import { turnSources } from "../sources/sources"
import { SessionReadToolGroup, SessionUserMessage } from "../message/current-message"
import { SessionCompactionMessage, SessionCompactionQueued } from "../message/message-content"
import { taskAgentName, type ContextGroupPart } from "../tools/tool-renderer"
import { SessionRetry } from "../components/session-retry"
import { SessionError } from "../components/session-error"
import type { TimelineDetail } from "../timeline/detail"
import { TimelineRow, type PartRef } from "../timeline/timeline-row"
import { userMessageRuns, userRunSpring } from "../timeline/user-runs"
import { IDLE_TURN_PHASE, sameRef, viewTurnPhase } from "../timeline/turn-phase-machine"
import {
  DISPOSED_STEER_ARRIVAL_EVENT,
  INITIAL_STEER_ARRIVAL_STATE,
  shouldGrowUserMessage,
  shouldSnapUserRun,
  transitionSteerArrival,
} from "../timeline/steer-arrival-machine"
import { Badge } from "@opencode/ui/badge"
import { attached } from "../components/message-file"
import { unwrapErrorMessage } from "./errors"
import { TimelineEventRow } from "./event-row"
import { noticeEvent, toolEvent } from "./events"
import { trackNestedRails } from "./nested-rail"
import { contentEntries, createNextTimelineProjection, resolveContent, workedDuration } from "./projection"
import { contentOpens, diffOpens, goal as goalMessage, thoughtOpens, toolRule, userShellOpens } from "./rules"
import { Separator } from "./separator"
import { timelineGaps } from "./spacing"
import { AssistantContent } from "./tools/assistant-content"
import { ContextGroup } from "./tools/context-group"
import { FileGroup } from "./tools/file-group"
import { PatchTool } from "./tools/patch"
import { ShellMessage } from "./tools/shell"
import { ThoughtRow } from "./tools/thought"

const emptyAssistantMessages: SessionMessageAssistant[] = []

// Past this many files, the rest of a turn's changes wait behind "Show all".
const turnDiffFileLimit = 5

type Projection = ReturnType<typeof createNextTimelineProjection>

type FramedTimelineRow = Exclude<TimelineRow.TimelineRow, TimelineRow.TurnGap>

type Outcome = "completed" | "error" | "cancelled"

export type SessionUserPresentation = {
  displayText?: string
  comments?: SessionUserComment[]
  references?: SessionUserAttachmentReference[]
  /** A voice call's agent sent it on the user's behalf. */
  voice?: boolean
}

/** Draws the New timeline's rows. */
export function createNextTimelineRowRenderer(input: {
  sessionID: Accessor<string>
  status: Accessor<SessionStatus>
  projection: Projection
  presentation: (message: SessionMessageUser) => SessionUserPresentation | undefined
  actions?: SessionUserActions
  timelineDetail: Accessor<TimelineDetail>
  foldUserMessages?: Accessor<boolean>
  disclosure: {
    value: (key: string) => boolean | undefined
    set: (key: string, open: boolean) => void
    patchGroupKeys?: Map<string, string>
  }
  centered?: Accessor<boolean>
  padding?: Accessor<string>
  anchor?: (messageID: string) => string | undefined
  /** Scrolls to and expands the tool call named by its ID or by the shell ID a backgrounded shell call reports. */
  revealPart?: (target: string) => boolean
}) {
  const i18n = useI18n()
  const data = useData()
  const sourcesHost = useSources()
  // Cached timelines retain file-change subgroup identities alongside their disclosure choices.
  const patchGroupKeys = input.disclosure.patchGroupKeys ?? new Map<string, string>()
  const patchPartKeys = new WeakMap<SessionMessageAssistant["content"][number], string>()

  const turns = createMemo(() => {
    const messages = [...input.projection.messageByID().values()]

    return {
      messages,
      legacy: SessionTurn.legacy(messages),
      indexes: new Map(messages.map((message, index) => [message.id, index])),
    }
  })

  const patchOwners = createMemo(() => {
    const owners = new Map<string, string>()
    const rows = input.projection.rows()
    // Track status changes before a group is first opened: a failed file change can
    // split an existing group without changing the projection's row identities.
    rows.forEach((row) => {
      if (!Predicate.isTagged(row, "AssistantPart") || row.group.type !== "context") return
      row.group.refs.forEach((ref) => {
        const content = resolveContent(input.projection.messageByID().get(ref.messageID), ref.partID)

        if (content?.type !== "tool" || toolRule(content).layout !== "file" || content.state.status === "error") return
        const part = `${ref.messageID}:${ref.partID}`
        const key = patchGroupKeys.get(part)

        if (key && !owners.has(key)) owners.set(key, part)
      })
    })

    return owners
  })

  const runs = createMemo(() => {
    const messages = input.projection.messageByID()
    const context = input.projection.userContextByID()

    return userMessageRuns(input.projection.rows(), [...messages.values()], (id) => {
      const message = messages.get(id)
      const user = context.get(id)

      if (message?.type !== "user" || !user) return undefined
      const status = input.actions?.pending?.status(id)
      const presentation = input.presentation(message)

      return {
        kind: status === "steering" || status === "stranded" || status === "sending" ? "pending" : "sent",
        agent: user.agent,
        model: user.model,
        text: !!(presentation?.displayText ?? message.text),
        attachments: (message.files ?? []).some(attached) || !!presentation?.references?.length,
      }
    })
  })

  // A steer sent while the timeline is open grows in. Messages already there when a session loads, history loaded
  // above them, and rows the virtualizer remounts appear as they are. Every row change syncs here, so the driver reuses
  // its events and skips a sync whose inputs did not change.
  let arrivals = INITIAL_STEER_ARRIVAL_STATE
  const arrivalRendered = { type: "rendered" as const, messageID: "" }

  const noRows: readonly TimelineRow.TimelineRow[] = []
  const arrivalSync = { type: "sync" as const, sessionID: "", rows: noRows, busy: false }
  const arrivalGrown = { type: "grown" as const, messageID: "" }

  const syncArrivals = () => {
    const sessionID = input.sessionID()
    const rows = input.projection.rows()
    // The input's pending status lands after its row, so a message sent while the session works counts as a steer.
    const busy = input.status().type !== "idle"

    if (sessionID === arrivalSync.sessionID && rows === arrivalSync.rows && busy === arrivalSync.busy) return
    arrivalSync.sessionID = sessionID
    arrivalSync.rows = rows
    arrivalSync.busy = busy
    arrivals = transitionSteerArrival(arrivals, arrivalSync)
  }

  createComputed(syncArrivals)
  onCleanup(() => {
    arrivals = transitionSteerArrival(arrivals, DISPOSED_STEER_ARRIVAL_EVENT)
  })

  // A row can render before the sync for the rows that hold it, so it syncs first.
  const arriving = (messageID: string) =>
    untrack(() => {
      syncArrivals()

      if (!shouldGrowUserMessage(arrivals, messageID)) return false
      arrivalRendered.messageID = messageID
      arrivals = transitionSteerArrival(arrivals, arrivalRendered)

      return true
    })

  const grown = (messageID: string) => {
    arrivalGrown.messageID = messageID
    arrivals = transitionSteerArrival(arrivals, arrivalGrown)
  }

  // A run's gaps and meta lines snap while a steer arrives, because the arriving row grows in. Any other change, such
  // as a steer delivered into the run above, springs every gap and meta line together, so the bubbles below hold still.
  // Springs read this on every frame, so it holds for exactly as long as the grow runs.
  const runSnaps = () =>
    untrack(() => {
      syncArrivals()

      return shouldSnapUserRun(arrivals)
    })

  // The newest delivered prompt; reverting it undoes the last turn, so its menu calls the action Undo.
  const latestSent = createMemo(
    () =>
      [...input.projection.messageByID().values()].findLast(
        (message) => message.type === "user" && input.actions?.pending?.status(message.id) === undefined,
      )?.id,
  )

  // Hovering a run's bubbles, or the gaps between them, shows the meta line its last bubble carries. Each bubble's
  // body bridges the gaps to its neighbors, so moving between bubbles never hides the line, and an open menu keeps it
  // while the pointer is on the menu.
  const [hoveredMessage, setHoveredMessage] = createSignal<string>()
  const [menuMessage, setMenuMessage] = createSignal<string>()

  const runEnds = createMemo(() => {
    const ends = new Map<string, string>()
    const group: string[] = []
    input.projection.rows().forEach((row) => {
      if (!Predicate.isTagged(row, "UserMessage")) return
      group.push(row.userMessageID)

      if (runs().get(row.userMessageID)?.below) return
      group.splice(0).forEach((id) => ends.set(id, row.userMessageID))
    })

    return ends
  })

  const runHovered = (messageID: string) => {
    const ends = runEnds()

    return [hoveredMessage(), menuMessage()].some((id) => !!id && ends.get(id) === messageID)
  }

  const bubble = (target: EventTarget | null) =>
    target instanceof Element ? target.closest('[data-slot="user-message-body"]') : null

  const hoverZone = (messageID: string) => ({
    onPointerOver: (event: PointerEvent) => {
      if (bubble(event.target)) setHoveredMessage(messageID)
    },
    onPointerOut: (event: PointerEvent) => {
      const next = bubble(event.relatedTarget)

      if (next && event.currentTarget instanceof Element && event.currentTarget.contains(next)) return
      setHoveredMessage((current) => (current === messageID ? undefined : current))
    },
  })

  const run = (messageID: string) =>
    createMemo(() => runs().get(messageID), undefined, {
      equals: (a, b) => a?.above === b?.above && a?.below === b?.below,
    })

  const phase = (messageID: string) => viewTurnPhase(input.projection.turnPhaseByID().get(messageID) ?? IDLE_TURN_PHASE)

  const duration = (messageID: string) => {
    const user = input.projection.messageByID().get(messageID)

    if (user?.type !== "user") return null

    const message = input.projection
      .assistantMessagesByParent()
      .get(messageID)
      ?.findLast((message) => message.time.completed !== undefined)

    if (message?.time.completed === undefined || message.time.completed < user.time.created) return undefined

    return SessionTurn.duration(turns().messages, message, {
      index: turns().indexes.get(message.id),
      legacy: turns().legacy,
    })
  }

  const copyContentID = (messageID: string) => {
    if (phase(messageID).hideCopy) return null

    const message = input.projection
      .assistantMessagesByParent()
      .get(messageID)
      ?.findLast((message) => message.content.some((content) => content.type === "text" && !!content.text.trim()))

    return message
      ? contentEntries(message).findLast((entry) => entry.content.type === "text" && !!entry.content.text.trim())?.id
      : undefined
  }

  const padding = () => input.padding?.() ?? "px-4 md:px-6"

  const indexGroupContents = (refs: PartRef[]) => {
    const result = new Map<string, Map<string, SessionMessageAssistant["content"][number]>>()
    refs.forEach((ref) => {
      if (result.has(ref.messageID)) return
      const contents = new Map<string, SessionMessageAssistant["content"][number]>()
      const message = input.projection.messageByID().get(ref.messageID)

      if (message?.type === "assistant") {
        contentEntries(message).forEach((entry) => {
          // Match resolveContent's first entry when content IDs repeat.
          if (!contents.has(entry.id)) contents.set(entry.id, entry.content)
        })
      }

      result.set(ref.messageID, contents)
    })

    return result
  }

  const renderAssistant = (row: Accessor<TimelineRow.AssistantPart>, onSizeChange?: () => void) => {
    if (row().group.type === "context") {
      const parts = createMemo(() => {
        const group = row().group

        if (group.type !== "context") return []
        const contents = indexGroupContents(group.refs)
        const streaming = phase(row().userMessageID).streamingReasoningRef

        return group.refs.flatMap<ContextGroupPart>((ref) => {
          const content = contents.get(ref.messageID)?.get(ref.partID)

          if (content?.type === "tool") {
            patchPartKeys.set(content, `${ref.messageID}:${ref.partID}`)

            return [content]
          }

          if (content?.type === "reasoning")
            return [
              {
                ...content,
                id: ref.partID,
                streaming: sameRef(streaming, ref),
              },
            ]
          const message = input.projection.messageByID().get(ref.messageID)

          if (content?.type === "text" && message?.type === "assistant")
            return [
              {
                type: "text",
                id: ref.partID,
                render: () => <AssistantContent message={message} content={content} contentID={ref.partID} />,
              },
            ]

          if (ref.messageID !== ref.partID || !message) return []

          if (message.type !== "assistant" && message.type !== "user")
            return [{ type: "notice", id: ref.partID, render: () => <Notice messageID={ref.messageID} grouped /> }]

          return []
        })
      })

      const key = () => `context:${row().group.key}`

      return (
        <div class="contents" data-notices-only={parts().every((part) => part.type === "notice") ? "" : undefined}>
          <ContextGroup
            parts={parts()}
            patchGroupKey={(tools) => {
              const parts = tools.map((tool) => patchPartKeys.get(tool)!)

              // After a split, only the subgroup with the earliest surviving member keeps the old anchor.
              const key =
                parts
                  .map((part) => patchGroupKeys.get(part))
                  .find((key) => key !== undefined && parts.includes(patchOwners().get(key)!)) ?? parts[0]!

              parts.forEach((part) => patchGroupKeys.set(part, key))

              return key
            }}
            reasoningDefaultOpen={thoughtOpens(input.timelineDetail(), false)}
            reasoningOpen={(id) => input.disclosure.value(id)}
            onReasoningOpenChange={(id, open) => input.disclosure.set(id, open)}
            toolDefaultOpen={(tool) => contentOpens(input.timelineDetail(), tool)}
            toolOpen={(id) => input.disclosure.value(`${row().group.key}:tool:${id}`)}
            onToolOpenChange={(id, open) => input.disclosure.set(`${row().group.key}:tool:${id}`, open)}
            fileOpen={(path) => input.disclosure.value(`patch:${path}`) ?? diffOpens(input.timelineDetail())}
            onFileOpenChange={(path, open) => input.disclosure.set(`patch:${path}`, open)}
            open={input.disclosure.value(key()) === true}
            onOpenChange={(open) => input.disclosure.set(key(), open)}
            onSizeChange={onSizeChange}
          />
        </div>
      )
    }

    if (row().group.type === "events") {
      const events = createMemo(() => {
        const group = row().group

        if (group.type !== "events") return []
        const contents = indexGroupContents(group.refs)

        // A call starts the work; a notice under its message's own ID reports it back.
        return group.refs.flatMap((ref) => {
          const message = input.projection.messageByID().get(ref.messageID)
          const content = contents.get(ref.messageID)?.get(ref.partID)

          const event =
            ref.messageID === ref.partID
              ? message && noticeEvent(message)
              : content?.type === "tool"
                ? toolEvent(content)
                : undefined

          return event ? [event] : []
        })
      })

      return (
        <TimelineEventRow
          events={events()}
          open={input.disclosure.value(`events:${row().group.key}`) === true}
          onOpenChange={(open) => {
            input.disclosure.set(`events:${row().group.key}`, open)
            onSizeChange?.()
          }}
          onRevealShell={input.revealPart}
        />
      )
    }

    if (row().group.type === "read") {
      const tools = createMemo(() => {
        const group = row().group

        if (group.type !== "read") return []
        const contents = indexGroupContents(group.refs)

        return group.refs.flatMap((ref) => {
          const content = contents.get(ref.messageID)?.get(ref.partID)

          return content?.type === "tool" ? [content] : []
        })
      })

      return (
        <SessionReadToolGroup
          tools={tools()}
          open={input.disclosure.value(row().group.key)}
          onOpenChange={(open) => input.disclosure.set(row().group.key, open)}
          onSizeChange={onSizeChange}
        />
      )
    }

    if (row().group.type === "file") {
      const tools = createMemo(() => {
        const group = row().group

        if (group.type !== "file") return []
        const contents = indexGroupContents(group.refs)

        return group.refs.flatMap((ref) => {
          const content = contents.get(ref.messageID)?.get(ref.partID)

          return content?.type === "tool" ? [content] : []
        })
      })

      return (
        <FileGroup
          tools={tools()}
          fileOpen={(path) =>
            input.disclosure.value(`${row().group.key}:file:${path}`) ?? diffOpens(input.timelineDetail())
          }
          onFileOpenChange={(path, open) => input.disclosure.set(`${row().group.key}:file:${path}`, open)}
          onSizeChange={onSizeChange}
        />
      )
    }

    const ref = createMemo(() => {
      const group = row().group

      return group.type === "part" ? group.ref : undefined
    })

    const message = createMemo(() => {
      const current = ref()
      const message = current ? input.projection.messageByID().get(current.messageID) : undefined

      return message?.type === "assistant" ? message : undefined
    })

    const content = createMemo(() => {
      const current = ref()

      return current ? resolveContent(message(), current.partID) : undefined
    })

    const defaultOpen = createMemo(() => {
      const item = content()

      return item ? contentOpens(input.timelineDetail(), item) : undefined
    })

    // Only the finished turn's footer part derives them, and only while the host shows sources.
    const turnSourcesValue = createMemo(() => {
      const current = ref()

      if (!sourcesHost?.enabled || !current || copyContentID(row().userMessageID) !== current.partID) return undefined

      const value = turnSources(
        input.projection.assistantMessagesByParent().get(row().userMessageID) ?? emptyAssistantMessages,
      )

      return value.steps.length > 0 ? value : undefined
    })

    const turnTokensPerSecond = createMemo(() => {
      const current = ref()

      if (!current || copyContentID(row().userMessageID) !== current.partID) return undefined

      const messages = input.projection.assistantMessagesByParent().get(row().userMessageID) ?? emptyAssistantMessages

      const last = messages.at(-1)

      if (!last) return undefined

      return SessionTurn.tokensPerSecond(turns().messages, last, {
        index: turns().indexes.get(last.id),
        legacy: turns().legacy,
      })
    })

    const disclosureKey = () => (content()?.type === "reasoning" ? ref()!.partID : row().group.key)

    return (
      <Show when={message()}>
        {(message) => (
          <Show when={content()}>
            {(content) => (
              <AssistantContent
                message={message()}
                content={content()}
                contentID={ref()!.partID}
                showAssistantCopyPartID={copyContentID(row().userMessageID)}
                turnDurationMs={duration(row().userMessageID)}
                turnTokensPerSecond={turnTokensPerSecond()}
                sources={turnSourcesValue()}
                onOpenSources={() => sourcesHost?.open(row().userMessageID)}
                defaultOpen={defaultOpen()}
                toolOpen={input.disclosure.value(disclosureKey()) ?? defaultOpen()}
                onToolOpenChange={(open) => input.disclosure.set(disclosureKey(), open)}
                onContentRendered={onSizeChange}
              />
            )}
          </Show>
        )}
      </Show>
    )
  }

  const notice = (message: SessionMessageInfo) => {
    if (message.type === "agent-switched" || message.type === "model-switched") return undefined

    if (message.type === "skill") return { label: i18n.t("ui.tool.skill"), data: message.name }

    if (message.type === "system") {
      const sources = Array.isArray(message.metadata?.instructionSources)
        ? message.metadata.instructionSources.filter(Predicate.isString)
        : undefined

      if (message.metadata?.notice === "instructions" && sources?.length)
        return { label: i18n.t("ui.sessionTimeline.notice.instructionsUpdated"), items: sources }
      const prefix = "Instructions updated: "

      if (message.description?.startsWith(prefix)) {
        const keys = message.description
          .slice(prefix.length)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)

        return {
          label: i18n.t("ui.sessionTimeline.notice.instructionsUpdated"),
          items: keys,
        }
      }

      return { label: message.description ?? message.text }
    }

    if (message.type !== "synthetic") return undefined

    if (message.metadata?.notice === "restart") return { label: i18n.t("ui.sessionTimeline.notice.restart") }

    if (message.description === "Continuing after restart")
      return { label: i18n.t("ui.sessionTimeline.notice.restart") }
    const source = message.metadata?.source

    if (source === "subagent" || source === "shell") {
      const agent = message.metadata?.agent

      const actor =
        source === "shell"
          ? i18n.t("ui.tool.shell")
          : ((Predicate.isString(agent) ? taskAgentName(agent, data.store.agent) : undefined) ??
            i18n.t("ui.tool.agent.default"))

      const state = message.metadata?.state
      const outcome: Outcome = state === "error" || state === "cancelled" ? state : "completed"

      return {
        label: i18n.t(outcomeNoticeKey(outcome), { actor }),
        data: message.description,
        outcome,
        icon: outcomeNoticeIcon(outcome),
      }
    }

    return { label: message.description ?? message.text }
  }

  const gaps = createMemo(() => timelineGaps(input.projection.rows(), input.projection.messageByID()))

  // Each row's space above comes from its block, and none of its own. A message joining the user's message above
  // already sits its run's 4 px below it.
  const gap = (row: FramedTimelineRow) => {
    if (Predicate.isTagged(row, "UserMessage") && runs().get(row.userMessageID)?.above) return undefined

    return gaps().get(TimelineRow.key(row))
  }

  const Frame = (props: { row: FramedTimelineRow; grow?: boolean; children: JSX.Element }) => (
    <div
      ref={(el) => {
        if (props.grow) growIn(el, () => grown(props.row.userMessageID))
        onCleanup(trackNestedRails(el))
      }}
      id={Predicate.isTagged(props.row, "UserMessage") ? input.anchor?.(props.row.userMessageID) : undefined}
      data-message-id={props.row.userMessageID}
      data-timeline="next"
      data-timeline-row={props.row._tag}
      data-timeline-gap={gap(props.row)}
      classList={{
        "min-w-0 w-full max-w-full": true,
        "md:max-w-session md:mx-auto": input.centered?.(),
      }}
    >
      <div data-component="session-turn" class="min-w-0 w-full relative" style={{ height: "auto" }}>
        {props.children}
      </div>
    </div>
  )

  function Notice(props: { messageID: string; grouped?: boolean }) {
    const inset = () => (props.grouped ? "" : padding())
    const message = createMemo(() => input.projection.messageByID().get(props.messageID))

    const compaction = createMemo(() => {
      const value = message()

      return value?.type === "compaction" ? value : undefined
    })

    const compactionError = createMemo(() => {
      const value = compaction()

      if (value?.status !== "failed") return ""

      return unwrapErrorMessage(value.error.message)
    })

    const moved = createMemo(() => {
      const value = message()

      return value?.type === "location-switched" ? value : undefined
    })

    // Switching the agent or the model changes who answers next, so both draw as the same separator.
    const switched = createMemo(() => {
      const value = message()

      if (value?.type === "agent-switched")
        return {
          label: i18n.t("ui.timeline.notice.agentSwitched", { agent: capitalizeAgent(value.agent) }),
          providerID: undefined,
          variant: undefined,
        }

      if (value?.type !== "model-switched") return undefined
      const match = data.store.provider?.all?.get(value.model.providerID)
      const variantOnly = value.previous?.providerID === value.model.providerID && value.previous.id === value.model.id
      const variant = value.model.variant ?? "default"

      return {
        providerID: value.model.providerID,
        variant: variantOnly ? undefined : value.model.variant,
        label: variantOnly
          ? variant === "default"
            ? i18n.t("ui.sessionTimeline.notice.variantDefault")
            : i18n.t("ui.sessionTimeline.notice.variantSwitched", { variant })
          : i18n.t("ui.sessionTimeline.notice.modelSwitched", {
              model: match?.models?.[value.model.id]?.name ?? value.model.id,
            }),
      }
    })

    // The goal the user set shows as their own message. Core describes it as "Goal: <objective>".
    const goal = createMemo(() => {
      const value = message()

      if (!goalMessage(value)) return

      return value.description?.replace(/^Goal: /, "") || undefined
    })

    const content = createMemo(() => {
      const value = message()

      return value && !goal() ? notice(value) : undefined
    })

    const childID = createMemo(() => {
      const value = message()

      if (value?.type !== "synthetic" || value.metadata?.source !== "subagent") return
      const id = value.metadata.childID

      if (Predicate.isString(id) && id) return id
    })

    const href = createMemo(() => {
      const id = childID()

      if (id) return data.sessionHref?.(id)
    })

    // A finished background shell jumps to its call, as its activity pill does.
    const shellID = createMemo(() => {
      const value = message()

      if (!input.revealPart || value?.type !== "synthetic" || value.metadata?.source !== "shell") return
      const id = value.metadata.shellID

      if (Predicate.isString(id) && id) return id
    })

    const clickable = createMemo(() => !!shellID() || !!(childID() && (data.navigateToSession || href())))

    const open = () => {
      const shell = shellID()

      if (shell) return void input.revealPart?.(shell)
      const id = childID()

      if (id) data.navigateToSession?.(id)
    }

    const navigate = (event: MouseEvent) => {
      if (!shellID() && (!childID() || !data.navigateToSession)) return

      if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      event.preventDefault()
      open()
    }

    const navigateKey = (event: KeyboardEvent) => {
      if (!clickable() || href()) return

      if (event.key !== "Enter" && event.key !== " ") return
      event.preventDefault()
      open()
    }

    return (
      <>
        <Show when={goal()}>
          {(objective) => (
            <div data-slot="session-turn-message-container" class={`w-full ${inset()}`}>
              <div data-component="user-message" data-goal="">
                <div data-slot="user-message-body">
                  <div data-slot="user-message-text" dir="auto">
                    <Badge data-slot="user-message-goal-badge" dir="ltr">
                      /goal
                    </Badge>
                    <bdi>{objective()}</bdi>
                  </div>
                </div>
              </div>
            </div>
          )}
        </Show>
        <Show when={!goal() && compaction()}>
          {(message) => (
            <div data-slot="session-turn-message-container" class={`w-full ${inset()}`}>
              <div data-slot="session-turn-compaction">
                <SessionCompactionMessage message={message()} error={compactionError()} />
              </div>
            </div>
          )}
        </Show>
        <Show
          when={moved()}
          fallback={
            <Show
              when={switched()}
              fallback={
                <Show when={content()}>
                  {(content) => (
                    <Show
                      when={content().items?.length}
                      fallback={
                        <Dynamic
                          component={href() ? "a" : "div"}
                          data-slot="session-timeline-notice"
                          data-outcome={content().outcome}
                          class={`block w-full truncate ${props.grouped ? "py-1" : ""} text-13-regular leading-text-compact text-v2-text-text-faint ${inset()}`}
                          classList={{ "cursor-pointer hover:text-v2-text-text-base": clickable() }}
                          href={href()}
                          role={clickable() && !href() ? (shellID() ? "button" : "link") : undefined}
                          tabIndex={clickable() && !href() ? 0 : undefined}
                          onClick={navigate}
                          onKeyDown={navigateKey}
                        >
                          <Show when={content().icon}>
                            {(icon) => (
                              <Icon
                                name={icon()}
                                size="normal"
                                class={`inline-block align-top me-1.5 ${outcomeNoticeColor(content().outcome)}`}
                              />
                            )}
                          </Show>
                          <bdi dir="auto" class={`font-[530] ${outcomeNoticeColor(content().outcome)}`}>
                            {content().label}
                          </bdi>
                          <Show when={content().data}>
                            {(data) => (
                              <span>
                                {" · "}
                                <bdi dir="auto">{data()}</bdi>
                              </span>
                            )}
                          </Show>
                        </Dynamic>
                      }
                    >
                      <div data-slot="session-timeline-notice" class={`w-full ${inset()}`}>
                        <div class="flex min-h-5 min-w-0 items-center gap-2 overflow-hidden">
                          <bdi
                            dir="auto"
                            class="shrink-0 text-[13px] font-[530] leading-text-compact tracking-[-0.04px] text-v2-text-text-faint"
                          >
                            {content().label}
                          </bdi>
                          <For each={content().items}>
                            {(item) => (
                              <bdi
                                dir="auto"
                                class="min-w-0 truncate text-[13px] font-[440] leading-text-compact tracking-[-0.04px] text-v2-text-text-faint"
                              >
                                {item}
                              </bdi>
                            )}
                          </For>
                        </div>
                      </div>
                    </Show>
                  )}
                </Show>
              }
            >
              {(switched) => (
                <div data-slot="session-timeline-notice" data-type={message()?.type} class={`w-full ${inset()}`}>
                  <Separator label={switched().label} providerID={switched().providerID} variant={switched().variant} />
                </div>
              )}
            </Show>
          }
        >
          {(message) => (
            <div data-slot="session-timeline-notice" data-type="location-switched" class={`w-full ${inset()}`}>
              <Separator
                label={i18n.t("ui.sessionTimeline.notice.movedTo")}
                value={message().location.directory}
                tooltip={i18n.t("ui.sessionTimeline.notice.movedTooltip")}
              />
            </div>
          )}
        </Show>
      </>
    )
  }

  function Shell(props: { messageID: string }) {
    const message = createMemo(() => {
      const value = input.projection.messageByID().get(props.messageID)

      return value?.type === "shell" ? value : undefined
    })

    return (
      <Show when={message()}>
        {(message) => (
          <div data-slot="session-turn-message-container" class={`w-full ${padding()}`}>
            <ShellMessage
              message={message()}
              open={input.disclosure.value(message().id) ?? userShellOpens(input.timelineDetail())}
              onOpenChange={(open) => input.disclosure.set(message().id, open)}
            />
          </div>
        )}
      </Show>
    )
  }

  function TurnDiff(props: { row: TimelineRow.TurnDiff; onSizeChange?: () => void }) {
    // Until the diff loads, and if it fails, list the paths the turn's steps recorded, without change counts.
    const turn = () => ({ sessionID: input.sessionID(), from: props.row.from })
    const state = createMemo(() => data.turnDiff?.state(turn()))

    const diffs = () => {
      const current = state()

      return current?.status === "ready" ? current.diffs : undefined
    }

    const failed = () => state()?.status === "failed"
    const paths = () => diffs()?.map((diff) => diff.file) ?? props.row.files
    const showAllKey = () => `turn-diff:${props.row.messageID}`
    const showAll = () => input.disclosure.value(showAllKey()) === true
    const limit = <T,>(items: readonly T[]) => (showAll() ? items : items.slice(0, turnDiffFileLimit))
    const overflow = () => paths().length > turnDiffFileLimit
    const fileKey = (path: string) => `turn-diff:${props.row.messageID}:file:${path}`

    // Loads once per turn. A failure settles until the row remounts or the reader retries.
    createEffect(() => data.turnDiff?.load(turn()))

    return (
      <Show when={data.turnDiff && paths().length > 0}>
        <div data-slot="session-turn-diffs" class="flex flex-col gap-2">
          <div class="flex h-6 min-w-0 items-center gap-2">
            <span class="shrink-0 text-14-medium text-v2-text-text-base tabular-nums">
              {i18n.plural("ui.sessionTurn.diffs.changed", paths().length)}
            </span>
            <DiffChanges changes={[...(diffs() ?? [])]} />
            <Show when={failed()}>
              <span
                data-slot="session-turn-diffs-error"
                class="min-w-0 truncate text-13-regular leading-text-compact text-v2-text-text-faint"
              >
                {i18n.t("ui.sessionTurn.diffs.failed")}
              </span>
            </Show>
            <Show when={failed() || overflow()}>
              <div class="ms-auto flex shrink-0 items-center gap-3">
                <Show when={failed()}>
                  <button
                    type="button"
                    data-slot="session-turn-diffs-retry"
                    class="text-14-regular text-v2-text-text-accent"
                    onClick={() => data.turnDiff?.load(turn())}
                  >
                    {i18n.t("ui.sessionTurn.diffs.retry")}
                  </button>
                </Show>
                <Show when={overflow()}>
                  <button
                    type="button"
                    class="text-14-regular text-v2-text-text-accent"
                    onClick={() => input.disclosure.set(showAllKey(), !showAll())}
                  >
                    {showAll() ? i18n.t("ui.sessionTurn.diffs.showLess") : i18n.t("ui.sessionTurn.diffs.showAll")}
                  </button>
                </Show>
              </div>
            </Show>
          </div>
          <PatchTool
            tool="patch"
            input={{}}
            metadata={{ files: limit(diffs() ?? []) }}
            pendingFiles={diffs() ? undefined : limit(props.row.files)}
            status="completed"
            fileOpen={(path: string) => input.disclosure.value(fileKey(path))}
            onFileOpenChange={(path: string, open: boolean) => input.disclosure.set(fileKey(path), open)}
            deferContent
            virtualizeDiff={false}
            onContentRendered={props.onSizeChange}
          />
        </div>
      </Show>
    )
  }

  // A run's messages sit as close as the iOS app's (4 px); the gap springs as a message joins or leaves.
  function TurnGap(props: { messageID: string }) {
    let element: HTMLDivElement | undefined
    const joined = run(props.messageID)
    springStyle(
      () => element,
      () => ({ height: joined()?.above ? 4 : 0 }),
      (el, value) => {
        el.style.height = `${value.height}px`
      },
      // Closing up as a message joins is instant; the joining message grows in instead.
      { ...userRunSpring, snap: () => !!joined()?.above && runSnaps() },
    )

    return (
      <div
        ref={element}
        data-timeline-row="TurnGap"
        aria-hidden="true"
        style={{ height: untrack(joined)?.above ? "4px" : "0px" }}
      />
    )
  }

  const render = (row: Accessor<TimelineRow.TimelineRow>, onSizeChange?: () => void) => {
    if (Predicate.isTagged(row(), "TurnGap")) return <TurnGap messageID={row().userMessageID} />

    // The host owns live status and renders this slot itself.
    if (Predicate.isTagged(row(), "Activity")) return null

    if (Predicate.isTagged(row(), "UserMessage")) {
      const current = () => {
        const value = row()

        if (!Predicate.isTagged(value, "UserMessage")) throw new Error("Expected a user-message timeline row")

        return value
      }

      const message = createMemo(() => {
        const value = input.projection.messageByID().get(current().userMessageID)

        return value?.type === "user" ? value : undefined
      })

      const context = createMemo(() => input.projection.userContextByID().get(current().userMessageID))
      const joined = run(current().userMessageID)
      const grow = arriving(current().userMessageID)

      return (
        <Frame row={current()} grow={grow}>
          <Show when={message()}>
            {(message) => {
              const presentation = () => input.presentation(message())

              return (
                <div
                  data-slot="session-turn-message-container"
                  class={`w-full ${padding()}`}
                  {...hoverZone(message().id)}
                >
                  <div data-slot="session-turn-message-content" aria-live="off">
                    <SessionUserMessage
                      sessionID={input.sessionID()}
                      message={message()}
                      displayText={presentation()?.displayText}
                      comments={presentation()?.comments}
                      references={presentation()?.references}
                      voice={presentation()?.voice}
                      historicalAgent={context()?.agent ?? ""}
                      historicalModel={context()?.model ?? { id: "", providerID: "" }}
                      actions={input.actions}
                      run={joined()}
                      latest={latestSent() === message().id}
                      runSnaps={runSnaps}
                      runHovered={runHovered(message().id)}
                      onMenuOpenChange={(open) =>
                        setMenuMessage((current) =>
                          open ? message().id : current === message().id ? undefined : current,
                        )
                      }
                      fold={input.foldUserMessages?.()}
                      expanded={input.disclosure.value(`user-expanded:${message().id}`)}
                      onExpandedChange={(open) => input.disclosure.set(`user-expanded:${message().id}`, open)}
                    />
                  </div>
                </div>
              )
            }}
          </Show>
        </Frame>
      )
    }

    if (Predicate.isTagged(row(), "Shell")) {
      const current = () => {
        const value = row()

        if (!Predicate.isTagged(value, "Shell")) throw new Error("Expected a shell timeline row")

        return value
      }

      return (
        <Frame row={current()}>
          <Shell messageID={current().messageID} />
        </Frame>
      )
    }

    if (Predicate.isTagged(row(), "Notice")) {
      const current = () => {
        const value = row()

        if (!Predicate.isTagged(value, "Notice")) throw new Error("Expected a notice timeline row")

        return value
      }

      return (
        <Frame row={current()}>
          <Notice messageID={current().messageID} />
        </Frame>
      )
    }

    if (Predicate.isTagged(row(), "TurnDivider")) {
      const current = () => {
        const value = row()

        if (!Predicate.isTagged(value, "TurnDivider")) throw new Error("Expected a turn-divider timeline row")

        return value
      }

      return (
        <Frame row={current()}>
          <div data-slot="session-turn-message-container" class={`w-full ${padding()}`}>
            <div data-slot="session-turn-compaction">
              <Separator label={i18n.t("ui.message.interrupted")} />
            </div>
          </div>
        </Frame>
      )
    }

    if (Predicate.isTagged(row(), "CompactionQueued")) {
      const current = () => {
        const value = row()

        if (!Predicate.isTagged(value, "CompactionQueued")) throw new Error("Expected a queued-compaction timeline row")

        return value
      }

      return (
        <Frame row={current()}>
          <div data-slot="session-turn-message-container" class={`w-full ${padding()}`}>
            <div data-slot="session-turn-compaction">
              <SessionCompactionQueued />
            </div>
          </div>
        </Frame>
      )
    }

    if (Predicate.isTagged(row(), "AssistantPart")) {
      const current = () => {
        const value = row()

        if (!Predicate.isTagged(value, "AssistantPart")) throw new Error("Expected an assistant-part timeline row")

        return value
      }

      // Construct once per row key, not inside JSX that reruns when group refs change.
      const content = renderAssistant(current, onSizeChange)

      return (
        <Frame row={current()}>
          <div data-slot="session-turn-message-container" class={`w-full ${padding()}`}>
            <div data-slot="session-turn-assistant-content" aria-hidden={phase(current().userMessageID).live}>
              {content}
            </div>
          </div>
        </Frame>
      )
    }

    if (Predicate.isTagged(row(), "Thinking")) {
      const current = () => {
        const value = row()

        if (!Predicate.isTagged(value, "Thinking")) throw new Error("Expected a thinking timeline row")

        return value
      }

      const content = createMemo(() => {
        const ref = current().ref
        const content = resolveContent(input.projection.messageByID().get(ref.messageID), ref.partID)

        return content?.type === "reasoning" ? content : undefined
      })

      // The live thought stands in for the status line. It streams in view, and the row it settles into starts closed.

      return (
        <Frame row={current()}>
          <div data-slot="session-turn-message-container" class={`w-full ${padding()}`}>
            <div data-slot="session-turn-thinking-row" data-live-slot="">
              <Show when={content()}>
                {(content) => (
                  <ThoughtRow
                    id={current().ref.partID}
                    content={content()}
                    streaming
                    defaultOpen={thoughtOpens(input.timelineDetail(), true)}
                    open={input.disclosure.value(current().ref.partID) ?? thoughtOpens(input.timelineDetail(), true)}
                    onOpenChange={(open) => input.disclosure.set(current().ref.partID, open)}
                    onContentRendered={onSizeChange}
                  />
                )}
              </Show>
            </div>
          </div>
        </Frame>
      )
    }

    if (Predicate.isTagged(row(), "Worked")) {
      const current = () => {
        const value = row()

        if (!Predicate.isTagged(value, "Worked")) throw new Error("Expected a worked timeline row")

        return value
      }

      const label = createMemo(() => {
        const id = current().userMessageID
        const user = input.projection.messageByID().get(id)

        const ms = workedDuration(
          user?.type === "user" ? user : undefined,
          input.projection.assistantMessagesByParent().get(id) ?? emptyAssistantMessages,
        )

        if (ms === undefined) return i18n.t("ui.timeline.activity.workedUnknown")
        const total = Math.round(ms / 1000)
        const numfmt = new Intl.NumberFormat(i18n.locale())

        return i18n.t("ui.timeline.activity.worked", {
          duration:
            total < 60
              ? i18n.t("ui.message.duration.seconds", { count: numfmt.format(total) })
              : i18n.t("ui.message.duration.minutesSeconds", {
                  minutes: numfmt.format(Math.floor(total / 60)),
                  seconds: numfmt.format(total % 60),
                }),
        })
      })

      return (
        <Frame row={current()}>
          <div data-slot="session-turn-message-container" class={`w-full ${padding()}`}>
            <div class="text-13-regular leading-text-compact text-v2-text-text-muted">{label()}</div>
          </div>
        </Frame>
      )
    }

    if (Predicate.isTagged(row(), "TurnDiff")) {
      const current = () => {
        const value = row()

        if (!Predicate.isTagged(value, "TurnDiff")) throw new Error("Expected a turn-diff timeline row")

        return value
      }

      return (
        <Frame row={current()}>
          <div data-slot="session-turn-message-container" class={`w-full ${padding()}`}>
            <TurnDiff row={current()} onSizeChange={onSizeChange} />
          </div>
        </Frame>
      )
    }

    if (Predicate.isTagged(row(), "Retry")) {
      const current = () => {
        const value = row()

        if (!Predicate.isTagged(value, "Retry")) throw new Error("Expected a retry timeline row")

        return value
      }

      return (
        <Frame row={current()}>
          <div data-slot="session-turn-message-container" class={`w-full ${padding()}`}>
            <SessionRetry
              status={{ type: "retry", attempt: current().attempt, message: current().message, next: current().next }}
              show={input.projection.activeMessageID() === current().userMessageID}
            />
          </div>
        </Frame>
      )
    }

    const current = () => {
      const value = row()

      if (!Predicate.isTagged(value, "Error")) throw new Error("Expected an error timeline row")

      return value
    }

    const usageLimit = createMemo(() => {
      const kind = current().kind

      if (kind !== "free-limit" && kind !== "go-limit") return

      const keys =
        kind === "go-limit"
          ? ({ title: "ui.sessionTurn.goLimit.title", lineReset: "ui.sessionTurn.goLimit.lineReset" } as const)
          : ({ title: "ui.sessionTurn.freeLimit.title", lineReset: "ui.sessionTurn.freeLimit.lineReset" } as const)

      const at = current().resetAt

      if (at === undefined || !Number.isFinite(at) || Number.isNaN(new Date(at).getTime())) return i18n.t(keys.title)

      const now = Date.now()
      const sameDay = new Date(at).toDateString() === new Date(now).toDateString() && at - now < 86_400_000

      const time = new Intl.DateTimeFormat(
        i18n.locale(),
        sameDay ? { timeStyle: "short" } : { dateStyle: "medium", timeStyle: "short" },
      ).format(at)

      return i18n.t(keys.lineReset, { time })
    })

    // A budget pauses paid models, or only the ones it covers, until it resets at the start of a month.
    const budgetLimit = createMemo(() => {
      const kind = current().kind

      if (kind !== "budget-limit" && kind !== "model-budget-limit") return
      const at = current().resetAt

      const time =
        at === undefined
          ? undefined
          : new Intl.DateTimeFormat(i18n.locale(), {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
              timeZoneName: "shortOffset",
            }).format(at)

      if (kind === "budget-limit")
        return {
          text: time
            ? i18n.t("ui.sessionTurn.budgetLimit.all", { time })
            : i18n.t("ui.sessionTurn.budgetLimit.allUntilReset"),
          action: i18n.t("ui.sessionTurn.budgetLimit.useFreeModel"),
        }

      return {
        text: time
          ? i18n.t("ui.sessionTurn.budgetLimit.models", { time })
          : i18n.t("ui.sessionTurn.budgetLimit.modelsUntilReset"),
        action: i18n.t("ui.sessionTurn.budgetLimit.switchModel"),
      }
    })

    return (
      <Frame row={current()}>
        <div data-slot="session-turn-message-container" class={`w-full ${padding()}`}>
          <Switch fallback={<SessionError message={current().text} />}>
            <Match when={budgetLimit()}>
              {(notice) => (
                <div
                  role="status"
                  class="text-[13px] font-[440] leading-text-compact tracking-[-0.04px] text-v2-text-text-muted"
                >
                  {notice().text}
                  <Show when={input.actions?.chooseModel}>
                    {(choose) => (
                      <>
                        <span aria-hidden="true">{" · "}</span>
                        <button
                          type="button"
                          class="font-[530] text-v2-text-text-base hover:underline focus-visible:underline focus-visible:outline-none"
                          onClick={() => choose()()}
                        >
                          {notice().action}
                        </button>
                      </>
                    )}
                  </Show>
                </div>
              )}
            </Match>
            <Match when={usageLimit()}>
              {(text) => (
                <div
                  role="status"
                  class="text-[13px] font-[440] leading-text-compact tracking-[-0.04px] text-v2-text-text-muted"
                >
                  {text()}
                </div>
              )}
            </Match>
          </Switch>
        </div>
      </Frame>
    )
  }

  function Row(props: { row: Accessor<TimelineRow.TimelineRow>; onSizeChange?: () => void }) {
    return (
      <Show when={TimelineRow.key(props.row())} keyed>
        {(_key) => render(props.row, props.onSizeChange)}
      </Show>
    )
  }

  return { Row }
}

function capitalizeAgent(agent: string) {
  return agent.slice(0, 1).toUpperCase() + agent.slice(1)
}

function outcomeNoticeIcon(outcome: Outcome) {
  if (outcome === "error") return "warning"

  if (outcome === "cancelled") return "circle-ban-sign"
}

function outcomeNoticeColor(outcome: Outcome | undefined) {
  if (!outcome) return ""

  if (outcome === "error") return "text-v2-state-fg-danger"

  if (outcome === "cancelled")
    return "text-[var(--v2-yellow-900)] [[data-color-scheme=dark]_&]:text-v2-state-fg-warning"

  return "text-v2-text-text-code-accent"
}

function outcomeNoticeKey(state: string | undefined) {
  if (state === "error") return "ui.sessionTimeline.notice.failed"

  if (state === "cancelled") return "ui.sessionTimeline.notice.cancelled"

  return "ui.sessionTimeline.notice.finished"
}

/**
 * Grows a row from nothing to its natural height while its bubble fades in; rows below follow its edge. A pending
 * steer's meta line stays in view: a steer that starts a pending run shows its line once the row has settled, and one
 * that joins a pending run carries the run's line down along the growing edge while the bubble fades into the space.
 */
function growIn(el: HTMLElement, onDone: () => void) {
  if (prefersReducedMotion()) return onDone()
  const height = Spring.fromDuration(0, { duration: 0.2, bounce: 0 })
  const opacity = Spring.fromDuration(0, { duration: 0.3, bounce: 0 }).set(1)
  const content = el.firstElementChild instanceof HTMLElement ? el.firstElementChild : undefined
  // The row's children mount after its ref runs, so the whole row starts hidden and hands its fade to the bubble on the
  // first frame.
  let faded = content ? [content] : []
  let meta: HTMLElement | undefined
  let carried = false
  let natural = 0
  let line = 0
  el.style.height = "0px"
  el.toggleAttribute("data-timeline-grow", true)
  faded.forEach((element) => (element.style.opacity = "0"))

  const remove = frameLoop.addMeasured(
    () => {
      if (content && !meta) {
        meta = content.querySelector<HTMLElement>('[data-slot="user-message-copy-wrapper"]') ?? undefined

        const bubbles = [
          ...content.querySelectorAll<HTMLElement>(
            '[data-slot="user-message-attachments"], [data-slot="user-message-body"]',
          ),
        ]

        if (meta && bubbles.length > 0) {
          carried = !!content.querySelector('[data-component="user-message"][data-pending][data-run-above]')

          if (!carried) meta.style.visibility = "hidden"
          content.style.opacity = ""
          faded = bubbles
        }
      }

      natural = content ? content.offsetHeight : 0
      line = meta ? meta.offsetHeight + parseFloat(getComputedStyle(meta).marginTop) : 0
    },
    (dt) => {
      if (!el.isConnected) return true

      height.set(natural)
      const value = height.step(dt)
      const progress = natural > 0 ? value / natural : 1
      const shown = Math.min(1, Math.max(0, opacity.step(dt)))

      // A carried line passes over the bubble's place, so the bubble shows only as the line clears it.
      faded.forEach((element) => (element.style.opacity = `${carried ? shown * progress : shown}`))

      // The line starts exactly where the run's line just was, just above this row, and settles below the bubble.
      if (meta && carried) meta.style.transform = `translateY(${-(natural - line + 8) * (1 - progress)}px)`

      if (!height.resting || !opacity.resting) {
        el.style.height = height.resting ? "" : `${value}px`

        return true
      }

      el.style.height = ""
      faded.forEach((element) => (element.style.opacity = ""))

      if (meta) {
        meta.style.visibility = ""
        meta.style.transform = ""
      }

      el.toggleAttribute("data-timeline-grow", false)
      onDone()

      return false
    },
  )

  // A row that unmounts mid-grow, as the virtualizer recycles it, ends its grow too; a second report is a no-op.
  onCleanup(() => {
    remove()
    onDone()
  })
}
