import { createEffect, createMemo, createSignal, onCleanup, Show, type Accessor, type JSX } from "solid-js"
import { Predicate } from "effect"
import { abort } from "@opencode/util/abort"
import { createAnimatedPresence } from "@/runtime/animated-presence"
import type { SessionMessageUser } from "@opencode/client/promise"
import type { SessionUserActions } from "@opencode/session-ui/actions"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import { InlineInput } from "@opencode/ui/inline-input"
import { Keybind } from "@opencode/ui/keybind"
import { TextShimmer } from "@opencode/ui/text-shimmer"
import type { BackgroundTask, MountedSession, SessionScreen } from "@opencode/plugin/gui"
import { PluginSlot } from "@/runtime/plugin/render"
import { useLanguage } from "@/runtime/i18n/language"
import { useSettings } from "@/settings/model"
import { useServer } from "@/runtime/server/current"
import { useWorkspaceLocation } from "@/workspaces/location"
import { Timeline } from "@opencode/session-ui/timeline/projection"
import { createSessionTimelineRowRenderer } from "@opencode/session-ui/timeline/row"
import { createNextTimelineRowRenderer, laneGap, StatusLane, timelineStatus } from "@opencode/session-ui/timeline-next"
import { getReadyMarkdown, preloadMarkdown } from "@opencode/session-ui/markdown-cache"
import { createTimelineController, type TimelineController, type TimelineSessionSource } from "./controller"
import type { TimelineFollow } from "./follow"
import { createTimelineVirtualizer, type TimelineRouteReveal } from "./virtualizer"
import { createSelectedEffect } from "./selected-effect"
import { containsDirectory } from "@opencode/util/path"
import { isWorkspaceDirectory } from "@/workspaces/paths"
import { parseCommentNote, readPromptPresentation } from "@/composer/comment-note"
import { parseVoiceDelegation } from "./voice-delegation"
import { useCommand } from "@/shell/commands/command"
import { usePluginScoped } from "@/runtime/plugin/commands"
import {
  SessionAncestorTrail,
  SessionHeaderLayout,
  SessionLocation,
  SessionTitleHeader,
} from "../session-identity-header"
import { SessionHeaderSpacer } from "@/session/header/session-header"
import { SessionHeaderGap } from "@/session/header/drag-area"
import { SessionWorkingIndicator } from "@/session/header/session-working-indicator"

type BlockingTask = { type: "shell"; partID: string; id?: string; label?: string; started: number }

type SessionBackground = {
  blocking: Accessor<BlockingTask[]>
  tasks: Accessor<readonly BackgroundTask[]>
  move: () => Promise<void>
}

export function BackgroundMoveHint(props: { keybind?: string[]; onMove?: () => void }) {
  const language = useLanguage()
  const command = useCommand()
  const keys = () => props.keybind ?? command.keybindParts("session.background")
  const keybind = () => props.keybind?.join("+") ?? command.keybind("session.background")

  return (
    <Button
      data-component="session-background-hint"
      type="button"
      variant="ghost-faint"
      size="small"
      class="max-w-full"
      aria-label={language.t("session.background.moveInline", { keybind: keybind() })}
      onClick={() => props.onMove?.()}
    >
      <span class="min-w-0 truncate">{language.t("session.background.moveRunning")}</span>
      <Keybind keys={keys()} variant="neutral" />
    </Button>
  )
}

type MessageTimelineProps = {
  hideHeader?: boolean
  /** Hands the header's empty gap to the pane's window drag area. */
  registerHeaderGap?: (gap: HTMLElement) => () => void
  active?: boolean
  session: TimelineSessionSource
  view: MountedSession
  screen: SessionScreen
  background: SessionBackground
  actions?: SessionUserActions
  scroll: { overflow: boolean; jump: boolean }
  onResumeScroll: (behavior?: ScrollBehavior) => void
  setScrollRef: (el: HTMLDivElement | undefined) => void
  onScheduleScrollState: (el: HTMLDivElement) => void
  follow: TimelineFollow
  onUserScroll: (target?: EventTarget | null) => void
  onHistoryScroll: () => void
  centered: boolean
  reserveReviewToggle: boolean
  onContentResize: () => void
  bottomInset?: number
  setVisibleRef?: (el: HTMLDivElement | undefined) => void
  anchor: (id: string) => string
  setRevealMessage?: (fn: (id: string, partID?: string) => void) => void
  setScrollToEnd?: (fn: (behavior?: ScrollBehavior) => void) => void
  setPage?: (fn: (direction: 1 | -1) => void) => void
  reveal?: TimelineRouteReveal
  search?: JSX.Element
}

export function MessageTimeline(props: MessageTimelineProps) {
  const settings = useSettings()

  // The New timeline experiment builds its own projection and rows, so turning it on or off mounts the timeline again.
  return (
    <Show when={settings.general.newTimeline()} fallback={<MountedTimeline {...props} next={false} />}>
      <MountedTimeline {...props} next />
    </Show>
  )
}

function MountedTimeline(props: MessageTimelineProps & { next: boolean }) {
  const controller = createTimelineController({
    session: props.session,
    active: () => props.active !== false,
    next: props.next,
  })

  const tail = props.follow.following() ? controller.data.projection.rows().at(-1) : undefined

  if (tail?._tag === "AssistantPart" && tail.group.type === "part") {
    const message = controller.data.projection.messageByID().get(tail.group.ref.messageID)

    if (message?.type === "assistant" && message.time.completed !== undefined) {
      const content = Timeline.resolveContent(message, tail.group.ref.partID)

      // Start the required worker job while the rest of the selected view is constructed.
      if (content?.type === "text" && content.text.trim()) {
        const preload = new AbortController()
        onCleanup(() => abort(preload))
        void preloadMarkdown(content.text, tail.group.ref.partID, preload.signal).catch(() => undefined)
      }
    }
  }

  return <MessageTimelineView {...props} data={controller.data} action={controller.action} title={controller.title} />
}

function MessageTimelineView(
  props: MessageTimelineProps & {
    next: boolean
    data: TimelineController["data"]
    action: TimelineController["action"]
    title: TimelineController["title"]
  },
) {
  const language = useLanguage()
  const command = useCommand()
  const pluginScoped = usePluginScoped()
  const server = useServer()
  const data = server.ctx.data
  const sdk = useWorkspaceLocation()
  const sessionID = props.data.sessionID
  const sessionStatus = props.data.status
  const parentID = props.data.parentID
  const parentTitle = props.data.parentTitle
  const childTitle = props.data.childTitle
  const projection = props.data.projection
  const sessionDirectory = createMemo(() => props.session.data.info()?.location.directory ?? sdk().directory)

  const project = createMemo(() => {
    const session = props.session.data.info()
    const projects = server.ctx.sync.data.project

    return session
      ? server.ctx.projects.forSession(session)
      : projects.find((item) => containsDirectory(item.worktree, sessionDirectory()))
  })

  const workspaceSession = createMemo(() => isWorkspaceDirectory(project(), sessionDirectory()))

  const headerProject = createMemo(() => {
    const session = props.session.data.info()

    if (!session) return

    return server.ctx.projects.forSession(session)
  })

  createSelectedEffect(
    project,
    () => props.active !== false,
    (project) => {
      const directory = project?.worktree

      if (!directory) return
      void data.location.vcs.sync({ directory }).catch(() => undefined)
    },
  )
  const turnPadding = () => "px-4 md:px-6"
  const showHeader = createMemo(() => !props.hideHeader && (props.data.showHeader() || workspaceSession()))
  const messageByID = projection.messageByID

  const virtualized = createTimelineVirtualizer({
    active: () => props.active !== false,
    sessionKey: () => `${server.key}/${props.data.sessionID()}`,
    // Each timeline measures and opens its own rows, so they keep separate caches.
    presentationKey: () => `${props.next ? "next:" : ""}${JSON.stringify(props.data.timelineDetail())}`,
    keepsDisclosure: props.next,
    projection,
    showHeader,
    follow: props.follow,
    scroll: () => props.scroll,
    onResumeScroll: props.onResumeScroll,
    setScrollRef: props.setScrollRef,
    onContentResize: props.onContentResize,
    bottomInset: () => props.bottomInset ?? 0,
    setVisibleRef: props.setVisibleRef,
    onScheduleScrollState: props.onScheduleScrollState,
    onUserScroll: props.onUserScroll,
    onHistoryScroll: props.onHistoryScroll,
    canRenderImmediately: (row, disclosure) => {
      if (
        Predicate.isTagged(row, "TurnGap") ||
        Predicate.isTagged(row, "TurnDivider") ||
        Predicate.isTagged(row, "CompactionQueued") ||
        Predicate.isTagged(row, "Worked") ||
        Predicate.isTagged(row, "Activity")
      )
        return true

      if (Predicate.isTagged(row, "Notice")) {
        const message = messageByID().get(row.messageID)

        return (
          (message?.type === "system" || message?.type === "synthetic") &&
          (message.description ?? message.text).length <= 1024
        )
      }

      if (Predicate.isTagged(row, "UserMessage")) {
        const message = messageByID().get(row.userMessageID)

        if (message?.type !== "user" || message.text.length > 1024 || message.files?.length || message.agents?.length)
          return false
        const presentation = readPromptPresentation(message.metadata)

        return (
          (presentation?.displayText ?? message.text).length <= 1024 &&
          !presentation?.comments?.length &&
          !presentation?.attachments.length &&
          !parseCommentNote(message.text)
        )
      }

      if (!Predicate.isTagged(row, "AssistantPart") || row.group.type !== "part") return false
      const message = messageByID().get(row.group.ref.messageID)

      if (message?.type !== "assistant" || message.time.completed === undefined) return false
      const content = Timeline.resolveContent(message, row.group.ref.partID)

      if (content?.type === "reasoning")
        // The New timeline's finished thoughts start closed, so they render at once like any closed row.
        return !(disclosure[row.group.ref.partID] ?? (!props.next && props.data.reasoningMode() === "full"))

      return (
        content?.type === "text" &&
        content.text.length <= 1024 &&
        !!getReadyMarkdown({ raw: content.text, src: content.text }, `${row.group.ref.partID}:0:full`)
      )
    },
    setRevealMessage: props.setRevealMessage,
    setScrollToEnd: props.setScrollToEnd,
    setPage: props.setPage,
    reveal: props.reveal,
  })

  const VirtualizedTimeline = virtualized.View

  const title = props.title.view

  command.register(() =>
    props.active === false || props.hideHeader
      ? []
      : [
          {
            id: "session.rename",
            category: language.t("command.category.session"),
            title: language.t("command.session.rename"),
            keybind: "ctrl+r",
            disabled: !sessionID() || !!parentID() || title().editing,
            skip: (event) => pluginScoped(event.target),
            onSelect: props.title.edit,
          },
          {
            id: "session.delete",
            category: language.t("command.category.session"),
            title: language.t("command.session.delete"),
            disabled: !sessionID() || !!parentID(),
            onSelect: () => {
              const id = sessionID()

              if (id) props.action.showDelete(id)
            },
          },
        ],
  )

  const settings = useSettings()

  const rowInput = {
    foldUserMessages: settings.general.foldUserMessages,
    sessionID: () => sessionID()!,
    status: sessionStatus,
    projection,
    presentation: (message: SessionMessageUser) => {
      const value = readPromptPresentation(message.metadata)
      const parsed = value ? undefined : parseCommentNote(message.text)
      const voice = parseVoiceDelegation(value?.displayText ?? message.text)

      return {
        displayText: voice ? (voice.framing ?? voice.instruction) : value?.displayText,
        comments: value?.comments ?? (parsed ? [parsed] : []),
        references: value?.attachments,
        voice: !!voice,
      }
    },
    actions: props.actions,
    timelineDetail: props.data.timelineDetail,
    disclosure: virtualized.disclosure,
    centered: () => props.centered,
    padding: turnPadding,
    anchor: props.anchor,
    revealPart: virtualized.revealPart,
  }

  const rowRenderer = props.next
    ? createNextTimelineRowRenderer(rowInput)
    : createSessionTimelineRowRenderer({
        ...rowInput,
        reasoningMode: props.data.reasoningMode,
        shellToolDefaultOpen: props.data.shellToolPartsExpanded,
        editToolDefaultOpen: props.data.editToolPartsExpanded,
      })

  const blockingPartID = createMemo(() => {
    const blocking = new Set(props.background.blocking().map((task) => task.partID))

    if (blocking.size === 0) return

    return projection
      .rows()
      .flatMap((row) =>
        Predicate.isTagged(row, "AssistantPart") ? (row.group.type === "part" ? [row.group.ref] : row.group.refs) : [],
      )
      .findLast((ref) => blocking.has(ref.partID))?.partID
  })

  // The New timeline's button to move work to the background waits until the shell has run for a moment,
  // so a quick command does not flash it. The wait counts from when the call started, so a call already running when
  // the timeline opens shows it at once.
  const [settledBlockingPartID, setSettledBlockingPartID] = createSignal<string>()

  createEffect(() => {
    if (!props.next) return
    const partID = blockingPartID()
    const started = props.background.blocking().find((task) => task.partID === partID)?.started

    if (!partID || started === undefined) return
    const timer = setTimeout(() => setSettledBlockingPartID(partID), Math.max(0, started + 300 - Date.now()))
    onCleanup(() => clearTimeout(timer))
  })

  const backgroundHintPartID = () => {
    const partID = blockingPartID()

    if (!props.next) return partID

    return partID && settledBlockingPartID() === partID ? partID : undefined
  }

  const [backgroundHintRef, setBackgroundHintRef] = createSignal<HTMLDivElement>()

  const backgroundHintPresence = createAnimatedPresence(
    backgroundHintPartID,
    () => backgroundHintRef() ?? null,
    sessionID,
    1000,
  )

  const showWorking = createMemo(() => {
    const id = sessionID()

    if (!id || sessionStatus().type !== "busy") return false

    if (data.session.permission.list(id)?.length || data.session.form.list(id)?.length) return false
    const active = projection.activeMessageID()

    if (!active) return false
    const assistant = projection.assistantMessagesByParent().get(active)?.at(-1)

    if (assistant?.retry) return false

    // Pending steers still project under the previous response until delivery.
    // Its error must not hide feedback for a newly submitted prompt.
    if (
      assistant?.error &&
      !data.session.pending.list(id).some((item) => item.type === "user" && item.delivery === "steer")
    )
      return false
    const content = assistant?.content.at(-1)

    if (
      assistant?.time.completed === undefined &&
      assistant?.time.streamed === undefined &&
      content?.type === "text" &&
      content.text.trim()
    )
      return false
    const background = new Set(props.background.tasks().map((task) => task.id))

    return !projection.rows().some((row) => {
      if (row.userMessageID !== active) return false

      if (Predicate.isTagged(row, "Thinking")) return true

      if (Predicate.isTagged(row, "Notice")) {
        const message = messageByID().get(row.messageID)

        return message?.type === "compaction" && message.status === "running"
      }

      if (!Predicate.isTagged(row, "AssistantPart")) return false

      // A live group of only thoughts reads as Thinking and stands in for Working.
      if (row.group.type === "context" && projection.lastAssistantGroupKey().get(active) === row.group.key)
        return row.group.refs.every(
          (ref) => Timeline.resolveContent(messageByID().get(ref.messageID), ref.partID)?.type === "reasoning",
        )

      // Used and read groups keep the fallback, so each new read does not swap Working out for its short call.
      if (row.group.type === "context" || row.group.type === "read") return false

      return (row.group.type === "part" ? [row.group.ref] : row.group.refs).some((ref) => {
        const content = Timeline.resolveContent(messageByID().get(ref.messageID), ref.partID)

        if (content?.type !== "tool") return false

        if (content.state.status === "streaming" || content.state.status === "running") return true
        const taskID = content.state.metadata?.[content.name === "subagent" ? "sessionID" : "shellID"]

        return Predicate.isString(taskID) && background.has(taskID)
      })
    })
  })

  // In the New timeline, the status line is the one live indicator: it stays below the turn while it works and says
  // the most useful thing happening, in place of each group showing its own.
  const nextStatus = createMemo(() => {
    if (!props.next) return
    const id = sessionID()
    const active = projection.activeMessageID()

    if (!id || !active || sessionStatus().type !== "busy") return

    return timelineStatus({
      blocked: data.session.permission.list(id)?.length
        ? "approval"
        : data.session.form.list(id)?.length
          ? "answer"
          : undefined,
      content: projection.assistantMessagesByParent().get(active)?.at(-1)?.content ?? [],
    })
  })

  // A thought the model is writing stands in for Working, as its row says Thinking. A wait still shows, so the user
  // sees what to act on.
  const liveThought = createMemo(() => {
    if (!props.next) return false
    const active = projection.activeMessageID()

    return projection.rows().some((row) => Predicate.isTagged(row, "Thinking") && row.userMessageID === active)
  })

  const laneSpacing = createMemo(() => {
    if (!props.next) return
    const active = projection.activeMessageID()

    if (!active) return

    return laneGap(projection.rows(), active, messageByID())
  })

  const working = () => {
    if (!props.next) return showWorking()
    const status = nextStatus()

    return !!status && (status !== "working" || !liveThought())
  }

  // Undelivered input waits below the work the model has seen, so live status moves into the row above it.
  const activityRow = createMemo(() => projection.rows().some((row) => Predicate.isTagged(row, "Activity")))

  const hint = (live: () => boolean) => (
    <Show when={live() && backgroundHintPresence.present()}>
      <div
        ref={setBackgroundHintRef}
        data-component="session-background-hint-row"
        class="duration-150 motion-reduce:animate-none"
        classList={{
          "animate-in fade-in": backgroundHintPresence.animate() && backgroundHintPresence.show(),
          "animate-out fade-out fill-mode-forwards": backgroundHintPresence.animate() && !backgroundHintPresence.show(),
        }}
      >
        <BackgroundMoveHint onMove={props.background.move} />
      </div>
    </Show>
  )

  // The lane keeps its height while empty, so Working and the hint come and go without moving the rows around it.
  // The bottom lane also keeps its height while live status moves into the Activity row, so the tail the activity pill
  // floats in never closes and a pinned timeline does not shift when input waits.
  const activity = (live: () => boolean) => (
    <div
      classList={{
        "min-w-0 w-full max-w-full": true,
        "md:max-w-session md:mx-auto": props.centered,
      }}
    >
      <Show
        when={props.next}
        fallback={
          <div class={`flex h-9 items-center gap-2 pt-3 text-[13px] font-[530] leading-text-compact ${turnPadding()}`}>
            <Show when={live() && showWorking()}>
              <div data-component="session-working" role="status">
                <TextShimmer text={language.t("session.timeline.working")} active />
              </div>
            </Show>
            {hint(live)}
          </div>
        }
      >
        {/* The status line sits where the turn's next row will, so that row takes its place without moving; the
            thought the model is writing takes the lane's place, so the lane folds away under it. */}
        <StatusLane
          class={turnPadding()}
          spacing={laneSpacing()}
          label={live() && working() ? language.t(`session.timeline.status.${nextStatus() ?? "working"}`) : undefined}
          collapsed={live() && liveThought() && !working() && !backgroundHintPresence.present()}
        >
          {hint(live)}
        </StatusLane>
      </Show>
    </div>
  )

  return (
    <VirtualizedTimeline
      bottomSpacer={activity(() => !activityRow())}
      deferred={(row) => {
        if (!Predicate.isTagged(row, "AssistantPart") || row.group.type !== "part") return false
        const content = Timeline.resolveContent(messageByID().get(row.group.ref.messageID), row.group.ref.partID)

        return content?.type === "tool" && ["edit", "write"].includes(content.name)
      }}
      renderRow={(row, onSizeChange) => (
        <Show
          when={Predicate.isTagged(row(), "Activity")}
          fallback={<rowRenderer.Row row={row} onSizeChange={onSizeChange} />}
        >
          {(_) => {
            // This row sits above input still waiting for delivery. Until live status first shows, it takes no room,
            // so the waiting input keeps the place delivery leaves it. Once shown, the lane stays for the life of the
            // row: Working hides and returns several times in one step, and each change would move that input 36px.
            const shown = createMemo((was) => was || working() || backgroundHintPresence.present(), false)

            return <Show when={shown()}>{activity(() => true)}</Show>
          }}
        </Show>
      )}
      header={
        <Show when={!props.hideHeader}>
          <SessionTitleHeader>
            <SessionHeaderLayout
              title={title().editing ? title().draft : childTitle()}
              location={
                <>
                  <SessionLocation
                    project={headerProject()}
                    directory={sessionDirectory()}
                    compact={!!parentID()}
                    trailing={!!(parentID() || childTitle() || title().editing)}
                    context={{
                      get session() {
                        return props.view
                      },
                      get screen() {
                        return props.screen
                      },
                    }}
                  />
                  <Show when={parentID()}>
                    {(id) => (
                      <SessionAncestorTrail
                        sessionID={sessionID() ?? ""}
                        parentID={id()}
                        parentTitle={parentTitle()}
                        trailing={!!(childTitle() || title().editing)}
                      />
                    )}
                  </Show>
                </>
              }
              actions={(fit) => (
                <Show when={sessionID()} keyed>
                  {(_id) => (
                    <>
                      {props.search}
                      <PluginSlot
                        at="session.header"
                        input={{
                          get session() {
                            return props.view
                          },
                          get screen() {
                            return props.screen
                          },
                          get active() {
                            return props.active !== false
                          },
                          get compact() {
                            return fit.compact
                          },
                        }}
                      />
                      <SessionHeaderSpacer visible={props.reserveReviewToggle} />
                    </>
                  )}
                </Show>
              )}
            >
              <Show when={parentID() && childTitle()}>
                {(value) => (
                  <>
                    <SessionWorkingIndicator sessionID={sessionID()} />
                    <h1
                      data-slot="session-title-child"
                      dir="auto"
                      class="max-w-[45%] shrink-0 w-fit truncate rounded-[6px] px-1 py-1.5 text-[13px] font-[530] leading-4 tracking-[-0.04px] text-v2-text-text-base"
                    >
                      {value()}
                    </h1>
                  </>
                )}
              </Show>
              <Show when={!parentID() && (childTitle() || title().editing)}>
                <Show
                  when={title().editing}
                  fallback={
                    <h1
                      data-slot="session-title-child"
                      class="truncate text-[13px] font-[530] leading-4 tracking-[-0.04px] text-v2-text-text-base w-fit rounded-[6px] px-1 py-1.5 hover:bg-v2-overlay-simple-overlay-hover"
                      classList={{ "max-w-[45%] shrink-0": !!parentID() }}
                      onClick={props.title.edit}
                    >
                      {childTitle()}
                    </h1>
                  }
                >
                  <InlineInput
                    ref={props.title.setInput}
                    data-slot="session-title-child"
                    dir="auto"
                    value={title().draft}
                    disabled={title().saving}
                    class="block text-[13px] font-[530] leading-4 tracking-[-0.04px] text-v2-text-text-base field-sizing-content rounded-[6px] px-1 py-1.5"
                    classList={{ "max-w-[45%] shrink-0": !!parentID() }}
                    style={{
                      "text-align": "start",
                    }}
                    onInput={(event) => props.title.change(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      event.stopPropagation()

                      if (event.isComposing || event.keyCode === 229) return

                      if (event.key === "Enter") {
                        event.preventDefault()
                        props.title.submit()

                        return
                      }

                      if (event.key === "Escape") {
                        event.preventDefault()
                        props.title.cancel()
                      }
                    }}
                    onBlur={props.title.submit}
                  />
                </Show>
              </Show>
              <Show when={!parentID() && sessionID()} keyed>
                {(id) => (
                  <Menu
                    gutter={6}
                    placement="bottom-start"
                    open={title().menuOpen}
                    onOpenChange={props.title.toggleMenu}
                  >
                    <Menu.Trigger
                      as={IconButton}
                      icon={<Icon name="outline-dots" />}
                      variant="ghost-muted"
                      size="large"
                      class="shrink-0"
                      aria-label={language.t("common.moreOptions")}
                      aria-expanded={title().menuOpen}
                    />
                    <Menu.Portal>
                      <Menu.Content
                        class="session-options-menu w-max"
                        style={{ "min-width": "0" }}
                        onCloseAutoFocus={(event) => {
                          if (!title().editOnMenuClose) return
                          event.preventDefault()
                          props.title.menuClosed()
                        }}
                      >
                        <Menu.Item onSelect={props.title.chooseRename}>{language.t("common.rename")}</Menu.Item>
                        <Menu.Item disabled={props.action.exporting(id)} onSelect={() => props.action.export(id)}>
                          {language.t("common.export")}…
                        </Menu.Item>
                        <Menu.Separator />
                        <Menu.Item onSelect={() => props.action.showDelete(id)}>
                          {language.t("common.delete")}…
                        </Menu.Item>
                      </Menu.Content>
                    </Menu.Portal>
                  </Menu>
                )}
              </Show>
              <Show when={!title().editing}>
                <SessionHeaderGap active={props.active !== false} register={props.registerHeaderGap} />
              </Show>
            </SessionHeaderLayout>
          </SessionTitleHeader>
        </Show>
      }
    />
  )
}
