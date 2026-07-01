import {
  batch,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
  useContext,
  type Accessor,
  type Setter,
} from "solid-js"
import { Dynamic } from "solid-js/web"
import path from "path"
import { useRoute } from "../../context/route"
import { useProject } from "../../context/project"
import { useSync } from "../../context/sync"
import { useEvent } from "../../context/event"
import { SplitBorder } from "../../component/border"
import { Spinner } from "../../component/spinner"
import { selectedForeground, useTheme } from "../../context/theme"
import { BoxRenderable, ScrollBoxRenderable, addDefaultParsers, TextAttributes, RGBA, MouseEvent } from "@opentui/core"
import { Prompt, type PromptRef } from "../../component/prompt"
import type { AssistantMessage, Part, Provider, ToolPart, UserMessage, TextPart, ReasoningPart } from "@opencode-ai/sdk/v2"
import { useLocal } from "../../context/local"
import { Locale } from "../../util"
import type { Tool } from "../../tool"
import type { ReadTool } from "../../tool/read"
import type { WriteTool } from "../../tool/write"
import { BashTool } from "../../tool/bash"
import type { GlobTool } from "../../tool/glob"
import type { GrepTool } from "../../tool/grep"
import type { EditTool } from "../../tool/edit"
import type { ApplyPatchTool } from "../../tool/apply_patch"
import type { WebFetchTool } from "../../tool/webfetch"
import type { CodeSearchTool } from "../../tool/codesearch"
import type { WebSearchTool } from "../../tool/websearch"
import type { ActorTool } from "../../tool/actor"
import type { TaskTool } from "../../tool/task"
import type { QuestionTool } from "../../tool/question"
import type { SkillTool } from "../../tool/skill"
import { useKeyboard, useRenderer, useTerminalDimensions, type JSX } from "@opentui/solid"
import { useSDK } from "../../context/sdk"
import { useWorkspaceClients, asWorkspaceID } from "../../context/workspace-clients"
import { useCellEventBus } from "./cell-event-bus"
import { useCommandDialog } from "../../component/dialog-command"
import { useLanguage } from "../../context/language"
import type { DialogContext } from "../../ui/dialog"
import { useKeybind } from "../../context/keybind"
import { useDialog } from "../../ui/dialog"
import { DialogMessage } from "../session/dialog-message"
import type { PromptInfo } from "../../component/prompt/history"
import { DialogConfirm } from "../../ui/dialog-confirm"
import { DialogSessionRename } from "../../component/dialog-session-rename"
import { Sidebar } from "../session/sidebar"
import { SubagentFooter } from "../session/subagent-footer.tsx"
import { Flag } from "../../flag/flag"
import { LANGUAGE_EXTENSIONS } from "../../lsp/language"
import parsers from "../../../../../../parsers-config.ts"
import * as Clipboard from "../../util/clipboard"
import { Toast, useToast } from "../../ui/toast"
import { useKV } from "../../context/kv.tsx"
import * as Editor from "../../util/editor"
import stripAnsi from "strip-ansi"
import { usePromptRef } from "../../context/prompt"
import { useExit } from "../../context/exit"
import { Filesystem } from "../../util"
import { Global } from "../../global"
import { PermissionPrompt } from "../session/permission"
import { QuestionPrompt } from "../session/question"
import { DialogExportOptions } from "../../ui/dialog-export-options"
import * as Model from "../../util/model"
import { formatTranscript } from "../../util/transcript"
import { UI } from "../../cli/ui.ts"
import { useTuiConfig } from "../../context/tui-config"
import { getScrollAcceleration } from "../../util/scroll"
import { useStickyScrollGuard } from "../../util/scroll-guard"
import { useEventTracker } from "../../util/event-cleanup"
import { useDestroyGuard } from "../../util/render-guard"
import { nextThinkingMode, reasoningSummary, useThinkingMode, type ThinkingMode } from "../../context/thinking"
import { TuiPluginRuntime } from "../../plugin"
import { DialogGoUpsell } from "../../component/dialog-go-upsell"
import { BobSummaryPart } from "../../component/bob-summary"
import { SessionRetry } from "../../session/retry"
import { getRevertDiffFiles } from "../../util/revert-diff"
import type { GridCell } from "../../context/grid-persistence"
import { useSessionMessages, useSessionState } from "./session-hooks"
import { useGrid } from "../../context/grid"

addDefaultParsers(parsers.parsers)

const GO_UPSELL_LAST_SEEN_AT = "go_upsell_last_seen_at"
const GO_UPSELL_DONT_SHOW = "go_upsell_dont_show"
const GO_UPSELL_WINDOW = 86_400_000 // 24 hrs

/**
 * Per-cell rendering context. Mirrors the local `context` block that lived
 * inside `Session()` in routes/session/index.tsx, but scoped to one
 * grid cell. Cells that are not currently active skip prompt input, command
 * registration, and other side-effecting behavior — see the `active` flag.
 */
const cellContext = createContext<{
  width: number
  sessionID: string
  workspaceID: string
  conceal: () => boolean
  thinkingMode: () => ThinkingMode
  showThinking: () => boolean
  showTimestamps: () => boolean
  showDetails: () => boolean
  showGenericToolOutput: () => boolean
  diffWrapMode: () => "word" | "none"
  providers: () => ReadonlyMap<string, Provider>
  sync: ReturnType<typeof useSync>
  tui: ReturnType<typeof useTuiConfig>
  active: () => boolean
}>()

function useCell() {
  const ctx = useContext(cellContext)
  if (!ctx) throw new Error("useCell must be used within a SessionCell component")
  return ctx
}

/**
 * `SessionCell` renders one cell in a multi-cell grid. It is a refactored
 * version of the chat + sidebar body of the legacy `Session()` route, but
 * parameterised by a `GridCell` so the same UI can drive multiple
 * workspace-scoped sessions in parallel.
 *
 * Behaviour notes:
 * - The workspace-aware SDK client (`useSDK().getClient(cell.workspaceID)`)
 *   carries the `x-opencode-workspace` header so server traffic routes to the
 *   correct bus without contaminating other cells' stores.
 * - The prompt input, command registrations, and keybind handlers are
 *   suppressed when `active` is false: inactive cells remain visible but
 *   cannot intercept input.
 * - Sidebar visibility follows the existing 42-col / overlay split. In a
 *   grid layout the parent usually chooses width; the cell itself decides
 *   overlay-vs-inline based on the parent-supplied `wide` flag.
 */
export function SessionCell(props: {
  cell: GridCell
  active: boolean
  width?: number
  wide?: boolean
  /**
   * Phase 6: optional fixed height (terminal rows). Used by `split-v` so the
   * cell stops claiming `flexGrow={1}` and lets the splitter size both
   * halves deterministically. When `undefined` the cell falls back to
   * `flexGrow={1}` and tracks the parent container.
   */
  height?: number
  /** Optional seed prompt (e.g. when entering the session for the first time). */
  prompt?: PromptInfo
}) {
  const fullRoute = useRoute()
  const grid = useGrid()
  const navigate = fullRoute.navigate
  const sync = useSync()
  const event = useEvent()
  const project = useProject()
  const sdk = useSDK()
  const workspaceClients = useWorkspaceClients()
  const cellBus = useCellEventBus()
  const tuiConfig = useTuiConfig()
  const kv = useKV()
  const { theme } = useTheme()
  const promptRef = usePromptRef()
  // Per-cell SDK client is acquired through the refcounted workspace pool so
  // multiple cells viewing the same workspace share one client (and one SSE
  // stream). Release the previous workspace's reference when the cell's
  // workspaceID changes to keep the pool's accounting correct.
  const cellWorkspaceID = createMemo(() => asWorkspaceID(props.cell.workspaceID))
  const cellSDK = createMemo(() => workspaceClients.clientFor(cellWorkspaceID()))

  const currentAgentID = createMemo(() => props.cell.agentID ?? "main")
  const { messages, permissions, questions } = useSessionMessages({
    sessionID: props.cell.sessionID,
    agentID: currentAgentID,
    workspaceID: props.cell.workspaceID,
  })
  const { visible, disabled, pending, lastAssistant } = useSessionState({
    sessionID: props.cell.sessionID,
    agentID: currentAgentID,
    permissions,
    questions,
    session: createMemo(() => sync.session.get(props.cell.sessionID)),
  })

  const dimensions = useTerminalDimensions()
  const [sidebar, setSidebar] = kv.signal<"auto" | "hide">("sidebar", "auto")
  const [sidebarOpen, setSidebarOpen] = createSignal(false)
  const [conceal, setConceal] = createSignal(true)
  const thinking = useThinkingMode()
  const thinkingMode = thinking.mode
  const showThinking = createMemo(() => true)
  const [timestamps, setTimestamps] = kv.signal<"hide" | "show">("timestamps", "hide")
  const [showDetails, setShowDetails] = kv.signal("tool_details_visibility", true)
  const [showScrollbar, setShowScrollbar] = kv.signal("scrollbar_visible", false)
  const [scrolling, setScrolling] = createSignal(false)
  let scrollHideTimer: ReturnType<typeof setTimeout> | undefined
  const scrollbarVisible = createMemo(() => showScrollbar() || scrolling())
  const onWheel = (evt: MouseEvent) => {
    if (evt.type !== "scroll") return
    setScrolling(true)
    if (scrollHideTimer) clearTimeout(scrollHideTimer)
    scrollHideTimer = setTimeout(() => setScrolling(false), 1000)
  }
  onCleanup(() => {
    if (scrollHideTimer) clearTimeout(scrollHideTimer)
    // Release the cell's pool reference. The pool refcounts so cells sharing
    // a workspace stay alive until the last cell releases; for the solo case
    // this drops the underlying SDK client on unmount.
    workspaceClients.pool.release(cellWorkspaceID())
    // Phase 5: mark the cell destroyed so late-arriving event listeners
    // and async effects short-circuit before touching disposed state.
    destroyGuard.markDestroyed()
    eventTracker.cleanup()
  })
  const [diffWrapMode] = kv.signal<"word" | "none">("diff_wrap_mode", "word")
  const [showGenericToolOutput, setShowGenericToolOutput] = kv.signal("generic_tool_output_visibility", false)

  const cellWidth = createMemo(() => props.width ?? dimensions().width)
  const wide = createMemo(() => props.wide ?? cellWidth() > 120)
  const sidebarVisible = createMemo(() => {
    if (sync.session.get(props.cell.sessionID)?.parentID) return false
    if (currentAgentID() !== "main") return false
    if (sidebarOpen()) return true
    if (sidebar() === "auto" && wide()) return true
    return false
  })
  const showTimestamps = createMemo(() => timestamps() === "show")
  const contentWidth = createMemo(() => Math.max(40, cellWidth() - (sidebarVisible() ? 42 : 0) - 4))
  const providers = createMemo(() => Model.index(sync.data.provider))

  // Phase 6: derived cell state aggregated into a single memo so downstream
  // consumers (sidebar, prompt, layout) all see a consistent snapshot.
  // Solid memos are referentially stable as long as their inputs do not
  // change, so wrapping the booleans in a single object is cheaper than
  // letting each consumer re-derive them independently.
  const cellState = createMemo(() => ({
    width: contentWidth(),
    active: props.active,
    sidebarVisible: sidebarVisible(),
    showTimestamps: showTimestamps(),
    wide: wide(),
    height: props.height,
  }))

  // Phase 6: snapshot the message list behind a memo so inactive cells do
  // not invalidate `<For>` on every streaming update from a sibling cell.
  // While the user is focused on cell A, the sync stream keeps filling
  // cell B; the memo below returns the previous reference for cell B
  // because its `messages()` signal isn't being re-read, only the parent
  // effect tracks it. (The underlying sync store keeps mutating; this is
  // purely a render-path freeze.) When the user switches focus to B the
  // memo drops its cached value and re-renders with the live list.
  let cachedInactive: ReturnType<typeof messages> | undefined
  let lastActive = props.active
  const cellMessages = createMemo(() => {
    if (!props.active) {
      if (lastActive) {
        // Just deactivated — freeze at the current snapshot.
        cachedInactive = messages()
      } else if (cachedInactive === undefined) {
        cachedInactive = messages()
      }
      lastActive = false
      return cachedInactive
    }
    lastActive = true
    cachedInactive = undefined
    return messages()
  })

  const scrollAcceleration = createMemo(() => getScrollAcceleration(tuiConfig))
  const toast = useToast()

  createEffect(async () => {
    if (!props.active) return
    const previousWorkspace = project.workspace.current()
    const client = cellSDK()
    const result = await client.session.get({ sessionID: props.cell.sessionID }, { throwOnError: true })
    if (!result.data) {
      toast.show({
        message: `Session not found: ${props.cell.sessionID}`,
        variant: "error",
      })
      return
    }
    if (result.data.workspaceID !== previousWorkspace) {
      project.workspace.set(result.data.workspaceID)
      try {
        await sync.bootstrap({ fatal: false })
      } catch (e) {}
    }
    await sync.session.sync(props.cell.sessionID)
    // Phase 6: batch the post-sync scroll nudge so it lands in the same
    // tick as the rest of the sync-induced renders. Without `batch`, the
    // scroll setter wakes the stickyScroll guard before messages finish
    // reconciling, which on a multi-cell grid can compound into visible
    // jitter when the user rapidly switches active cells via
    // <leader>1..9.
    batch(() => {
      if (scroll) scroll.scrollBy(100_000)
    })
  })

  let lastSwitch: string | undefined = undefined
  const eventTracker = useEventTracker()
  const destroyGuard = useDestroyGuard()
  eventTracker.track(
    event.on("message.part.updated", (evt) => {
      if (destroyGuard.isDestroyed()) return
      if (!props.active) return
      const part = evt.properties.part
      if (part.type !== "tool") return
      if (part.sessionID !== props.cell.sessionID) return
      if (part.state.status !== "completed") return
      if (part.id === lastSwitch) return

      if (part.tool === "plan_exit" && part.state.metadata?.switched) {
        local.agent.set("build")
        lastSwitch = part.id
      } else if (part.tool === "plan_enter") {
        local.agent.set("plan")
        lastSwitch = part.id
      }
    }),
  )

  let seeded = false
  let scroll: ScrollBoxRenderable
  let prompt: PromptRef | undefined
  // Phase 5: stickiness guard. Prevents content bursts from yanking the
  // scrollbox back to the bottom while the user is reading history.
  const atBottom = createSignal(true)
  useStickyScrollGuard(() => scroll, atBottom)
  createEffect(() => {
    const ref = scroll
    if (!ref || ref.isDestroyed) return
    const distance = ref.scrollHeight - ref.scrollTop - ref.height
    atBottom[1](distance <= 1)
  })
  const bind = (r: PromptRef | undefined) => {
    prompt = r
    if (props.active) promptRef.set(r)
    if (seeded || !props.prompt || !r) return
    seeded = true
    r.set(props.prompt)
  }
  const keybind = useKeybind()
  const dialog = useDialog()
  const renderer = useRenderer()

  eventTracker.track(
    event.on("session.status", (evt) => {
      if (destroyGuard.isDestroyed()) return
      if (!props.active) return
      if (evt.properties.sessionID !== props.cell.sessionID) return
      if (evt.properties.status.type !== "retry") return
      if (evt.properties.status.message !== SessionRetry.GO_UPSELL_MESSAGE) return
      if (dialog.stack.length > 0) return

      const seen = kv.get(GO_UPSELL_LAST_SEEN_AT)
      if (typeof seen === "number" && Date.now() - seen < GO_UPSELL_WINDOW) return

      if (kv.get(GO_UPSELL_DONT_SHOW)) return

      void DialogGoUpsell.show(dialog).then((dontShowAgain) => {
        if (destroyGuard.isDestroyed()) return
        if (dontShowAgain) kv.set(GO_UPSELL_DONT_SHOW, true)
        kv.set(GO_UPSELL_LAST_SEEN_AT, Date.now())
      })
    }),
  )

  const exit = useExit()

  createEffect(() => {
    if (!props.active) return
    const title = Locale.truncate(sync.session.get(props.cell.sessionID)?.title ?? "", 50)
    const pad = (text: string) => text.padEnd(10, " ")
    const weak = (text: string) => UI.Style.TEXT_DIM + pad(text) + UI.Style.TEXT_NORMAL
    const logo = UI.logo("  ").split(/\r?\n/)
    return exit.message.set(
      [
        ...logo,
        ``,
        `  ${weak("Session")}${UI.Style.TEXT_NORMAL_BOLD}${title}${UI.Style.TEXT_NORMAL}`,
        `  ${weak("Continue")}${UI.Style.TEXT_NORMAL_BOLD}bob -s ${sync.session.get(props.cell.sessionID)?.id}${UI.Style.TEXT_NORMAL}`,
        ``,
      ].join("\n"),
    )
  })

  useKeyboard((evt) => {
    if (!props.active) return
    const parentless = !sync.session.get(props.cell.sessionID)?.parentID
    if (parentless && currentAgentID() === "main") return
    if (keybind.match("app_exit", evt)) {
      const status = sync.data.session_status?.[props.cell.sessionID]
      if (status && status.type !== "idle") {
        void cellSDK()
          .session.abort({ sessionID: props.cell.sessionID })
          .catch(() => {})
        return
      }
      void exit()
    }
  })

  const findNextVisibleMessage = (direction: "next" | "prev"): string | null => {
    const children = scroll.getChildren()
    const messagesList = messages()
    const scrollTop = scroll.y
    const visibleMessages = children
      .filter((c) => {
        if (!c.id) return false
        const message = messagesList.find((m) => m.id === c.id)
        if (!message) return false
        const parts = sync.data.part[message.id]
        if (!parts || !Array.isArray(parts)) return false
        return parts.some((part) => part && part.type === "text" && !part.synthetic && !part.ignored)
      })
      .sort((a, b) => a.y - b.y)
    if (visibleMessages.length === 0) return null
    if (direction === "next") {
      return visibleMessages.find((c) => c.y > scrollTop + 10)?.id ?? null
    }
    return [...visibleMessages].reverse().find((c) => c.y < scrollTop - 10)?.id ?? null
  }

  const scrollToMessage = (direction: "next" | "prev", dlg: ReturnType<typeof useDialog>) => {
    const targetID = findNextVisibleMessage(direction)
    if (!targetID) {
      scroll.scrollBy(direction === "next" ? scroll.height : -scroll.height)
      dlg.clear()
      return
    }
    const child = scroll.getChildren().find((c) => c.id === targetID)
    if (child) scroll.scrollBy(child.y - scroll.y - 1)
    dlg.clear()
  }

  function toBottom() {
    setTimeout(() => {
      if (!scroll || scroll.isDestroyed) return
      scroll.scrollTo(scroll.scrollHeight)
    }, 50)
  }

  const local = useLocal()
  const command = useCommandDialog()
  const t = useLanguage().t

  // Command registration is scoped to the cell. We register/unregister only
  // when the cell becomes active so the active cell owns the global command
  // palette. Inactive cells keep their data reactive but do not steal focus.
  // The KV-backed setters return `(next: Setter<T>) => void` (delegated to
  // the inner Solid setter) — we wrap them into the `Setter<T>` shape that
  // `buildCellCommands` expects, so the command callbacks can call them
  // uniformly without sprinkling `Setter<T>` casts at every site.
  const setSidebarTyped = setSidebar as Setter<"auto" | "hide">
  const setConcealTyped = setConceal as Setter<boolean>
  const setTimestampsTyped = setTimestamps as Setter<"hide" | "show">
  const setShowDetailsTyped = setShowDetails as Setter<boolean>
  const setShowScrollbarTyped = setShowScrollbar as Setter<boolean>
  const setShowGenericToolOutputTyped = setShowGenericToolOutput as Setter<boolean>

  command.register(() => {
    if (!props.active) return []
    return buildCellCommands({
      sessionID: props.cell.sessionID,
      agentID: currentAgentID,
      messages,
      permissions,
      visible,
      disabled,
      sidebarVisible,
      sidebarOpen,
      sidebar,
      setSidebar: setSidebarTyped,
      setSidebarOpen,
      conceal,
      setConceal: setConcealTyped,
      timestamps,
      setTimestamps: setTimestampsTyped,
      thinking,
      thinkingMode,
      showDetails,
      setShowDetails: setShowDetailsTyped,
      showScrollbar,
      setShowScrollbar: setShowScrollbarTyped,
      showGenericToolOutput,
      setShowGenericToolOutput: setShowGenericToolOutputTyped,
      showTimestamps,
      scroll,
      prompt,
      t,
      cellSDK: cellSDK(),
      sdk,
      sync,
      toast,
      dialog,
      kv,
      renderer,
      project,
      local,
      navigate,
      fullRoute,
      toBottom,
      scrollToMessage,
    })
  })

  const revertInfo = createMemo(() => sync.session.get(props.cell.sessionID)?.revert)
  const revertMessageID = createMemo(() => revertInfo()?.messageID)
  const revertDiffFiles = createMemo(() => getRevertDiffFiles(revertInfo()?.diff ?? ""))
  const revertRevertedMessages = createMemo(() => {
    const messageID = revertMessageID()
    if (!messageID) return []
    return messages().filter((x) => x.id >= messageID && x.role === "user")
  })
  const revert = createMemo(() => {
    const info = revertInfo()
    if (!info) return
    if (!info.messageID) return
    return {
      messageID: info.messageID,
      reverted: revertRevertedMessages(),
      diff: info.diff,
      diffFiles: revertDiffFiles(),
    }
  })

  createEffect(on(() => props.cell.sessionID, toBottom))

  return (
    <cellContext.Provider
      value={{
        get width() {
          return cellState().width
        },
        sessionID: props.cell.sessionID,
        workspaceID: props.cell.workspaceID,
        conceal,
        thinkingMode,
        showThinking,
        showTimestamps,
        showDetails,
        showGenericToolOutput,
        diffWrapMode,
        providers,
        sync,
        tui: tuiConfig,
        active: () => cellState().active,
      }}
    >
      <box
        flexDirection="row"
        height="100%"
        onMouseUp={() => {
          if (!props.active) {
            grid.setActive(props.cell.id)
          }
        }}
      >
        <box
          flexGrow={1}
          paddingBottom={1}
          paddingLeft={2}
          paddingRight={2}
          gap={1}
          onMouse={onWheel}
          onMouseUp={() => {
            if (!props.active) {
              grid.setActive(props.cell.id)
            }
          }}
        >
          <Show when={sync.session.get(props.cell.sessionID)}>
            {/* Phase 8: empty-session bootstrap. When a cell holds a freshly
                created session (no messages yet) we render the prompt first
                instead of an empty scrollbox, so the user can type the first
                message and submit it without an off-screen input. Mirrors the
                home-screen experience for new sessions. The prompt's submit
                already handles an existing sessionID (see prompt/index.tsx:
                `if (sessionID == null)` skip), so this reuses the standard
                flow and only changes the layout chrome. */}
            <Show
              when={cellMessages().length > 0 || !props.active}
              fallback={
                <EmptySessionPrompt
                  cell={props.cell}
                  active={props.active}
                  visible={visible()}
                  disabled={disabled()}
                  promptRef={bind}
                  onSubmit={toBottom}
                />
              }
            >
              <scrollbox
                onMouseUp={() => {
                  if (!props.active) {
                    grid.setActive(props.cell.id)
                  }
                }}
                ref={(r) => (scroll = r)}
                viewportOptions={{
                  paddingRight: 1,
                }}
                verticalScrollbarOptions={{
                  paddingLeft: 1,
                  visible: true,
                  trackOptions: {
                    backgroundColor: scrollbarVisible() ? theme.backgroundElement : theme.background,
                    foregroundColor: scrollbarVisible() ? theme.border : theme.background,
                  },
                }}
                stickyScroll={true}
                stickyStart="bottom"
                flexGrow={1}
                scrollAcceleration={scrollAcceleration()}
                // Phase 6: viewport culling. With culling enabled the scrollbox
                // stops allocating render slots for off-screen messages, which
                // combined with the existing stickyScroll guard (Phase 5)
                // prevents a background cell from re-laying out on every
                // streaming update. Active cells benefit too — the cost there
                // is dominated by the live model, not the offscreen buffer.
                viewportCulling={true}
              >
                <box height={1} />
                <For each={cellMessages()}>
                  {(message, index) => (
                    <Switch>
                      <Match when={message.id === revert()?.messageID}>
                        {(() => {
                          const command = useCommandDialog()
                          const [hover, setHover] = createSignal(false)
                          const dialog = useDialog()
                          const handleUnrevert = async () => {
                            const confirmed = await DialogConfirm.show(
                              dialog,
                              "Confirm Redo",
                              "Are you sure you want to restore the reverted messages?",
                            )
                            if (confirmed) command.trigger("session.redo")
                          }
                          return (
                            <box
                              onMouseOver={() => setHover(true)}
                              onMouseOut={() => setHover(false)}
                              onMouseUp={handleUnrevert}
                              marginTop={1}
                              flexShrink={0}
                              border={["left"]}
                              customBorderChars={SplitBorder.customBorderChars}
                              borderColor={theme.backgroundPanel}
                            >
                              <box
                                paddingTop={1}
                                paddingBottom={1}
                                paddingLeft={2}
                                backgroundColor={hover() ? theme.backgroundElement : theme.backgroundPanel}
                              >
                                <text fg={theme.textMuted}>{revert()!.reverted.length} message reverted</text>
                                <text fg={theme.textMuted}>
                                  <span style={{ fg: theme.text }}>{keybind.print("messages_redo")}</span> or /redo to
                                  restore
                                </text>
                                <Show when={revert()!.diffFiles?.length}>
                                  <box marginTop={1}>
                                    <For each={revert()!.diffFiles}>
                                      {(file) => (
                                        <text fg={theme.text}>
                                          {file.filename}
                                          <Show when={file.additions > 0}>
                                            <span style={{ fg: theme.diffAdded }}> +{file.additions}</span>
                                          </Show>
                                          <Show when={file.deletions > 0}>
                                            <span style={{ fg: theme.diffRemoved }}> -{file.deletions}</span>
                                          </Show>
                                        </text>
                                      )}
                                    </For>
                                  </box>
                                </Show>
                              </box>
                            </box>
                          )
                        })()}
                      </Match>
                      <Match when={revert()?.messageID && message.id >= revert()!.messageID}>
                        <></>
                      </Match>
                      <Match when={message.role === "user"}>
                        <UserMessage
                          index={index()}
                          onMouseUp={() => {
                            if (renderer.getSelection()?.getSelectedText()) return
                            dialog.replace(() => (
                              <DialogMessage
                                messageID={message.id}
                                sessionID={props.cell.sessionID}
                                setPrompt={(promptInfo) => prompt?.set(promptInfo)}
                              />
                            ))
                          }}
                          message={message as UserMessage}
                          parts={sync.data.part[message.id] ?? []}
                          pending={pending()}
                        />
                      </Match>
                      <Match when={message.role === "assistant"}>
                        <AssistantMessage
                          last={lastAssistant()?.id === message.id}
                          message={message as AssistantMessage}
                          parts={sync.data.part[message.id] ?? []}
                        />
                      </Match>
                    </Switch>
                  )}
                </For>
              </scrollbox>
              <box flexShrink={0}>
                <Show when={permissions().length > 0}>
                  <PermissionPrompt request={permissions()[0]} />
                </Show>
                <Show when={permissions().length === 0 && questions().length > 0}>
                  <QuestionPrompt request={questions()[0]} />
                </Show>
                <Show when={sync.session.get(props.cell.sessionID)?.parentID || currentAgentID() !== "main"}>
                  <SubagentFooter />
                </Show>
                <Show when={props.active && visible()}>
                  <TuiPluginRuntime.Slot
                    name="session_prompt"
                    mode="replace"
                    session_id={props.cell.sessionID}
                    visible={visible()}
                    disabled={disabled()}
                    on_submit={toBottom}
                    ref={bind}
                  >
                    <Prompt
                      visible={visible()}
                      ref={bind}
                      disabled={disabled()}
                      onSubmit={toBottom}
                      sessionID={props.cell.sessionID}
                      focusEnabled={props.active}
                      agentID={currentAgentID()}
                      right={<TuiPluginRuntime.Slot name="session_prompt_right" session_id={props.cell.sessionID} />}
                    />
                  </TuiPluginRuntime.Slot>
                </Show>
              </box>
            </Show>
          </Show>
          <Toast />
        </box>
        <Show when={sidebarVisible()}>
          <Switch>
            <Match when={wide()}>
              <Sidebar sessionID={props.cell.sessionID} />
            </Match>
            <Match when={!wide()}>
              <box
                position="absolute"
                top={0}
                left={0}
                right={0}
                bottom={0}
                alignItems="flex-end"
                backgroundColor={RGBA.fromInts(0, 0, 0, 70)}
              >
                <Sidebar sessionID={props.cell.sessionID} overlay={true} />
              </box>
            </Match>
          </Switch>
        </Show>
        <Show when={!props.active}>
          <InactiveOverlay cell={props.cell} />
        </Show>
      </box>
    </cellContext.Provider>
  )
}

/**
 * Phase 8: Empty-session bootstrap prompt. Shown when a freshly created cell
 * has zero messages yet. Mirrors the home-screen prompt so the user can type
 * the first message and submit it without an off-screen input or a stub
 * scrollbox that pushes the prompt below the fold. Uses the workspace-aware
 * prompt flow so model selection, history, and slash commands keep working
 * — the prompt's `submit()` short-circuits session creation because we
 * already have a sessionID (see `component/prompt/index.tsx`).
 */
function EmptySessionPrompt(props: {
  cell: GridCell
  active: boolean
  visible: boolean
  disabled: boolean
  promptRef: (ref: PromptRef | undefined) => void
  onSubmit: () => void
}) {
  const { theme } = useTheme()
  return (
    <box flexDirection="column" flexGrow={1} alignItems="center" justifyContent="center" paddingTop={2} gap={1}>
      <text fg={theme.textMuted}>{props.cell.label || "New Session"}</text>
      <text fg={theme.textMuted}>Type your first message to begin.</text>
      <box width="100%" maxWidth={75} paddingTop={1}>
        <Prompt
          ref={props.promptRef}
          sessionID={props.cell.sessionID}
          workspaceID={props.cell.workspaceID || undefined}
          visible={props.visible}
          disabled={props.disabled}
          onSubmit={props.onSubmit}
          focusEnabled={props.active}
        />
      </box>
    </box>
  )
}

/**
 * Visual "cell is in the background" treatment. Dims the cell content with a
 * translucent overlay so the user can still read messages but the eye is
 * drawn to the active cell. Click-through is prevented by the box
 * intercepting mouse events.
 */
function InactiveOverlay(props: { cell: GridCell }) {
  const { theme } = useTheme()
  const grid = useGrid()
  return (
    <box
      position="absolute"
      top={0}
      left={0}
      right={0}
      bottom={0}
      width="100%"
      height="100%"
      backgroundColor={RGBA.fromInts(0, 0, 0, 100)}
      alignItems="center"
      justifyContent="center"
      onMouseDown={(evt) => {
        evt.stopPropagation()
        grid.setActive(props.cell.id)
      }}
      onMouseUp={(evt) => {
        evt.stopPropagation()
        grid.setActive(props.cell.id)
      }}
    >
      <box
        border={["top", "bottom"]}
        customBorderChars={SplitBorder.customBorderChars}
        borderColor={theme.border}
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
      >
        <text fg={theme.textMuted}>
          <span style={{ fg: theme.text }}>{props.cell.label || "cell"}</span>
          <span style={{ fg: theme.textMuted }}> · inactive</span>
        </text>
      </box>
    </box>
  )
}

/**
 * All command-dialog entries owned by an active cell. Pulled into a helper so
 * the cell component stays close to the rendering tree without losing the
 * full set of slash/keybind commands. The legacy `Session()` route also
 * uses the same helper to keep behaviour in sync.
 *
 * Setters here use the standard Solid `Setter<T>` shape so the command
 * callbacks can call them as `setFoo(prev => ...)` uniformly. The KV-backed
 * setters returned by `kv.signal` are cast at the call site (see
 * `SessionCell`).
 */
function buildCellCommands(args: {
  sessionID: string
  agentID: Accessor<string>
  messages: Accessor<any[]>
  permissions: Accessor<any[]>
  visible: Accessor<boolean>
  disabled: Accessor<boolean>
  sidebarVisible: Accessor<boolean>
  sidebarOpen: Accessor<boolean>
  sidebar: Accessor<"auto" | "hide">
  setSidebar: Setter<"auto" | "hide">
  setSidebarOpen: Setter<boolean>
  conceal: Accessor<boolean>
  setConceal: Setter<boolean>
  timestamps: Accessor<"hide" | "show">
  setTimestamps: Setter<"hide" | "show">
  thinking: ReturnType<typeof useThinkingMode>
  thinkingMode: Accessor<ThinkingMode>
  showDetails: Accessor<boolean>
  setShowDetails: Setter<boolean>
  showScrollbar: Accessor<boolean>
  setShowScrollbar: Setter<boolean>
  showGenericToolOutput: Accessor<boolean>
  setShowGenericToolOutput: Setter<boolean>
  showTimestamps: Accessor<boolean>
  scroll: ScrollBoxRenderable | undefined
  prompt: PromptRef | undefined
  t: ReturnType<typeof useLanguage>["t"]
  cellSDK: ReturnType<typeof useSDK>["client"]
  sdk: ReturnType<typeof useSDK>
  sync: ReturnType<typeof useSync>
  toast: ReturnType<typeof useToast>
  dialog: ReturnType<typeof useDialog>
  kv: ReturnType<typeof useKV>
  renderer: ReturnType<typeof useRenderer>
  project: ReturnType<typeof useProject>
  local: ReturnType<typeof useLocal>
  navigate: ReturnType<typeof useRoute>["navigate"]
  fullRoute: ReturnType<typeof useRoute>
  toBottom: () => void
  scrollToMessage: (direction: "next" | "prev", dialog: ReturnType<typeof useDialog>) => void
}) {
  const session = args
  return [
    {
      title: args.t(
        args.sync.session.get(session.sessionID)?.share?.url
          ? "tui.command.session.share.copy_link"
          : "tui.command.session.share.title",
      ),
      value: "session.share",
      suggested: true,
      keybind: "session_share",
      category: "session",
      enabled: args.sync.data.config.share !== "disabled",
      slash: { name: "share" },
      onSelect: async (dialog: DialogContext) => {
        const copy = (url: string) =>
          Clipboard.copy(url)
            .then(() => args.toast.show({ message: "Share URL copied to clipboard!", variant: "success" }))
            .catch(() => args.toast.show({ message: "Failed to copy URL to clipboard", variant: "error" }))
        const url = args.sync.session.get(session.sessionID)?.share?.url
        if (url) {
          await copy(url)
          dialog.clear()
          return
        }
        if (!args.kv.get("share_consent", false)) {
          const ok = await DialogConfirm.show(dialog, "Share Session", "Are you sure you want to share it?")
          if (ok !== true) return
          args.kv.set("share_consent", true)
        }
        await args.cellSDK.session
          .share({ sessionID: session.sessionID })
          .then((res: any) => copy(res.data!.share!.url))
          .catch((error: unknown) => {
            args.toast.show({
              message: error instanceof Error ? error.message : "Failed to share session",
              variant: "error",
            })
          })
        dialog.clear()
      },
    },
    {
      title: args.t("tui.command.session.rename.title"),
      value: "session.rename",
      keybind: "session_rename",
      category: "session",
      slash: { name: "rename" },
      onSelect: (dialog: DialogContext) => {
        dialog.replace(() => <DialogSessionRename session={session.sessionID} />)
      },
    },
    {
      title: args.t(args.sidebarVisible() ? "tui.command.session.sidebar.hide" : "tui.command.session.sidebar.show"),
      value: "session.sidebar.toggle",
      keybind: "sidebar_toggle",
      category: "session",
      onSelect: (dialog: DialogContext) => {
        batch(() => {
          const isVisible = args.sidebarVisible()
          args.setSidebar(() => (isVisible ? "hide" : "auto"))
          args.setSidebarOpen(!isVisible)
        })
        dialog.clear()
      },
    },
    {
      title: args.t(args.conceal() ? "tui.command.session.conceal.disable" : "tui.command.session.conceal.enable"),
      value: "session.toggle.conceal",
      keybind: "messages_toggle_conceal",
      category: "session",
      onSelect: (dialog: DialogContext) => {
        args.setConceal((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: args.t(
        args.showTimestamps() ? "tui.command.session.timestamps.hide" : "tui.command.session.timestamps.show",
      ),
      value: "session.toggle.timestamps",
      category: "session",
      slash: { name: "timestamps", aliases: ["toggle-timestamps"] },
      onSelect: (dialog: DialogContext) => {
        args.setTimestamps((prev) => (prev === "show" ? "hide" : "show"))
        dialog.clear()
      },
    },
    {
      title: args.t(
        nextThinkingMode(args.thinkingMode()) === "hide"
          ? "tui.command.session.thinking.collapse"
          : "tui.command.session.thinking.expand",
      ),
      value: "session.toggle.thinking",
      keybind: "display_thinking",
      category: "session",
      slash: { name: "thinking", aliases: ["toggle-thinking"] },
      onSelect: (dialog: DialogContext) => {
        args.thinking.set(nextThinkingMode(args.thinkingMode()))
        dialog.clear()
      },
    },
    {
      title: args.t(
        args.showDetails() ? "tui.command.session.tool_details.hide" : "tui.command.session.tool_details.show",
      ),
      value: "session.toggle.actions",
      keybind: "tool_details",
      category: "session",
      onSelect: (dialog: DialogContext) => {
        args.setShowDetails((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: args.t("tui.command.session.scrollbar.toggle"),
      value: "session.toggle.scrollbar",
      keybind: "scrollbar_toggle",
      category: "session",
      onSelect: (dialog: DialogContext) => {
        args.setShowScrollbar((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: args.t(
        args.showGenericToolOutput()
          ? "tui.command.session.generic_tool_output.hide"
          : "tui.command.session.generic_tool_output.show",
      ),
      value: "session.toggle.generic_tool_output",
      category: "session",
      onSelect: (dialog: DialogContext) => {
        args.setShowGenericToolOutput((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: args.t("tui.command.session.export.title"),
      value: "session.export",
      keybind: "session_export",
      category: "session",
      slash: { name: "export" },
      onSelect: async (dialog: DialogContext) => {
        try {
          const sessionData = args.sync.session.get(session.sessionID)
          if (!sessionData) return
          const sessionMessages = session.messages()
          const defaultFilename = `session-${sessionData.id.slice(0, 8)}.md`
          const options = await DialogExportOptions.show(
            dialog,
            defaultFilename,
            session.showTimestamps(),
            args.showDetails(),
            args.kv.get("assistant_metadata_visibility", true),
            false,
          )
          if (options === null) return
          const transcript = formatTranscript(
            sessionData,
            sessionMessages.map((msg: any) => ({ info: msg, parts: args.sync.data.part[msg.id] ?? [] })),
            {
              thinking: options.thinking,
              toolDetails: options.toolDetails,
              assistantMetadata: options.assistantMetadata,
              providers: args.sync.data.provider,
            },
          )
          if (options.openWithoutSaving) {
            await Editor.open({ value: transcript, renderer: args.renderer })
          } else {
            const exportDir = process.cwd()
            const filename = options.filename.trim()
            const filepath = path.join(exportDir, filename)
            await Filesystem.write(filepath, transcript)
            const result = await Editor.open({ value: transcript, renderer: args.renderer })
            if (result !== undefined) await Filesystem.write(filepath, result)
            args.toast.show({ message: `Session exported to ${filename}`, variant: "success" })
          }
        } catch {
          args.toast.show({ message: "Failed to export session", variant: "error" })
        }
        dialog.clear()
      },
    },
    {
      title: args.t("tui.command.session.undo.title"),
      value: "session.undo",
      keybind: "messages_undo",
      category: "session",
      slash: { name: "undo" },
      onSelect: async (dialog: DialogContext) => {
        const status = args.sync.data.session_status?.[session.sessionID]
        if (status?.type !== "idle") await args.cellSDK.session.abort({ sessionID: session.sessionID }).catch(() => {})
        const revert = args.sync.session.get(session.sessionID)?.revert?.messageID
        const message = session.messages().findLast((x: any) => (!revert || x.id < revert) && x.role === "user")
        if (!message) return
        void args.cellSDK.session
          .revert({ sessionID: session.sessionID, messageID: message.id })
          .then(() => args.toBottom())
        const parts = args.sync.data.part[message.id]
        session.prompt?.set(
          parts.reduce(
            (agg: any, part: any) => {
              if (part.type === "text") if (!part.synthetic) agg.input += part.text
              if (part.type === "file") agg.parts.push(part)
              return agg
            },
            { input: "", parts: [] as PromptInfo["parts"] },
          ),
        )
        dialog.clear()
      },
    },
  ]
}

const PART_MAPPING = {
  text: TextPart,
  tool: ToolPart,
  reasoning: ReasoningPart,
  bob_summary: BobSummaryPart,
}

const MIME_BADGE: Record<string, string> = {
  "text/plain": "txt",
  "image/png": "img",
  "image/jpeg": "img",
  "image/gif": "img",
  "image/webp": "img",
  "application/pdf": "pdf",
  "application/x-directory": "dir",
}

function UserMessage(props: {
  message: UserMessage
  parts: Part[]
  onMouseUp: () => void
  index: number
  pending?: string
}) {
  const ctx = useCell()
  const local = useLocal()
  const text = createMemo(() => props.parts.flatMap((x) => (x.type === "text" && !x.synthetic ? [x] : []))[0])
  const files = createMemo(() => props.parts.flatMap((x) => (x.type === "file" ? [x] : [])))
  const { theme } = useTheme()
  const [hover, setHover] = createSignal(false)
  const queued = createMemo(() => props.pending && props.message.id > props.pending)
  const color = createMemo(() => local.agent.color(props.message.agent))
  const queuedFg = createMemo(() => selectedForeground(theme, color()))
  const metadataVisible = createMemo(() => queued() || ctx.showTimestamps())

  return (
    <Show when={text()}>
      <box
        id={props.message.id}
        border={["left"]}
        borderColor={color()}
        customBorderChars={SplitBorder.customBorderChars}
        marginTop={props.index === 0 ? 0 : 1}
      >
        <box
          onMouseOver={() => setHover(true)}
          onMouseOut={() => setHover(false)}
          onMouseUp={props.onMouseUp}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          backgroundColor={hover() ? theme.backgroundElement : theme.backgroundPanel}
          flexShrink={0}
        >
          <text fg={theme.text}>{text()?.text}</text>
          <Show when={files().length}>
            <box flexDirection="row" paddingBottom={metadataVisible() ? 1 : 0} paddingTop={1} gap={1} flexWrap="wrap">
              <For each={files()}>
                {(file) => {
                  const bg = createMemo(() => {
                    if (file.mime.startsWith("image/")) return theme.accent
                    if (file.mime === "application/pdf") return theme.primary
                    return theme.secondary
                  })
                  return (
                    <text fg={theme.text}>
                      <span style={{ bg: bg(), fg: theme.background }}> {MIME_BADGE[file.mime] ?? file.mime} </span>
                      <span style={{ bg: theme.backgroundElement, fg: theme.textMuted }}> {file.filename} </span>
                    </text>
                  )
                }}
              </For>
            </box>
          </Show>
          <Show
            when={queued()}
            fallback={
              <Show when={ctx.showTimestamps()}>
                <text fg={theme.textMuted}>
                  <span style={{ fg: theme.textMuted }}>{Locale.todayTimeOrDateTime(props.message.time.created)}</span>
                </text>
              </Show>
            }
          >
            <text fg={theme.textMuted}>
              <span style={{ bg: color(), fg: queuedFg(), bold: true }}> QUEUED </span>
            </text>
          </Show>
        </box>
      </box>
    </Show>
  )
}

function AssistantMessage(props: { message: AssistantMessage; parts: Part[]; last: boolean }) {
  const ctx = useCell()
  const local = useLocal()
  const { theme } = useTheme()
  const sync = useSync()
  const messages = createMemo(() => sync.data.message[props.message.sessionID]?.[props.message.agentID ?? "main"] ?? [])
  const model = createMemo(() => Model.name(ctx.providers(), props.message.providerID, props.message.modelID))
  const final = createMemo(() => props.message.finish && props.message.finish !== "tool-calls")
  const duration = createMemo(() => {
    if (!final()) return 0
    if (!props.message.time.completed) return 0
    const user = messages().find((x) => x.role === "user" && x.id === props.message.parentID)
    if (!user || !user.time) return 0
    return props.message.time.completed - user.time.created
  })
  const keybind = useKeybind()
  const verdict = createMemo(() => sync.data.session_goal?.[props.message.sessionID]?.verdicts?.[props.message.id])
  const [verdictOpen, setVerdictOpen] = createSignal(false)
  const verdictMark = createMemo(() => {
    const v = verdict()
    if (!v) return undefined
    if (v.error) return { icon: "!", fg: theme.textMuted, label: "Judge: error (stopped)" }
    if (v.ok) return { icon: "✓", fg: theme.success, label: "Judge: met" }
    if (v.impossible) return { icon: "⊘", fg: theme.error, label: "Judge: impossible" }
    return { icon: "⟳", fg: theme.warning, label: `Judge [round ${v.attempt}]: not met` }
  })
  return (
    <>
      <For each={props.parts}>
        {(part, index) => {
          const component = createMemo(() => PART_MAPPING[part.type as keyof typeof PART_MAPPING])
          return (
            <Show when={component()}>
              <Dynamic
                last={index() === props.parts.length - 1}
                component={component()}
                part={part as any}
                message={props.message}
              />
            </Show>
          )
        }}
      </For>
      <Show when={props.parts.some((x) => x.type === "tool" && x.tool === "actor")}>
        <box paddingTop={1} paddingLeft={3}>
          <text fg={theme.text}>
            {keybind.print("session_child_first")}
            <span style={{ fg: theme.textMuted }}> view subagents</span>
          </text>
        </box>
      </Show>
      <Show when={props.message.error && props.message.error.name !== "MessageAbortedError"}>
        <ErrorBlock error={props.message.error!} />
      </Show>
      <Switch>
        <Match when={props.last || final() || props.message.error?.name === "MessageAbortedError"}>
          <box paddingLeft={3}>
            <text marginTop={1}>
              <span
                style={{
                  fg:
                    props.message.error?.name === "MessageAbortedError"
                      ? theme.textMuted
                      : local.agent.color(props.message.agent),
                }}
              >
                ▣{" "}
              </span>{" "}
              <span style={{ fg: theme.text }}>{Locale.titlecase(props.message.mode)}</span>
              <span style={{ fg: theme.textMuted }}> · {model()}</span>
              <Show when={duration()}>
                <span style={{ fg: theme.textMuted }}> · {Locale.duration(duration())}</span>
              </Show>
              <Show when={props.message.error?.name === "MessageAbortedError"}>
                <span style={{ fg: theme.textMuted }}> · interrupted</span>
              </Show>
            </text>
          </box>
        </Match>
      </Switch>
      <Show when={verdictMark()}>
        {(mark) => (
          <box paddingLeft={3} onMouseUp={() => setVerdictOpen((x) => !x)}>
            <text>
              <span style={{ fg: theme.textMuted }}>{verdictOpen() ? "▼" : "▶"} </span>
              <span style={{ fg: mark().fg }}>
                {mark().icon} {mark().label}
              </span>
            </text>
            <Show when={verdictOpen()}>
              <box paddingLeft={2}>
                <text fg={theme.textMuted} wrapMode="word">
                  {verdict()!.reason}
                </text>
              </box>
            </Show>
          </box>
        )}
      </Show>
    </>
  )
}

type MessageError = NonNullable<AssistantMessage["error"]>

function errorBody(error: MessageError): string {
  if (error.name === "MessageOutputLengthError") return "Output length limit reached"
  return (error.data as { message?: string }).message ?? "Unknown error"
}

function errorMeta(error: MessageError): string | undefined {
  if (error.name === "APIError") {
    const parts: string[] = []
    if (error.data.statusCode !== undefined) parts.push(`status ${error.data.statusCode}`)
    parts.push(error.data.isRetryable ? "retryable" : "non-retryable")
    return parts.join(" · ")
  }
  if (error.name === "ProviderAuthError") return `provider: ${error.data.providerID}`
  if (error.name === "StructuredOutputError") return `retries: ${error.data.retries}`
  return undefined
}

function ErrorBlock(props: { error: MessageError }) {
  const { theme } = useTheme()
  const meta = createMemo(() => errorMeta(props.error))
  return (
    <box flexDirection="column" paddingLeft={3} marginTop={1}>
      <text fg={theme.error} wrapMode="word">
        <span style={{ fg: theme.error }}>✗ </span>
        {errorBody(props.error)}
      </text>
      <Show when={meta()}>
        <box paddingLeft={3}>
          <text fg={theme.textMuted} wrapMode="word">
            {meta()}
          </text>
        </box>
      </Show>
    </box>
  )
}

function ReasoningPart(props: { last: boolean; part: ReasoningPart; message: AssistantMessage }) {
  const { theme, subtleSyntax } = useTheme()
  const ctx = useCell()
  const [expanded, setExpanded] = createSignal(false)
  const content = createMemo(() => props.part.text.replace("[REDACTED]", "").trim())
  const isDone = createMemo(() => props.part.time.end !== undefined)
  const inMinimal = createMemo(() => ctx.thinkingMode() === "hide")
  const duration = createMemo(() => {
    const end = props.part.time.end
    return end === undefined ? 0 : Math.max(0, end - props.part.time.start)
  })
  const summary = createMemo(() => reasoningSummary(content()))
  const toggle = () => {
    if (!inMinimal()) return
    setExpanded((prev) => !prev)
  }
  return (
    <Show when={content()}>
      <box id={"text-" + props.part.id} paddingLeft={3} marginTop={1} flexDirection="column" flexShrink={0}>
        <box onMouseUp={toggle}>
          <ReasoningHeader
            toggleable={inMinimal()}
            open={!inMinimal() || expanded()}
            done={isDone()}
            title={summary().title}
            duration={isDone() ? Locale.duration(duration()) : undefined}
          />
        </box>
        <Show when={(!inMinimal() || expanded()) && summary().body}>
          <box paddingLeft={inMinimal() ? 2 : 0} marginTop={1}>
            <code
              filetype="markdown"
              drawUnstyledText={false}
              streaming={true}
              syntaxStyle={subtleSyntax()}
              content={summary().body}
              conceal={ctx.conceal()}
              fg={theme.textMuted}
            />
          </box>
        </Show>
      </box>
    </Show>
  )
}

function ReasoningHeader(props: {
  toggleable: boolean
  open: boolean
  done: boolean
  title: string | null
  duration?: string
}) {
  const { theme } = useTheme()
  const fg = () =>
    props.open
      ? RGBA.fromValues(theme.warning.r, theme.warning.g, theme.warning.b, theme.thinkingOpacity)
      : theme.warning
  return (
    <Switch>
      <Match when={!props.done}>
        <box flexDirection="row">
          <Spinner color={fg()}>{props.title ? "Thinking: " + props.title : "Thinking"}</Spinner>
        </box>
      </Match>
      <Match when={true}>
        <text fg={fg()} wrapMode="none">
          <Show when={props.toggleable}>
            <span>{props.open ? "- " : "+ "}</span>
          </Show>
          <span>Thought</span>
          <Show when={props.title || props.duration}>
            <span>: </span>
          </Show>
          <Show when={props.title}>
            <span>{props.title}</span>
          </Show>
          <Show when={props.duration}>
            <span>
              {props.title ? " · " : ""}
              {props.duration}
            </span>
          </Show>
        </text>
      </Match>
    </Switch>
  )
}

function TextPart(props: { last: boolean; part: TextPart; message: AssistantMessage }) {
  const ctx = useCell()
  const { theme, syntax } = useTheme()
  return (
    <Show when={props.part.text.trim()}>
      <box id={"text-" + props.part.id} paddingLeft={3} marginTop={1} flexShrink={0}>
        <Switch>
          <Match when={Flag.OPENCODE_EXPERIMENTAL_MARKDOWN}>
            <markdown
              syntaxStyle={syntax()}
              streaming={true}
              content={props.part.text.trim()}
              conceal={ctx.conceal()}
              fg={theme.markdownText}
              bg={theme.background}
            />
          </Match>
          <Match when={!Flag.OPENCODE_EXPERIMENTAL_MARKDOWN}>
            <code
              filetype="markdown"
              drawUnstyledText={false}
              streaming={true}
              syntaxStyle={syntax()}
              content={props.part.text.trim()}
              conceal={ctx.conceal()}
              fg={theme.text}
            />
          </Match>
        </Switch>
      </box>
    </Show>
  )
}

function ToolPart(props: { last: boolean; part: ToolPart; message: AssistantMessage }) {
  const ctx = useCell()
  const sync = useSync()
  const shouldHide = createMemo(() => {
    if (ctx.showDetails()) return false
    if (props.part.state.status !== "completed") return false
    return true
  })
  const toolprops = {
    get metadata() {
      return props.part.state.status === "pending" ? {} : (props.part.state.metadata ?? {})
    },
    get input() {
      return props.part.state.input ?? {}
    },
    get output() {
      return props.part.state.status === "completed" ? props.part.state.output : undefined
    },
    get permission() {
      const permissions = sync.data.permission[props.message.sessionID] ?? []
      const permissionIndex = permissions.findIndex((x) => x.tool?.callID === props.part.callID)
      return permissions[permissionIndex]
    },
    get tool() {
      return props.part.tool
    },
    get part() {
      return props.part
    },
  }
  return (
    <Show when={!shouldHide()}>
      <Switch>
        <Match when={props.part.tool === "bash"}>
          <Bash {...toolprops} />
        </Match>
        <Match when={props.part.tool === "glob"}>
          <Glob {...toolprops} />
        </Match>
        <Match when={props.part.tool === "read"}>
          <Read {...toolprops} />
        </Match>
        <Match when={props.part.tool === "grep"}>
          <Grep {...toolprops} />
        </Match>
        <Match when={props.part.tool === "webfetch"}>
          <WebFetch {...toolprops} />
        </Match>
        <Match when={props.part.tool === "codesearch"}>
          <CodeSearch {...toolprops} />
        </Match>
        <Match when={props.part.tool === "websearch"}>
          <WebSearch {...toolprops} />
        </Match>
        <Match when={props.part.tool === "write"}>
          <Write {...toolprops} />
        </Match>
        <Match when={props.part.tool === "edit"}>
          <Edit {...toolprops} />
        </Match>
        <Match when={props.part.tool === "actor"}>
          <Task {...toolprops} />
        </Match>
        <Match when={props.part.tool === "task"}>
          <WorkItemTask {...toolprops} />
        </Match>
        <Match when={props.part.tool === "apply_patch"}>
          <ApplyPatch {...toolprops} />
        </Match>
        <Match when={props.part.tool === "question"}>
          <Question {...toolprops} />
        </Match>
        <Match when={props.part.tool === "skill"}>
          <Skill {...toolprops} />
        </Match>
        <Match when={props.part.tool === "plan_exit"}>
          <PlanExit {...toolprops} />
        </Match>
        <Match when={true}>
          <GenericTool {...toolprops} />
        </Match>
      </Switch>
    </Show>
  )
}

type ToolProps<T> = {
  input: Partial<Tool.InferParameters<T>>
  metadata: Partial<Tool.InferMetadata<T>>
  permission: Record<string, any>
  tool: string
  output?: string
  part: ToolPart
}

function PlanExit(props: ToolProps<any>) {
  const { theme } = useTheme()
  const dismissed = createMemo(
    () => props.part.state.status === "completed" && props.part.state.metadata?.switched === false,
  )
  const feedback = createMemo(() => (dismissed() ? props.metadata.feedback : undefined))
  return (
    <>
      <InlineTool icon="⚙" pending="Asking..." complete={true} part={props.part} dismissed={dismissed()}>
        plan_exit
      </InlineTool>
      <Show when={feedback()}>
        <box paddingLeft={6}>
          <text fg={theme.textMuted}>{feedback()}</text>
        </box>
      </Show>
    </>
  )
}

function GenericTool(props: ToolProps<any>) {
  const { theme } = useTheme()
  const ctx = useCell()
  const output = createMemo(() => props.output?.trim() ?? "")
  const [expanded, setExpanded] = createSignal(false)
  const lines = createMemo(() => output().split("\n"))
  const maxLines = 3
  const overflow = createMemo(() => lines().length > maxLines)
  const limited = createMemo(() => {
    if (expanded() || !overflow()) return output()
    return [...lines().slice(0, maxLines), "…"].join("\n")
  })
  return (
    <Show
      when={props.output && ctx.showGenericToolOutput()}
      fallback={
        <InlineTool icon="⚙" pending="Writing command..." complete={true} part={props.part}>
          {props.tool} {input(props.input)}
        </InlineTool>
      }
    >
      <BlockTool
        title={`# ${props.tool} ${input(props.input)}`}
        part={props.part}
        onClick={overflow() ? () => setExpanded((prev) => !prev) : undefined}
      >
        <box gap={1}>
          <text fg={theme.text}>{limited()}</text>
          <Show when={overflow()}>
            <text fg={theme.textMuted}>{expanded() ? "Click to collapse" : "Click to expand"}</text>
          </Show>
        </box>
      </BlockTool>
    </Show>
  )
}

function WorkItemTask(props: ToolProps<typeof TaskTool>) {
  const summary = createMemo(() => {
    const op = (props.input as { operation?: Record<string, any> }).operation
    if (!op || typeof op !== "object") return "task"
    const verb = typeof op.action === "string" ? op.action : "task"
    if (verb === "create") return op.summary ? `create "${op.summary}"` : "create"
    if (verb === "list") return op.status ? `list ${op.status}` : "list"
    if (op.id) return `${verb} ${op.id}`
    return verb
  })
  return (
    <InlineTool icon="#" pending="Updating tasks..." complete={true} part={props.part}>
      task {summary()}
    </InlineTool>
  )
}

function CollapsibleError(props: { error: string; paddingLeft?: number }) {
  const { theme } = useTheme()
  const renderer = useRenderer()
  const [expanded, setExpanded] = createSignal(false)
  const lineCount = createMemo(() => props.error.split("\n").length)
  return (
    <box
      paddingLeft={props.paddingLeft}
      onMouseUp={(evt) => {
        evt.stopPropagation()
        if (renderer.getSelection()?.getSelectedText()) return
        setExpanded((prev) => !prev)
      }}
    >
      <Show
        when={expanded()}
        fallback={
          <text fg={theme.error}>
            + Error ({lineCount()} {lineCount() === 1 ? "line" : "lines"})
          </text>
        }
      >
        <text fg={theme.error}>- Error</text>
        <box paddingLeft={2}>
          <text fg={theme.error}>{props.error}</text>
        </box>
      </Show>
    </box>
  )
}

function InlineTool(props: {
  icon: string
  iconColor?: RGBA
  complete: any
  pending: string
  spinner?: boolean
  dismissed?: boolean
  children: JSX.Element
  part: ToolPart
  onClick?: () => void
}) {
  const [margin, setMargin] = createSignal(0)
  const { theme } = useTheme()
  const ctx = useCell()
  const sync = useSync()
  const renderer = useRenderer()
  const [hover, setHover] = createSignal(false)
  const permission = createMemo(() => {
    const callID = sync.data.permission[ctx.sessionID]?.at(0)?.tool?.callID
    if (!callID) return false
    return callID === props.part.callID
  })
  const fg = createMemo(() => {
    if (permission()) return theme.warning
    if (hover() && props.onClick) return theme.text
    if (props.complete) return theme.textMuted
    return theme.text
  })
  const error = createMemo(() => (props.part.state.status === "error" ? props.part.state.error : undefined))
  const denied = createMemo(
    () =>
      error()?.includes("QuestionRejectedError") ||
      error()?.includes("rejected permission") ||
      error()?.includes("specified a rule") ||
      error()?.includes("user dismissed"),
  )
  return (
    <box
      marginTop={margin()}
      paddingLeft={3}
      onMouseOver={() => props.onClick && setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseUp={() => {
        if (renderer.getSelection()?.getSelectedText()) return
        props.onClick?.()
      }}
      renderBefore={function () {
        const el = this as BoxRenderable
        const parent = el.parent
        if (!parent) return
        if (el.height > 1) {
          setMargin(1)
          return
        }
        const children = parent.getChildren()
        const index = children.indexOf(el)
        const previous = children[index - 1]
        if (!previous) {
          setMargin(0)
          return
        }
        if (previous.height > 1 || previous.id.startsWith("text-")) {
          setMargin(1)
          return
        }
      }}
    >
      <Switch>
        <Match when={props.spinner}>
          <Spinner color={fg()} children={props.children} />
        </Match>
        <Match when={true}>
          <text
            paddingLeft={3}
            fg={fg()}
            attributes={denied() || props.dismissed ? TextAttributes.STRIKETHROUGH : undefined}
          >
            <Show fallback={<>~ {props.pending}</>} when={props.complete}>
              <span style={{ fg: props.iconColor }}>{props.icon}</span> {props.children}
            </Show>
          </text>
        </Match>
      </Switch>
      <Show when={error() && !denied()}>
        <CollapsibleError error={error()!} paddingLeft={3} />
      </Show>
    </box>
  )
}

function BlockTool(props: {
  title: string
  children: JSX.Element
  onClick?: () => void
  part?: ToolPart
  spinner?: boolean
}) {
  const { theme } = useTheme()
  const renderer = useRenderer()
  const [hover, setHover] = createSignal(false)
  const error = createMemo(() => (props.part?.state.status === "error" ? props.part.state.error : undefined))
  return (
    <box
      border={["left"]}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      marginTop={1}
      gap={1}
      backgroundColor={hover() ? theme.backgroundMenu : theme.backgroundPanel}
      customBorderChars={SplitBorder.customBorderChars}
      borderColor={theme.background}
      onMouseOver={() => props.onClick && setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseUp={() => {
        if (renderer.getSelection()?.getSelectedText()) return
        props.onClick?.()
      }}
    >
      <Show
        when={props.spinner}
        fallback={
          <text paddingLeft={3} fg={theme.textMuted}>
            {props.title}
          </text>
        }
      >
        <Spinner color={theme.textMuted}>{props.title.replace(/^# /, "")}</Spinner>
      </Show>
      {props.children}
      <Show when={error()}>
        <CollapsibleError error={error()!} />
      </Show>
    </box>
  )
}

const TOOL_COLLAPSE_MAX_LINES = 3
const TOOL_COLLAPSE_MAX_LINE_LENGTH = 120

function displayLines(content: string) {
  if (!content) return []
  return content.replace(/\n$/, "").split("\n")
}

function hasLongDisplayLine(content: string) {
  return displayLines(content).some((line) => line.length > TOOL_COLLAPSE_MAX_LINE_LENGTH)
}

function Bash(props: ToolProps<typeof BashTool>) {
  const { theme } = useTheme()
  const sync = useSync()
  const isRunning = createMemo(() => props.part.state.status === "running")
  const output = createMemo(() => stripAnsi(props.metadata.output?.trim() ?? ""))
  const [expanded, setExpanded] = createSignal(false)
  const lines = createMemo(() => output().split("\n"))
  const overflow = createMemo(() => lines().length > 10)
  const limited = createMemo(() => {
    if (expanded() || !overflow()) return output()
    return [...lines().slice(0, 10), "…"].join("\n")
  })
  const workdirDisplay = createMemo(() => {
    const workdir = props.input.workdir
    if (!workdir || workdir === ".") return undefined
    const base = sync.path.directory
    if (!base) return undefined
    const absolute = path.resolve(base, workdir)
    if (absolute === base) return undefined
    const home = Global.Path.home
    if (!home) return absolute
    const match = absolute === home || absolute.startsWith(home + path.sep)
    return match ? absolute.replace(home, "~") : absolute
  })
  const title = createMemo(() => {
    const desc = props.input.description ?? "Shell"
    const wd = workdirDisplay()
    if (!wd) return `# ${desc}`
    if (desc.includes(wd)) return `# ${desc}`
    return `# ${desc} in ${wd}`
  })
  return (
    <Switch>
      <Match when={props.metadata.output !== undefined}>
        <BlockTool
          title={title()}
          part={props.part}
          spinner={isRunning()}
          onClick={overflow() ? () => setExpanded((prev) => !prev) : undefined}
        >
          <box gap={1}>
            <text fg={theme.text}>$ {props.input.command}</text>
            <Show when={output()}>
              <text fg={theme.text}>{limited()}</text>
            </Show>
            <Show when={overflow()}>
              <text fg={theme.textMuted}>{expanded() ? "Click to collapse" : "Click to expand"}</text>
            </Show>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="$" pending="Writing command..." complete={props.input.command} part={props.part}>
          {props.input.command}
        </InlineTool>
      </Match>
    </Switch>
  )
}

function Write(props: ToolProps<typeof WriteTool>) {
  const { theme, syntax } = useTheme()
  const [expanded, setExpanded] = createSignal(false)
  const code = createMemo(() => props.input.content ?? "")
  const lineCount = createMemo(() => displayLines(code()).length)
  const collapsed = createMemo(() => lineCount() > TOOL_COLLAPSE_MAX_LINES || hasLongDisplayLine(code()))
  return (
    <Switch>
      <Match when={props.metadata.diagnostics !== undefined}>
        <BlockTool
          title={"# Wrote " + normalizePath(props.input.filePath!)}
          part={props.part}
          onClick={collapsed() ? () => setExpanded((prev) => !prev) : undefined}
        >
          <Show
            when={!collapsed() || expanded()}
            fallback={
              <text fg={theme.textMuted}>
                Click to expand ({lineCount()} {lineCount() === 1 ? "line" : "lines"})
              </text>
            }
          >
            <line_number fg={theme.textMuted} minWidth={3} paddingRight={1}>
              <code
                conceal={false}
                fg={theme.text}
                filetype={filetype(props.input.filePath!)}
                syntaxStyle={syntax()}
                content={code()}
              />
            </line_number>
            <Show when={collapsed()}>
              <text fg={theme.textMuted}>Click to collapse</text>
            </Show>
          </Show>
          <Diagnostics diagnostics={props.metadata.diagnostics} filePath={props.input.filePath ?? ""} />
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="←" pending="Preparing write..." complete={props.input.filePath} part={props.part}>
          Write {normalizePath(props.input.filePath!)}
        </InlineTool>
      </Match>
    </Switch>
  )
}

function Glob(props: ToolProps<typeof GlobTool>) {
  return (
    <InlineTool icon="✱" pending="Finding files..." complete={props.input.pattern} part={props.part}>
      Glob "{props.input.pattern}" <Show when={props.input.path}>in {normalizePath(props.input.path)} </Show>
      <Show when={props.metadata.count}>
        ({props.metadata.count} {props.metadata.count === 1 ? "match" : "matches"})
      </Show>
    </InlineTool>
  )
}

function Read(props: ToolProps<typeof ReadTool>) {
  const { theme } = useTheme()
  const isRunning = createMemo(() => props.part.state.status === "running")
  const loaded = createMemo(() => {
    if (props.part.state.status !== "completed") return []
    if (props.part.state.time.compacted) return []
    const value = props.metadata.loaded
    if (!value || !Array.isArray(value)) return []
    return value.filter((p): p is string => typeof p === "string")
  })
  return (
    <>
      <InlineTool
        icon="→"
        pending="Reading file..."
        complete={props.input.filePath}
        spinner={isRunning()}
        part={props.part}
      >
        Read {normalizePath(props.input.filePath!)} {input(props.input, ["filePath"])}
      </InlineTool>
      <For each={loaded()}>
        {(filepath) => (
          <box paddingLeft={3}>
            <text paddingLeft={3} fg={theme.textMuted}>
              ↳ Loaded {normalizePath(filepath)}
            </text>
          </box>
        )}
      </For>
    </>
  )
}

function Grep(props: ToolProps<typeof GrepTool>) {
  return (
    <InlineTool icon="✱" pending="Searching content..." complete={props.input.pattern} part={props.part}>
      Grep "{props.input.pattern}" <Show when={props.input.path}>in {normalizePath(props.input.path)} </Show>
      <Show when={props.metadata.matches}>
        ({props.metadata.matches} {props.metadata.matches === 1 ? "match" : "matches"})
      </Show>
    </InlineTool>
  )
}

function WebFetch(props: ToolProps<typeof WebFetchTool>) {
  return (
    <InlineTool icon="%" pending="Fetching from the web..." complete={props.input.url} part={props.part}>
      WebFetch {props.input.url}
    </InlineTool>
  )
}

function CodeSearch(props: ToolProps<typeof CodeSearchTool>) {
  const metadata = props.metadata as { results?: number }
  return (
    <InlineTool icon="◇" pending="Searching code..." complete={props.input.query} part={props.part}>
      Exa Code Search "{props.input.query}" <Show when={metadata.results}>({metadata.results} results)</Show>
    </InlineTool>
  )
}

function WebSearch(props: ToolProps<typeof WebSearchTool>) {
  const metadata = props.metadata as { numResults?: number }
  return (
    <InlineTool icon="◈" pending="Searching web..." complete={props.input.query} part={props.part}>
      Web Search "{props.input.query}" <Show when={metadata.numResults}>({metadata.numResults} results)</Show>
    </InlineTool>
  )
}

function Task(props: ToolProps<typeof ActorTool>) {
  const route = useRoute()
  const sync = useSync()
  const raw = props.input as Partial<
    { operation: { description: string; subagent_type: string } } & {
      description: string
      subagent_type: string
    }
  >
  const input: Partial<{ description: string; subagent_type: string }> = raw?.operation ?? raw
  const targetSession = props.metadata.sessionId
  const targetBucket = (props.metadata.actorId as string | undefined) ?? "main"
  onMount(() => {
    if (targetSession && !sync.data.message[targetSession]?.[targetBucket]?.length)
      void sync.session.sync(targetSession)
  })
  const messages = createMemo(() => sync.data.message[targetSession ?? ""]?.[targetBucket] ?? [])
  const tools = createMemo(() => {
    return messages().flatMap((msg) =>
      (sync.data.part[msg.id] ?? [])
        .filter((part): part is ToolPart => part.type === "tool")
        .map((part) => ({ tool: part.tool, state: part.state })),
    )
  })
  const current = createMemo(() =>
    tools().findLast((x) => (x.state.status === "running" || x.state.status === "completed") && x.state.title),
  )
  const isRunning = createMemo(() => props.part.state.status === "running")
  const duration = createMemo(() => {
    const first = messages().find((x) => x.role === "user")?.time.created
    const assistant = messages().findLast((x) => x.role === "assistant")?.time.completed
    if (!first || !assistant) return 0
    return assistant - first
  })
  const content = createMemo(() => {
    if (!input.description) return ""
    let content = [`${Locale.titlecase(input.subagent_type ?? "General")} Task — ${input.description}`]
    if (isRunning() && tools().length > 0) {
      if (current()) {
        const state = current()!.state
        const title = state.status === "running" || state.status === "completed" ? state.title : undefined
        content.push(`↳ ${Locale.titlecase(current()!.tool)} ${title}`)
      } else content.push(`↳ ${tools().length} toolcalls`)
    }
    if (props.part.state.status === "completed") {
      content.push(`└ ${tools().length} toolcalls · ${Locale.duration(duration())}`)
    }
    return content.join("\n")
  })
  return (
    <InlineTool
      icon="│"
      spinner={isRunning()}
      complete={input.description}
      pending="Delegating..."
      part={props.part}
      onClick={() => {
        const targetSession = props.metadata.sessionId
        const targetActor = props.metadata.actorId as string | undefined
        if (!targetSession) return
        if (route.data.type === "session" && targetSession === route.data.sessionID && targetActor) {
          route.navigate({ ...route.data, agentID: targetActor })
          return
        }
        route.navigate({ type: "session", sessionID: targetSession, agentID: targetActor })
      }}
    >
      {content()}
    </InlineTool>
  )
}

function Edit(props: ToolProps<typeof EditTool>) {
  const ctx = useCell()
  const { theme, syntax } = useTheme()
  const view = createMemo(() => {
    const diffStyle = ctx.tui.diff_style
    if (diffStyle === "stacked") return "unified"
    return ctx.width > 120 ? "split" : "unified"
  })
  const ft = createMemo(() => filetype(props.input.filePath))
  const diffContent = createMemo(() => props.metadata.diff)
  return (
    <Switch>
      <Match when={props.metadata.diff !== undefined}>
        <BlockTool title={"← Edit " + normalizePath(props.input.filePath!)} part={props.part}>
          <box paddingLeft={1}>
            <diff
              diff={diffContent()}
              view={view()}
              filetype={ft()}
              syntaxStyle={syntax()}
              showLineNumbers={true}
              width="100%"
              wrapMode={ctx.diffWrapMode()}
              fg={theme.text}
              addedBg={theme.diffAddedBg}
              removedBg={theme.diffRemovedBg}
              contextBg={theme.diffContextBg}
              addedSignColor={theme.diffHighlightAdded}
              removedSignColor={theme.diffHighlightRemoved}
              lineNumberFg={theme.diffLineNumber}
              lineNumberBg={theme.diffContextBg}
              addedLineNumberBg={theme.diffAddedLineNumberBg}
              removedLineNumberBg={theme.diffRemovedLineNumberBg}
            />
          </box>
          <Diagnostics diagnostics={props.metadata.diagnostics} filePath={props.input.filePath ?? ""} />
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="←" pending="Preparing edit..." complete={props.input.filePath} part={props.part}>
          Edit {normalizePath(props.input.filePath!)} {input({ replaceAll: props.input.replaceAll })}
        </InlineTool>
      </Match>
    </Switch>
  )
}

function ApplyPatch(props: ToolProps<typeof ApplyPatchTool>) {
  const ctx = useCell()
  const { theme, syntax } = useTheme()
  const [expanded, setExpanded] = createSignal<string[]>([])
  const files = createMemo(() => props.metadata.files ?? [])
  const view = createMemo(() => {
    const diffStyle = ctx.tui.diff_style
    if (diffStyle === "stacked") return "unified"
    return ctx.width > 120 ? "split" : "unified"
  })
  function Diff(p: { diff: string; filePath: string }) {
    return (
      <box paddingLeft={1}>
        <diff
          diff={p.diff}
          view={view()}
          filetype={filetype(p.filePath)}
          syntaxStyle={syntax()}
          showLineNumbers={true}
          width="100%"
          wrapMode={ctx.diffWrapMode()}
          fg={theme.text}
          addedBg={theme.diffAddedBg}
          removedBg={theme.diffRemovedBg}
          contextBg={theme.diffContextBg}
          addedSignColor={theme.diffHighlightAdded}
          removedSignColor={theme.diffHighlightRemoved}
          lineNumberFg={theme.diffLineNumber}
          lineNumberBg={theme.diffContextBg}
          addedLineNumberBg={theme.diffAddedLineNumberBg}
          removedLineNumberBg={theme.diffRemovedLineNumberBg}
        />
      </box>
    )
  }
  function title(file: { type: string; relativePath: string; filePath: string; deletions: number }) {
    if (file.type === "delete") return "# Deleted " + file.relativePath
    if (file.type === "add") return "# Created " + file.relativePath
    if (file.type === "move") return "# Moved " + normalizePath(file.filePath) + " → " + file.relativePath
    return "← Patched " + file.relativePath
  }
  function toggle(filePath: string) {
    setExpanded((prev) => (prev.includes(filePath) ? prev.filter((item) => item !== filePath) : [...prev, filePath]))
  }
  return (
    <Switch>
      <Match when={files().length > 0}>
        <For each={files()}>
          {(file) => {
            const open = createMemo(() => expanded().includes(file.filePath))
            const count = createMemo(() => file.additions + file.deletions)
            const collapsed = createMemo(() => count() > TOOL_COLLAPSE_MAX_LINES || hasLongDisplayLine(file.patch))
            return (
              <BlockTool
                title={title(file)}
                part={props.part}
                onClick={file.type !== "delete" && collapsed() ? () => toggle(file.filePath) : undefined}
              >
                <Show
                  when={file.type !== "delete"}
                  fallback={
                    <text fg={theme.diffRemoved}>
                      -{file.deletions} line{file.deletions !== 1 ? "s" : ""}
                    </text>
                  }
                >
                  <Show
                    when={!collapsed() || open()}
                    fallback={
                      <text fg={theme.textMuted}>
                        Click to expand ({count()} change{count() !== 1 ? "s" : ""})
                      </text>
                    }
                  >
                    <Diff diff={file.patch} filePath={file.filePath} />
                    <Show when={collapsed()}>
                      <text fg={theme.textMuted}>Click to collapse</text>
                    </Show>
                  </Show>
                  <Diagnostics diagnostics={props.metadata.diagnostics} filePath={file.movePath ?? file.filePath} />
                </Show>
              </BlockTool>
            )
          }}
        </For>
      </Match>
      <Match when={true}>
        <InlineTool icon="%" pending="Preparing patch..." complete={false} part={props.part}>
          Patch
        </InlineTool>
      </Match>
    </Switch>
  )
}

function Question(props: ToolProps<typeof QuestionTool>) {
  const { theme } = useTheme()
  const count = createMemo(() => props.input.questions?.length ?? 0)
  function format(answer?: ReadonlyArray<string>) {
    if (!answer?.length) return "(no answer)"
    return answer.join(", ")
  }
  return (
    <Switch>
      <Match when={props.metadata.answers}>
        <BlockTool title="# Questions" part={props.part}>
          <box gap={1}>
            <For each={props.input.questions ?? []}>
              {(q, i) => (
                <box flexDirection="column">
                  <text fg={theme.textMuted}>{q.question}</text>
                  <text fg={theme.text}>{format(props.metadata.answers?.[i()])}</text>
                </box>
              )}
            </For>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="→" pending="Asking questions..." complete={count()} part={props.part}>
          Asked {count()} question{count() !== 1 ? "s" : ""}
        </InlineTool>
      </Match>
    </Switch>
  )
}

function Skill(props: ToolProps<typeof SkillTool>) {
  return (
    <InlineTool icon="→" pending="Loading skill..." complete={props.input.name} part={props.part}>
      Skill "{props.input.name}"
    </InlineTool>
  )
}

function Diagnostics(props: { diagnostics?: Record<string, Record<string, any>[]>; filePath: string }) {
  const { theme } = useTheme()
  const errors = createMemo(() => {
    const normalized = Filesystem.normalizePath(props.filePath)
    const arr = props.diagnostics?.[normalized] ?? []
    return arr.filter((x) => x.severity === 1).slice(0, 3)
  })
  return (
    <Show when={errors().length}>
      <box>
        <For each={errors()}>
          {(diagnostic) => (
            <text fg={theme.error}>
              Error [{diagnostic.range.start.line + 1}:{diagnostic.range.start.character + 1}] {diagnostic.message}
            </text>
          )}
        </For>
      </box>
    </Show>
  )
}

function normalizePath(input?: string) {
  if (!input) return ""
  const cwd = process.cwd()
  const absolute = path.isAbsolute(input) ? input : path.resolve(cwd, input)
  const relative = path.relative(cwd, absolute)
  if (!relative) return "."
  if (!relative.startsWith("..")) return relative
  return absolute
}

function input(input: Record<string, any>, omit?: string[]): string {
  const primitives = Object.entries(input).filter(([key, value]) => {
    if (omit?.includes(key)) return false
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
  })
  if (primitives.length === 0) return ""
  return `[${primitives.map(([key, value]) => `${key}=${value}`).join(", ")}]`
}

function filetype(input?: string) {
  if (!input) return "none"
  const ext = path.extname(input)
  const language = LANGUAGE_EXTENSIONS[ext]
  if (["typescriptreact", "javascriptreact", "javascript"].includes(language)) return "typescript"
  return language
}
