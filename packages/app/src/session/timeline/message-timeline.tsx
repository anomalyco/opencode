import { createEffect, createMemo, createSignal, For, on, onCleanup, Show, type Accessor, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { createAnimatedPresence } from "@/runtime/animated-presence"
import type { SessionUserActions } from "@opencode-ai/session-ui/actions"
import { Button } from "@opencode-ai/ui/button"
import { DiffChanges } from "@opencode-ai/ui/diff-changes"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { InlineInput } from "@opencode-ai/ui/inline-input"
import { Keybind } from "@opencode-ai/ui/keybind"
import { Menu } from "@opencode-ai/ui/menu"
import { TextShimmer } from "@opencode-ai/ui/text-shimmer"
import { ProjectAvatar } from "@opencode-ai/ui/project-avatar"
import type { Project } from "@/runtime/server/types"
import { getFilename } from "@opencode-ai/util/path"
import { Popover } from "@kobalte/core/popover"
import { SessionContextUsage } from "@/session/timeline/session-context-usage"
import { useLanguage } from "@/runtime/i18n/language"
import { useData, useServer } from "@/runtime/server/current"
import { useWorkspaceLocation } from "@/workspaces/location"
import { Timeline, TimelineRow } from "@opencode-ai/session-ui/timeline/projection"
import { createSessionTimelineRowRenderer } from "@opencode-ai/session-ui/timeline/row"
import { getReadyMarkdown, preloadMarkdown } from "@opencode-ai/session-ui/markdown-cache"
import { createTimelineController, type TimelineController, type TimelineSessionSource } from "./controller"
import { createTimelineVirtualizer } from "./virtualizer"
import { containsDirectory, isWorkspaceDirectory, workspaceDirectories } from "@/workspaces/paths"
import { SessionWorkspaceMenu } from "@/session/timeline/session-workspace-menu"
import { getProjectAvatarVariant } from "@/shell/state/layout"
import { displayName, getProjectAvatarSource, projectForSession } from "@/shell/layout/helpers"
import { parseCommentNote, readPromptPresentation } from "@/composer/comment-note"
import { useCommand } from "@/shell/commands/command"
import { useSettings } from "@/settings/model"
import { SessionProjectMenu, SessionTitleHeader } from "../session-identity-header"
import { SessionHeader } from "@/session/header/session-header"

type BackgroundTask = {
  id: string
  type: "shell" | "subagent"
  label: string
  agent?: string
}

type SessionBackground = {
  blocking: Accessor<{ type: "shell" | "subagent"; partID: string; id?: string; label?: string }[]>
  tasks: Accessor<BackgroundTask[]>
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

export function BackgroundWorkSummary(props: { tasks: BackgroundTask[]; mobile?: boolean }) {
  const language = useLanguage()
  const [open, setOpen] = createSignal(false)
  const [triggerRef, setTriggerRef] = createSignal<HTMLButtonElement>()
  const tasks = createMemo<BackgroundTask[]>((previous = []) => (props.tasks.length > 0 ? props.tasks : previous))
  const presence = createAnimatedPresence(
    () => (props.tasks.length > 0 ? true : undefined),
    () => triggerRef() ?? null,
  )
  createEffect(() => {
    if (props.tasks.length > 0) return
    setOpen(false)
  })
  const taskType = (task: BackgroundTask) => {
    if (task.type === "shell") return language.t("ui.tool.shell")
    if (!task.agent) return language.t("ui.tool.agent.default")
    return task.agent.slice(0, 1).toUpperCase() + task.agent.slice(1)
  }

  return (
    <Popover
      open={open()}
      placement={props.mobile ? "top-end" : language.direction() === "rtl" ? "right-end" : "left-end"}
      gutter={4}
      onOpenChange={(value) => setOpen(value && props.tasks.length > 0)}
    >
      <Show when={presence.present()}>
        <Popover.Trigger
          ref={setTriggerRef}
          as="button"
          type="button"
          data-component="session-background-summary"
          class="flex h-7 w-full items-center gap-2 rounded-[4px] px-3 text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none data-[expanded]:bg-v2-overlay-simple-overlay-pressed duration-150 motion-reduce:animate-none"
          classList={{
            "animate-out fade-out fill-mode-forwards": presence.animate() && !presence.show(),
          }}
          aria-label={language.plural("session.background.tasksRunning", tasks().length)}
        >
          <Icon
            name="outline-arrow-to-corner-top-right"
            class="shrink-0 text-v2-icon-icon-muted"
          />
          <TextShimmer
            as="span"
            text={language.plural("session.background.tasksRunning", tasks().length)}
            active
            class="min-w-0 flex-1 truncate text-start"
          />
        </Popover.Trigger>
      </Show>
      <Popover.Portal>
        <Popover.Content
          data-component="session-background-list"
          class="z-[60] w-[200px] overflow-hidden rounded-[6px] bg-v2-background-bg-layer-01 p-0.5 shadow-[var(--v2-elevation-floating)] outline-none data-[closed]:animate-out data-[closed]:fade-out data-[closed]:duration-150 motion-reduce:data-[closed]:animate-none"
        >
          <For each={tasks().slice(0, 10)}>
            {(task) => (
              <div
                data-component="session-background-list-item"
                class="flex h-7 min-w-0 items-center gap-2 rounded-[4px] px-3 text-[13px] font-[440] leading-none tracking-[-0.04px]"
              >
                <span class="shrink-0 text-v2-text-text-base">{taskType(task)}</span>
                <span class="min-w-0 flex-1 truncate text-v2-text-text-faint">{task.label}</span>
              </div>
            )}
          </For>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  )
}

function WorkspaceMoveAction(props: {
  variant: "inline" | "panel"
  mobile?: boolean
  eligible: boolean
  sessionID: string
  project: Project
  directory: string
  dismissed: boolean
  onDismiss: () => void
}) {
  const language = useLanguage()
  const inline = () => props.variant === "inline"
  return (
    <div
      classList={{
        "group/workspace-move relative shrink-0": true,
        "ms-auto h-5 w-[167px]": inline(),
        "-mt-2.5 h-[46px] w-full rounded-b-[6px] bg-v2-background-bg-layer-02 hover:bg-v2-background-bg-layer-03 transition-colors":
          !inline(),
        hidden: props.dismissed,
      }}
    >
      <SessionWorkspaceMenu
        eligible={props.eligible}
        sessionID={props.sessionID}
        project={props.project}
        directory={props.directory}
        placement={
          props.mobile
            ? "top-end"
            : inline()
              ? "bottom-end"
              : language.direction() === "rtl"
                ? "right-start"
                : "left-start"
        }
        gutter={props.mobile || inline() ? 4 : -22}
        contentClass={props.mobile || inline() ? undefined : "relative top-3.5"}
        class={
          inline()
            ? "flex h-5 w-full items-center gap-1.5 rounded-[4px] pe-6 text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-faint hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none data-[expanded]:bg-v2-overlay-simple-overlay-pressed"
            : "flex h-[46px] w-full items-center gap-2 rounded-b-[6px] px-3 pe-9 pt-2.5 text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-muted focus-visible:outline-none"
        }
      >
        <Icon name="workspace-new" class="shrink-0 text-v2-icon-icon-muted" />
        <span class="min-w-0 truncate">{language.t("workspace.move.title")}</span>
      </SessionWorkspaceMenu>
      <button
        type="button"
        class={`absolute flex size-5 -translate-y-1/2 items-center justify-center rounded-[4px] text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-icon-icon-base focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:text-v2-icon-icon-base focus-visible:outline-none ${
          inline()
            ? "end-0 top-1/2"
            : "hover-reveal end-3 top-[calc(50%+5px)] group-hover/workspace-move:opacity-100 group-focus-within/workspace-move:opacity-100"
        }`}
        aria-label={language.t("common.dismiss")}
        onClick={(event) => {
          event.stopPropagation()
          props.onDismiss()
        }}
      >
        <Icon name="xmark-small" />
      </button>
    </div>
  )
}

export function SessionSummaryPanel(props: {
  mobile?: boolean
  project: Project
  avatar?: JSX.Element
  directory: string
  local: boolean
  branch?: string
  baseBranch?: string
  diffs?: { additions: number; deletions: number }[]
  sessionID: string
  moveEligible: boolean
  moveDismissed: boolean
  onMoveDismiss: () => void
  onReview: () => void
  backgroundTasks: BackgroundTask[]
}) {
  const language = useLanguage()
  const location = () => {
    if (props.local) return language.t("session.new.workspace.local")
    const workspace = workspaceDirectories(props.project).find((item) => containsDirectory(item, props.directory))
    return getFilename(workspace ?? props.directory)
  }
  const branch = () => props.branch ?? props.baseBranch
  const row =
    "flex h-7 w-full items-center gap-2 rounded-[4px] px-3 text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-base"

  return (
    <div data-component="session-summary-panel" class={props.mobile ? "w-full" : "w-[280px]"}>
      <div class="relative z-10 flex flex-col gap-1 overflow-hidden rounded-[6px] bg-v2-background-bg-base px-0.5 py-1.5 shadow-[var(--v2-elevation-raised)]">
        <div class={row}>
          {props.avatar ?? (
            <ProjectAvatar
              fallback={displayName(props.project)}
              src={getProjectAvatarSource(props.project.id, props.project.icon)}
              variant={getProjectAvatarVariant(props.project.icon?.color)}
            />
          )}
          <span dir="auto" class="min-w-0 flex-1 truncate text-v2-text-text-muted">
            {displayName(props.project)}
          </span>
        </div>
        <SessionWorkspaceMenu
          eligible={props.moveEligible}
          sessionID={props.sessionID}
          project={props.project}
          directory={props.directory}
          placement={props.mobile ? "top-end" : language.direction() === "rtl" ? "right-start" : "left-start"}
          gutter={props.mobile ? 4 : -22}
          class={`${row} hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none data-[expanded]:bg-v2-overlay-simple-overlay-pressed`}
        >
          <Icon name={props.local ? "monitor" : "workspace-isolated"} class="shrink-0 text-v2-icon-icon-muted" />
          <span dir="auto" class="min-w-0 flex-1 truncate text-start">
            {location()}
          </span>
          <Icon name="chevron-down" size="small" class="shrink-0 text-v2-icon-icon-muted" />
        </SessionWorkspaceMenu>
        <div class={row}>
          <Icon name="branch" class="shrink-0 text-v2-icon-icon-muted" />
          <Show
            when={props.branch}
            fallback={
              <span class="flex min-w-0 items-center gap-1.5">
                <span class="shrink-0 whitespace-nowrap">{language.t("session.summary.noBranch")}</span>
                <Show when={props.baseBranch}>
                  {(base) => (
                    <>
                      <span class="text-v2-text-text-muted">·</span>
                      <span class="truncate text-v2-text-text-faint">
                        {language.t("session.summary.basedOn", { branch: base() })}
                      </span>
                    </>
                  )}
                </Show>
              </span>
            }
          >
            <span dir="auto" class="min-w-0 truncate">
              {branch()}
            </span>
          </Show>
        </div>
        <button
          type="button"
          class={`${row} hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none`}
          onClick={props.onReview}
        >
          <Icon name="review" class="shrink-0 text-v2-icon-icon-muted" />
          <Show when={props.diffs} fallback={<span>{language.t("session.review.loadingChanges")}</span>}>
            {(diffs) => (
              <Show when={diffs().length > 0} fallback={<span>{language.t("session.review.noChanges")}</span>}>
                <span>{language.plural("ui.sessionTurn.diffs.changed", diffs().length)}</span>
                <span class="text-v2-text-text-muted">·</span>
                <DiffChanges appearance="standard" changes={diffs()} />
              </Show>
            )}
          </Show>
        </button>
        <div
          class="grid transition-[grid-template-rows] duration-150 ease-out motion-reduce:transition-none"
          classList={{
            "grid-rows-[1fr]": props.backgroundTasks.length > 0,
            "grid-rows-[0fr]": props.backgroundTasks.length === 0,
          }}
        >
          <div class="min-h-0 overflow-hidden">
            <BackgroundWorkSummary tasks={props.backgroundTasks} mobile={props.mobile} />
          </div>
        </div>
      </div>
      <Show when={props.local && props.diffs && props.diffs.length > 0 && props.moveEligible}>
        <WorkspaceMoveAction
          variant="panel"
          mobile={props.mobile}
          eligible={props.moveEligible}
          sessionID={props.sessionID}
          project={props.project}
          directory={props.directory}
          dismissed={props.moveDismissed}
          onDismiss={props.onMoveDismiss}
        />
      </Show>
    </div>
  )
}

type MessageTimelineProps = {
  hideHeader?: boolean
  session: TimelineSessionSource
  background: SessionBackground
  actions?: SessionUserActions
  scroll: { overflow: boolean; jump: boolean }
  onResumeScroll: () => void
  setScrollRef: (el: HTMLDivElement | undefined) => void
  onScheduleScrollState: (el: HTMLDivElement) => void
  onPin: () => void
  onUnpin: () => void
  onUserScroll: (target?: EventTarget | null) => void
  onHistoryScroll: () => void
  onSelectionInteraction: (event: MouseEvent) => void
  pinned: boolean
  centered: boolean
  setContentRef: (el: HTMLDivElement) => void
  diffs: Accessor<{ additions: number; deletions: number }[] | undefined>
  onReview: () => void
  workspaceMoveEligible: boolean
  onSummaryOpenChange: (open: boolean) => void
  anchor: (id: string) => string
  setRevealMessage?: (fn: (id: string, partID?: string) => void) => void
  setScrollToEnd?: (fn: () => void) => void
  search?: JSX.Element
}

export function MessageTimeline(props: MessageTimelineProps) {
  const controller = createTimelineController({ session: props.session })
  const tail = props.pinned ? controller.data.projection.rows().at(-1) : undefined
  if (tail?._tag === "AssistantPart" && tail.group.type === "part") {
    const message = controller.data.projection.messageByID().get(tail.group.ref.messageID)
    if (message?.type === "assistant" && message.time.completed !== undefined) {
      const content = Timeline.resolveContent(message, tail.group.ref.partID)
      // Start the required worker job while the rest of the selected view is constructed.
      if (content?.type === "text" && content.text.trim()) {
        const preload = new AbortController()
        onCleanup(() => preload.abort())
        void preloadMarkdown(content.text, tail.group.ref.partID, preload.signal).catch(() => undefined)
      }
    }
  }
  return (
    <MessageTimelineView {...props} data={controller.data} action={controller.action} pending={controller.pending} />
  )
}

function MessageTimelineView(
  props: MessageTimelineProps & {
    data: TimelineController["data"]
    action: TimelineController["action"]
    pending: TimelineController["pending"]
  },
) {
  const language = useLanguage()
  const data = useData()
  const server = useServer()
  const settings = useSettings()
  const sdk = useWorkspaceLocation()
  const sessionID = props.data.sessionID
  const sessionStatus = props.data.status
  const titleLabel = props.data.titleLabel
  const parentID = props.data.parentID
  const parentTitle = props.data.parentTitle
  const childTitle = props.data.childTitle
  const projection = props.data.projection
  const sessionDirectory = createMemo(() => props.session.data.info()?.location.directory ?? sdk().directory)
  const project = createMemo(() => {
    const session = props.session.data.info()
    const projects = server.ctx.sync.data.project
    return session
      ? projectForSession(session, projects)
      : projects.find((item) => containsDirectory(item.worktree, sessionDirectory()))
  })
  const workspaceSession = createMemo(() => isWorkspaceDirectory(project(), sessionDirectory()))
  const showProjectIcon = () => import.meta.env.VITE_OPENCODE_CHANNEL !== "prod" && settings.general.showProjectIcon()
  const avatarProject = createMemo(() => {
    const session = props.session.data.info()
    if (!session) return
    return projectForSession(session, server.ctx.projects.list()) ?? project()
  })
  const projectAvatar = () => (
    <ProjectAvatar
      fallback={displayName(avatarProject() ?? { worktree: sessionDirectory() })}
      src={getProjectAvatarSource(avatarProject()?.id, avatarProject()?.icon)}
      variant={getProjectAvatarVariant(avatarProject()?.icon?.color)}
    />
  )
  createEffect(() => {
    const directory = project()?.worktree
    if (!directory) return
    void data.location.vcs.sync({ directory }).catch(() => undefined)
  })
  const [workspaceSuggestionDismissed, setWorkspaceSuggestionDismissed] = createSignal(false)
  const [summaryOpen, setSummaryOpen] = createSignal(false)
  const setSummary = (open: boolean) => {
    setSummaryOpen(open)
    props.onSummaryOpenChange(open)
  }
  const sessionDiffs = createMemo(props.diffs)
  createEffect(
    on(sessionID, () => {
      setSummary(false)
      setWorkspaceSuggestionDismissed(false)
    }),
  )
  const turnPadding = () => "px-4 md:px-5"
  const showHeader = createMemo(() => !props.hideHeader && (props.data.showHeader() || workspaceSession()))
  const pinned = createMemo(() => props.pinned)
  const messageByID = projection.messageByID
  const virtualized = createTimelineVirtualizer({
    sessionKey: () => `${server.key}/${props.data.sessionID()}`,
    presentationKey: () => JSON.stringify(props.data.timelineDetail()),
    projection,
    showHeader,
    pinned,
    scroll: () => props.scroll,
    onResumeScroll: props.onResumeScroll,
    setScrollRef: props.setScrollRef,
    setContentRef: props.setContentRef,
    onScheduleScrollState: props.onScheduleScrollState,
    onPin: props.onPin,
    onUnpin: props.onUnpin,
    onSelectionInteraction: props.onSelectionInteraction,
    onUserScroll: props.onUserScroll,
    onHistoryScroll: props.onHistoryScroll,
    canRenderImmediately: (row, disclosure) => {
      if (row._tag === "TurnGap" || row._tag === "TurnDivider") return true
      if (row._tag === "Notice") {
        const message = messageByID().get(row.messageID)
        return (
          (message?.type === "system" || message?.type === "synthetic") &&
          (message.description ?? message.text).length <= 1024
        )
      }
      if (row._tag === "UserMessage") {
        const message = messageByID().get(row.userMessageID)
        if (message?.type !== "user" || message.text.length > 1024 || message.files?.length || message.agents?.length)
          return false
        const presentation = readPromptPresentation(message.metadata)
        return (
          (presentation?.displayText ?? message.text).length <= 1024 &&
          !presentation?.comments?.length &&
          !parseCommentNote(message.text)
        )
      }
      if (row._tag !== "AssistantPart" || row.group.type !== "part") return false
      const message = messageByID().get(row.group.ref.messageID)
      if (message?.type !== "assistant" || message.time.completed === undefined) return false
      const content = Timeline.resolveContent(message, row.group.ref.partID)
      if (content?.type === "reasoning")
        return !(disclosure[row.group.ref.partID] ?? props.data.reasoningMode() === "full")
      return (
        content?.type === "text" &&
        content.text.length <= 1024 &&
        !!getReadyMarkdown({ raw: content.text, src: content.text }, `${row.group.ref.partID}:0:full`)
      )
    },
    setRevealMessage: props.setRevealMessage,
    setScrollToEnd: props.setScrollToEnd,
  })
  const VirtualizedTimeline = virtualized.View
  const [title, setTitle] = createStore({
    draft: "",
    editing: false,
    menuOpen: false,
    pendingRename: false,
  })
  let titleRef: HTMLInputElement | undefined

  createEffect(
    on(
      props.data.sessionKey,
      () =>
        setTitle({
          draft: "",
          editing: false,
          menuOpen: false,
          pendingRename: false,
        }),
      { defer: true },
    ),
  )

  const openTitleEditor = () => {
    if (!sessionID() || parentID()) return
    setTitle({ editing: true, draft: titleLabel() ?? "" })
    requestAnimationFrame(() => {
      if (!titleRef) return
      titleRef.focus()
      titleRef.select()
    })
  }

  const closeTitleEditor = () => {
    if (props.pending.rename()) return
    setTitle("editing", false)
  }

  const saveTitleEditor = async () => {
    if (!title.editing || props.pending.rename()) return
    if (await props.action.rename(title.draft)) setTitle("editing", false)
  }

  const rowRenderer = createSessionTimelineRowRenderer({
    sessionID: () => sessionID()!,
    status: sessionStatus,
    projection,
    presentation: (message) => {
      const value = readPromptPresentation(message.metadata)
      const parsed = value ? undefined : parseCommentNote(message.text)
      return {
        displayText: value?.displayText,
        comments: value?.comments ?? (parsed ? [parsed] : []),
      }
    },
    actions: props.actions,
    reasoningMode: props.data.reasoningMode,
    shellToolDefaultOpen: props.data.shellToolPartsExpanded,
    editToolDefaultOpen: props.data.editToolPartsExpanded,
    timelineDetail: props.data.timelineDetail,
    disclosure: virtualized.disclosure,
    centered: () => props.centered,
    padding: turnPadding,
    anchor: props.anchor,
  })
  const backgroundHintPartID = createMemo(() => {
    const blocking = new Set(props.background.blocking().map((task) => task.partID))
    if (blocking.size === 0) return
    return projection
      .rows()
      .flatMap((row) =>
        row._tag === "AssistantPart" ? (row.group.type === "part" ? [row.group.ref] : row.group.refs) : [],
      )
      .findLast((ref) => blocking.has(ref.partID))?.partID
  })
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
      if (row._tag === "Thinking") return true
      if (row._tag === "Notice") {
        const message = messageByID().get(row.messageID)
        return message?.type === "compaction" && message.status === "running"
      }
      // Used groups keep the fallback regardless of disclosure state.
      if (row._tag !== "AssistantPart" || row.group.type === "context") return false
      return (row.group.type === "part" ? [row.group.ref] : row.group.refs).some((ref) => {
        const content = Timeline.resolveContent(messageByID().get(ref.messageID), ref.partID)
        if (content?.type !== "tool") return false
        if (content.state.status === "streaming" || content.state.status === "running") return true
        const taskID = content.state.metadata?.[content.name === "subagent" ? "sessionID" : "shellID"]
        return background.has(content.id) || (typeof taskID === "string" && background.has(taskID))
      })
    })
  })
  return (
    <VirtualizedTimeline
      workspaceSession={workspaceSession}
      bottomSpacer={
        <Show when={showWorking() || backgroundHintPresence.present()}>
          <div
            classList={{
              "min-w-0 w-full max-w-full": true,
              "md:max-w-[1000px] md:mx-auto": props.centered,
            }}
          >
            <div
              class={`flex h-9 items-center gap-2 pt-3 text-[13px] font-[530] leading-text-compact ${turnPadding()}`}
            >
              <Show when={showWorking()}>
                <div data-component="session-working" role="status">
                  <TextShimmer text={language.t("session.timeline.working")} active />
                </div>
              </Show>
              <Show when={backgroundHintPresence.present()}>
                <div
                  ref={setBackgroundHintRef}
                  data-component="session-background-hint-row"
                  class="duration-150 motion-reduce:animate-none"
                  classList={{
                    "animate-in fade-in": backgroundHintPresence.animate() && backgroundHintPresence.show(),
                    "animate-out fade-out fill-mode-forwards":
                      backgroundHintPresence.animate() && !backgroundHintPresence.show(),
                  }}
                >
                  <BackgroundMoveHint onMove={props.background.move} />
                </div>
              </Show>
            </div>
          </div>
        </Show>
      }
      deferred={(row) => {
        if (row._tag !== "AssistantPart" || row.group.type !== "part") return false
        const content = Timeline.resolveContent(messageByID().get(row.group.ref.messageID), row.group.ref.partID)
        return content?.type === "tool" && ["edit", "write"].includes(content.name)
      }}
      renderRow={(row, onSizeChange) => <rowRenderer.Row row={row} onSizeChange={onSizeChange} />}
      header={
        <Show when={!props.hideHeader}>
          <SessionTitleHeader>
            <div class="h-12 w-full flex items-center justify-between gap-2">
              <div class="flex items-center gap-1 min-w-0 flex-1">
                <div class="flex items-center gap-0.5 min-w-0 flex-1 w-full">
                  <SessionProjectMenu
                    project={avatarProject()}
                    directory={sessionDirectory()}
                    workspace={workspaceSession()}
                    showProjectIcon={showProjectIcon()}
                  />
                  <Show when={parentID()}>
                    <button
                      type="button"
                      data-slot="session-title-parent"
                      class="min-w-0 max-w-[40%] truncate pl-2 text-[13px] font-[530] leading-4 tracking-[-0.04px] text-v2-text-text-faint transition-colors hover:text-v2-text-text-muted"
                      onClick={props.action.navigateParent}
                    >
                      {parentTitle()}
                    </button>
                    <span
                      data-slot="session-title-separator"
                      class="-translate-y-[0.5px] pl-2 pr-1 text-[11px] font-medium text-v2-text-text-faint"
                      aria-hidden="true"
                    >
                      /
                    </span>
                  </Show>
                  <Show when={childTitle() || title.editing}>
                    <Show
                      when={title.editing}
                      fallback={
                        <h1
                          data-slot="session-title-child"
                          class="truncate text-[13px] font-[530] leading-4 tracking-[-0.04px] text-v2-text-text-base w-fit rounded-[6px] px-1 py-1 hover:bg-v2-overlay-simple-overlay-hover"
                          onClick={openTitleEditor}
                        >
                          {childTitle()}
                        </h1>
                      }
                    >
                      <InlineInput
                        ref={(el) => {
                          titleRef = el
                        }}
                        data-slot="session-title-child"
                        dir="auto"
                        value={title.draft}
                        disabled={props.pending.rename()}
                        class="block text-[13px] font-[530] leading-4 tracking-[-0.04px] text-v2-text-text-base field-sizing-content rounded-[6px] px-1 py-1"
                        style={{
                          "--inline-input-shadow": "none",
                          "text-align": "start",
                        }}
                        onInput={(event) => setTitle("draft", event.currentTarget.value)}
                        onKeyDown={(event) => {
                          event.stopPropagation()
                          if (event.isComposing || event.keyCode === 229) return
                          if (event.key === "Enter") {
                            event.preventDefault()
                            void saveTitleEditor()
                            return
                          }
                          if (event.key === "Escape") {
                            event.preventDefault()
                            closeTitleEditor()
                          }
                        }}
                        onBlur={() => void saveTitleEditor()}
                      />
                    </Show>
                  </Show>
                  <Show when={!parentID() && sessionID()} keyed>
                    {(id) => (
                      <Menu
                        gutter={6}
                        placement="bottom-start"
                        open={title.menuOpen}
                        onOpenChange={(open) => setTitle("menuOpen", open)}
                      >
                        <Menu.Trigger
                          as={IconButton}
                          icon={<Icon name="outline-dots" />}
                          variant="ghost-muted"
                          size="large"
                          class="shrink-0"
                          aria-label={language.t("common.moreOptions")}
                          aria-expanded={title.menuOpen}
                        />
                        <Menu.Portal>
                          <Menu.Content
                            class="session-options-menu w-max"
                            style={{ "min-width": "0" }}
                            onCloseAutoFocus={(event) => {
                              if (!title.pendingRename) return
                              event.preventDefault()
                              setTitle("pendingRename", false)
                              openTitleEditor()
                            }}
                          >
                            <Show when={!parentID()}>
                              <Menu.Item
                                onSelect={() => {
                                  setTitle("pendingRename", true)
                                  setTitle("menuOpen", false)
                                }}
                              >
                                {language.t("common.rename")}
                              </Menu.Item>
                              <Menu.Item onSelect={() => void props.action.export(id)}>
                                {language.t("common.export")}…
                              </Menu.Item>
                            </Show>
                            <Show when={!parentID()}>
                              {/* TODO: Need a session archive API. */}
                              <Menu.Separator />
                              <Menu.Item onSelect={() => props.action.showDelete(id)}>
                                {language.t("common.delete")}…
                              </Menu.Item>
                            </Show>
                          </Menu.Content>
                        </Menu.Portal>
                      </Menu>
                    )}
                  </Show>
                </div>
              </div>
              <Show when={sessionID()} keyed>
                {(id) => (
                  <div class="shrink-0 flex items-center gap-2">
                    {props.search}
                    <SessionContextUsage placement="bottom" />
                    <Show when={!parentID() && project()}>
                      {(project) => (
                        <Popover open={summaryOpen()} placement="bottom-end" gutter={6} onOpenChange={setSummary}>
                          <Popover.Trigger
                            as={IconButton}
                            icon={<Icon name="window-analytics" />}
                            variant="ghost-muted"
                            size="large"
                            state={summaryOpen() ? "pressed" : undefined}
                            aria-label={language.t("session.summary.title")}
                            aria-expanded={summaryOpen()}
                          />
                          <Popover.Portal>
                            <Popover.Content class="z-50 border-0 bg-transparent p-0 outline-none">
                              <SessionSummaryPanel
                                project={project()}
                                avatar={showProjectIcon() ? projectAvatar() : undefined}
                                directory={sessionDirectory()}
                                local={!workspaceSession()}
                                branch={data.location.vcs.info({ directory: sdk().directory })?.branch.current}
                                baseBranch={data.location.vcs.info({ directory: project().worktree })?.branch.current}
                                diffs={sessionDiffs()}
                                sessionID={id}
                                moveEligible={props.workspaceMoveEligible}
                                moveDismissed={workspaceSuggestionDismissed()}
                                onMoveDismiss={() => setWorkspaceSuggestionDismissed(true)}
                                onReview={() => {
                                  setSummary(false)
                                  props.onReview()
                                }}
                                backgroundTasks={props.background.tasks()}
                              />
                            </Popover.Content>
                          </Popover.Portal>
                        </Popover>
                      )}
                    </Show>
                    <SessionHeader />
                  </div>
                )}
              </Show>
            </div>
          </SessionTitleHeader>
        </Show>
      }
    />
  )
}
