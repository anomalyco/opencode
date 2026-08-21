import { createEffect, createMemo, createSignal, on, Show, type Accessor, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import type { SessionUserActions } from "@opencode-ai/session-ui/actions"
import { DiffChanges } from "@opencode-ai/ui/diff-changes"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { InlineInput } from "@opencode-ai/ui/inline-input"
import { Menu } from "@opencode-ai/ui/menu"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { ProjectAvatar } from "@opencode-ai/ui/project-avatar"
import { Button } from "@opencode-ai/ui/button"
import type { Project } from "@/types"
import { getFilename } from "@opencode-ai/util/path"
import { Popover } from "@kobalte/core/popover"
import { SessionContextUsage } from "@/session/timeline/session-context-usage"
import { useLanguage } from "@/context/language"
import { useData } from "@/context/server"
import { useWorkspaceLocation } from "@/context/location"
import { Timeline } from "@opencode-ai/session-ui/timeline/projection"
import { createSessionTimelineRowRenderer } from "@opencode-ai/session-ui/timeline/row"
import { createTimelineController, type TimelineController, type TimelineSessionSource } from "./controller"
import { createTimelineVirtualizer } from "./virtualizer"
import { containsDirectory, isWorkspaceDirectory, workspaceDirectories } from "@/utils/workspace"
import { SessionWorkspaceMenu } from "@/session/timeline/session-workspace-menu"
import { getProjectAvatarVariant } from "@/context/layout"
import { displayName, getProjectAvatarSource } from "@/pages/layout/helpers"
import type { SessionMessageUser } from "@opencode-ai/client/promise"
import { parseCommentNote, readPromptPresentation } from "@/utils/comment-note"

function WorkspaceMoveAction(props: {
  variant: "inline" | "panel"
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
        placement={inline() ? "bottom-end" : language.direction() === "rtl" ? "right-start" : "left-start"}
        gutter={inline() ? 4 : -22}
        contentClass={inline() ? undefined : "relative top-3.5"}
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

function SessionSummaryPanel(props: {
  project: Project
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
    <div data-component="session-summary-panel" class="w-[280px]">
      <div class="relative z-10 flex flex-col gap-1 overflow-hidden rounded-[6px] bg-v2-background-bg-base px-0.5 py-1.5 shadow-[var(--v2-elevation-raised)]">
        <div class={row}>
          <ProjectAvatar
            fallback={displayName(props.project)}
            src={getProjectAvatarSource(props.project.id, props.project.icon)}
            variant={getProjectAvatarVariant(props.project.icon?.color)}
          />
          <span class="min-w-0 flex-1 truncate text-v2-text-text-muted">{displayName(props.project)}</span>
        </div>
        <SessionWorkspaceMenu
          eligible={props.moveEligible}
          sessionID={props.sessionID}
          project={props.project}
          directory={props.directory}
          placement={language.direction() === "rtl" ? "right-start" : "left-start"}
          gutter={-22}
          class={`${row} hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none data-[expanded]:bg-v2-overlay-simple-overlay-pressed`}
        >
          <Icon name={props.local ? "monitor" : "workspace-isolated"} class="shrink-0 text-v2-icon-icon-muted" />
          <span class="min-w-0 flex-1 truncate text-start">{location()}</span>
          <Icon name="chevron-down" size="small" class="shrink-0 text-v2-icon-icon-muted" />
        </SessionWorkspaceMenu>
        <div class={row}>
          <Icon name="branch" class="shrink-0 text-v2-icon-icon-muted" />
          <Show
            when={props.branch}
            fallback={
              <span class="flex min-w-0 items-center gap-1.5">
                <span>{language.t("session.summary.noBranch")}</span>
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
            <span class="min-w-0 truncate">{branch()}</span>
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
      </div>
      <Show when={props.local && props.diffs && props.diffs.length > 0 && props.moveEligible}>
        <WorkspaceMoveAction
          variant="panel"
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
  session: TimelineSessionSource
  actions?: SessionUserActions
  scroll: { overflow: boolean; bottom: boolean; jump: boolean }
  onResumeScroll: () => void
  setScrollRef: (el: HTMLDivElement | undefined) => void
  onScheduleScrollState: (el: HTMLDivElement) => void
  onAutoScrollHandleScroll: () => void
  onMarkScrollGesture: (target?: EventTarget | null) => void
  hasScrollGesture: boolean
  onUserScroll: () => void
  onHistoryScroll: () => void
  onAutoScrollInteraction: (event: MouseEvent) => void
  shouldAnchorBottom: boolean
  centered: boolean
  setContentRef: (el: HTMLDivElement) => void
  userMessages: SessionMessageUser[]
  diffs: Accessor<{ additions: number; deletions: number }[] | undefined>
  onReview: () => void
  workspaceMoveEligible: boolean
  onSummaryOpenChange: (open: boolean) => void
  anchor: (id: string) => string
  setRevealMessage?: (fn: (id: string) => void) => void
  setScrollToEnd?: (fn: () => void) => void
  setHistoryAnchor?: (handlers: { capture: () => void; restore: (done: boolean) => void }) => void
}

export function MessageTimeline(props: MessageTimelineProps) {
  const controller = createTimelineController({ session: props.session })
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
  const sdk = useWorkspaceLocation()
  const sessionID = props.data.sessionID
  const sessionStatus = props.data.status
  const titleLabel = props.data.titleLabel
  const shareUrl = props.data.shareUrl
  const shareEnabled = props.data.shareEnabled
  const parentID = props.data.parentID
  const parentTitle = props.data.parentTitle
  const childTitle = props.data.childTitle
  const projection = props.data.projection
  const sessionDirectory = createMemo(() => props.session.data.info()?.location.directory ?? sdk().directory)
  const project = createMemo(() => {
    const projectID = props.session.data.info()?.projectID
    const value = projectID
      ? data.project.get(projectID)
      : data.project.list().find((item) => containsDirectory(item.canonical, sessionDirectory()))
    if (!value) return undefined
    return { ...value, worktree: value.canonical, worktrees: [] }
  })
  const workspaceSession = createMemo(() => isWorkspaceDirectory(project(), sessionDirectory()))
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
  const showHeader = createMemo(() => props.data.showHeader() || workspaceSession())
  const shouldAnchorBottom = createMemo(() => props.shouldAnchorBottom)
  const hasScrollGesture = createMemo(() => props.hasScrollGesture)
  const messageByID = projection.messageByID
  const virtualized = createTimelineVirtualizer({
    sessionKey: props.data.sessionKey,
    projection,
    showHeader,
    shouldAnchorBottom,
    hasScrollGesture,
    scroll: () => props.scroll,
    onResumeScroll: props.onResumeScroll,
    setScrollRef: props.setScrollRef,
    setContentRef: props.setContentRef,
    onScheduleScrollState: props.onScheduleScrollState,
    onAutoScrollHandleScroll: props.onAutoScrollHandleScroll,
    onAutoScrollInteraction: props.onAutoScrollInteraction,
    onMarkScrollGesture: props.onMarkScrollGesture,
    onUserScroll: props.onUserScroll,
    onHistoryScroll: props.onHistoryScroll,
    setRevealMessage: props.setRevealMessage,
    setScrollToEnd: props.setScrollToEnd,
    setHistoryAnchor: props.setHistoryAnchor,
  })
  const VirtualizedTimeline = virtualized.View
  const [title, setTitle] = createStore({
    draft: "",
    editing: false,
    menuOpen: false,
    pendingRename: false,
    pendingShare: false,
  })
  let titleRef: HTMLInputElement | undefined

  const [share, setShare] = createStore({
    open: false,
    dismiss: null as "escape" | "outside" | null,
  })
  let more: HTMLButtonElement | undefined

  const selectShareUrlText: JSX.EventHandler<HTMLDivElement, MouseEvent> = (event) => {
    const selection = window.getSelection()
    if (!selection) return
    const range = document.createRange()
    range.selectNodeContents(event.currentTarget)
    selection.removeAllRanges()
    selection.addRange(range)
  }

  createEffect(
    on(
      props.data.sessionKey,
      () =>
        setTitle({
          draft: "",
          editing: false,
          menuOpen: false,
          pendingRename: false,
          pendingShare: false,
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
    showReasoningSummaries: props.data.showReasoningSummaries,
    shellToolDefaultOpen: props.data.shellToolPartsExpanded,
    editToolDefaultOpen: props.data.editToolPartsExpanded,
    disclosure: virtualized.disclosure,
    centered: () => props.centered,
    padding: turnPadding,
    anchor: props.anchor,
  })

  return (
    <VirtualizedTimeline
      workspaceSession={workspaceSession}
      deferred={(row) => {
        if (row._tag !== "AssistantPart" || row.group.type !== "part") return false
        const content = Timeline.resolveContent(messageByID().get(row.group.ref.messageID), row.group.ref.partID)
        return content?.type === "tool" && ["edit", "write", "patch"].includes(content.name)
      }}
      renderRow={(row, onSizeChange) => <rowRenderer.Row row={row} onSizeChange={onSizeChange} />}
      header={
        <div
          data-session-title
          class="sticky top-0 z-30 bg-[linear-gradient(to_bottom,var(--v2-background-bg-base)_48px,transparent)] w-full pb-4 pr-3 pl-2.5"
        >
          <div class="h-12 w-full flex items-center justify-between gap-2">
            <div class="flex items-center gap-1 min-w-0 flex-1">
              <div class="flex items-center min-w-0 flex-1 w-full">
                <Show
                  when={workspaceSession()}
                  fallback={
                    <span class="flex size-6 shrink-0 items-center justify-center text-v2-icon-icon-muted">
                      <Icon name="monitor" />
                    </span>
                  }
                >
                  <Tooltip
                    placement="bottom-start"
                    value={sessionDirectory()}
                    contentClass="max-w-[calc(100vw-32px)] break-all"
                  >
                    <span
                      tabIndex={0}
                      aria-label={sessionDirectory()}
                      class="flex size-6 shrink-0 items-center justify-center text-v2-icon-icon-accent"
                    >
                      <Icon name="workspace-isolated" />
                    </span>
                  </Tooltip>
                </Show>
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
                        class="truncate text-[13px] font-[530] leading-4 tracking-[-0.04px] text-v2-text-text-base w-fit rounded-[6px] px-2 py-1 hover:bg-v2-overlay-simple-overlay-hover"
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
                      class="block text-[13px] font-[530] leading-4 tracking-[-0.04px] text-v2-text-text-base field-sizing-content self-start rounded-[6px] px-2 py-1"
                      style={{
                        "--inline-input-shadow": "none",
                        "text-align": "start",
                      }}
                      onInput={(event) => setTitle("draft", event.currentTarget.value)}
                      onKeyDown={(event) => {
                        event.stopPropagation()
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
                      onBlur={closeTitleEditor}
                    />
                  </Show>
                </Show>
              </div>
            </div>
            <Show when={sessionID()} keyed>
              {(id) => (
                <div class="shrink-0 flex items-center gap-2">
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
                            />
                          </Popover.Content>
                        </Popover.Portal>
                      </Popover>
                    )}
                  </Show>
                  <Show when={!parentID()}>
                    <Menu
                      gutter={6}
                      placement="bottom-end"
                      open={title.menuOpen}
                      onOpenChange={(open) => {
                        setTitle("menuOpen", open)
                        if (open) return
                      }}
                    >
                      <Menu.Trigger
                        as={IconButton}
                        icon={<Icon name="outline-dots" />}
                        variant="ghost-muted"
                        size="large"
                        state={share.open || title.pendingShare ? "pressed" : undefined}
                        aria-label={language.t("common.moreOptions")}
                        aria-expanded={title.menuOpen || share.open || title.pendingShare}
                        ref={(el: HTMLButtonElement) => {
                          more = el
                        }}
                      />
                      <Menu.Portal>
                        <Menu.Content
                          style={{ width: "120px", "min-width": "120px" }}
                          onCloseAutoFocus={(event) => {
                            if (title.pendingRename) {
                              event.preventDefault()
                              setTitle("pendingRename", false)
                              openTitleEditor()
                              return
                            }
                            if (title.pendingShare) {
                              event.preventDefault()
                              requestAnimationFrame(() => {
                                setShare({ open: true, dismiss: null })
                                setTitle("pendingShare", false)
                              })
                            }
                          }}
                        >
                          <Menu.Item
                            onSelect={() => {
                              setTitle("pendingRename", true)
                              setTitle("menuOpen", false)
                            }}
                          >
                            {language.t("common.rename")}
                          </Menu.Item>
                          <Show when={shareEnabled()}>
                            <Menu.Item
                              onSelect={() => {
                                setTitle({ pendingShare: true, menuOpen: false })
                              }}
                            >
                              {language.t("session.share.action.share")}...
                            </Menu.Item>
                          </Show>
                          <Menu.Item onSelect={() => void props.action.export(id)}>
                            {language.t("common.export")}...
                          </Menu.Item>
                          {/* TODO: Need a V2 session archive API. */}
                          <Menu.Separator />
                          <Menu.Item onSelect={() => props.action.showDelete(id)}>
                            {language.t("common.delete")}...
                          </Menu.Item>
                        </Menu.Content>
                      </Menu.Portal>
                    </Menu>

                    <Popover
                      open={share.open}
                      anchorRef={() => more}
                      placement="bottom-end"
                      gutter={6}
                      modal={false}
                      onOpenChange={(open) => {
                        if (open) setShare("dismiss", null)
                        setShare("open", open)
                      }}
                    >
                      <Popover.Portal>
                        <Popover.Content
                          data-component="popover-content"
                          class="flex w-80 max-w-none flex-col items-start gap-3 rounded-[10px] border-0 bg-v2-background-bg-layer-01 p-3 shadow-[var(--v2-elevation-floating)]"
                          style={{ "min-width": "320px" }}
                          onEscapeKeyDown={(event) => {
                            setShare({ dismiss: "escape", open: false })
                            event.preventDefault()
                            event.stopPropagation()
                          }}
                          onPointerDownOutside={() => {
                            setShare({ dismiss: "outside", open: false })
                          }}
                          onFocusOutside={() => {
                            setShare({ dismiss: "outside", open: false })
                          }}
                          onCloseAutoFocus={(event) => {
                            if (share.dismiss === "outside") event.preventDefault()
                            setShare("dismiss", null)
                          }}
                        >
                          <div class="flex w-full flex-col gap-1.5 px-0.5 pt-0.5">
                            <div class="select-none text-[13px] font-[530] leading-none tracking-[-0.04px] text-v2-text-text-base [font-variation-settings:'slnt'_0]">
                              {language.t("session.share.popover.title")}
                            </div>
                            <div class="select-none text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-muted [font-variation-settings:'slnt'_0]">
                              {shareUrl()
                                ? language.t("session.share.popover.description.shared")
                                : language.t("session.share.popover.description.unshared")}
                            </div>
                          </div>
                          <div class="flex w-full flex-col gap-2">
                            <Show
                              when={shareUrl()}
                              fallback={
                                <Button
                                  variant="contrast"
                                  class="w-full"
                                  onClick={() => void props.action.share()}
                                  disabled={props.pending.share()}
                                >
                                  {props.pending.share()
                                    ? language.t("session.share.action.publishing")
                                    : language.t("session.share.action.publish")}
                                </Button>
                              }
                            >
                              <div class="flex flex-col gap-2">
                                <div
                                  class="flex h-8 w-full items-center gap-1.5 rounded-[6px] py-1 pl-2.5 pr-1.5 shadow-[var(--v2-elevation-button-neutral)]"
                                  style={{
                                    background:
                                      "linear-gradient(180deg, var(--v2-alpha-light-2) 0%, var(--v2-alpha-light-0) 100%), var(--v2-background-bg-button-neutral)",
                                  }}
                                >
                                  <div
                                    class="min-w-0 flex-1 truncate select-text cursor-text text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-base [font-variation-settings:'slnt'_0]"
                                    onClick={selectShareUrlText}
                                  >
                                    {shareUrl()}
                                  </div>
                                  <IconButton
                                    type="button"
                                    size="small"
                                    variant="ghost-muted"
                                    icon={<Icon name="outline-copy" />}
                                    aria-label={language.t("session.share.copy.copyLink")}
                                    onClick={() => void props.action.copyShareUrl()}
                                  />
                                  <IconButton
                                    type="button"
                                    size="small"
                                    variant="ghost-muted"
                                    icon={<Icon name="outline-square-arrow" />}
                                    aria-label={language.t("session.share.action.view")}
                                    onClick={props.action.viewShare}
                                    disabled={props.pending.unshare()}
                                  />
                                </div>
                                <div class="flex w-full">
                                  <Button
                                    variant="outline"
                                    class="w-full"
                                    onClick={() => void props.action.unshare()}
                                    disabled={props.pending.unshare()}
                                  >
                                    {props.pending.unshare()
                                      ? language.t("session.share.action.unpublishing")
                                      : language.t("session.share.action.unpublish")}
                                  </Button>
                                </div>
                              </div>
                            </Show>
                          </div>
                        </Popover.Content>
                      </Popover.Portal>
                    </Popover>
                  </Show>
                </div>
              )}
            </Show>
          </div>
        </div>
      }
    />
  )
}
