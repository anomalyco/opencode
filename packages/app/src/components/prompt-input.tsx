import { useFilteredList } from "@opencode-ai/ui/hooks"
import { createEffect, on, Component, Show, onCleanup, Switch, Match, createMemo, createSignal, For } from "solid-js"
import { createStore } from "solid-js/store"
import { useLocal } from "@/context/local"
import { selectionFromLines, type SelectedLineRange, useFile } from "@/context/file"
import {
  ContentPart,
  DEFAULT_PROMPT,
  isPromptEqual,
  Prompt,
  usePrompt,
  ImageAttachmentPart,
  AgentPart,
  FileAttachmentPart,
} from "@/context/prompt"
import { useLayout } from "@/context/layout"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { useComments } from "@/context/comments"
import { Button } from "@opencode-ai/ui/button"
import { DockShellForm, DockTray } from "@opencode-ai/ui/dock-surface"
import { Icon } from "@opencode-ai/ui/icon"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { Tooltip, TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Select } from "@opencode-ai/ui/select"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { ModelSelectorPopover } from "@/components/dialog-select-model"
import { useProviders } from "@/hooks/use-providers"
import { useCommand } from "@/context/command"
import { Persist, persisted } from "@/utils/persist"
import { usePermission } from "@/context/permission"
import { useLanguage } from "@/context/language"
import { dict as enDict } from "@/i18n/en"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { useSessionLayout } from "@/pages/session/session-layout"
import { extraAgentCapabilities } from "@/pages/layout/extra-agents"
import { base64Encode } from "@opencode-ai/util/encode"
import { createSessionTabs } from "@/pages/session/helpers"
import { createTextFragment, getCursorPosition, setCursorPosition, setRangeEdge } from "./prompt-input/editor-dom"
import { createPromptAttachments } from "./prompt-input/attachments"
import { ACCEPTED_FILE_TYPES } from "./prompt-input/files"
import {
  canNavigateHistoryAtCursor,
  navigatePromptHistory,
  prependHistoryEntry,
  type PromptHistoryComment,
  type PromptHistoryEntry,
  type PromptHistoryStoredEntry,
  promptLength,
} from "./prompt-input/history"
import { createPromptSubmit, type FollowupDraft } from "./prompt-input/submit"
import { PromptPopover, type AtOption, type SlashCommand } from "./prompt-input/slash-popover"
import { PromptContextItems } from "./prompt-input/context-items"
import { PromptImageAttachments } from "./prompt-input/image-attachments"
import { PromptDragOverlay } from "./prompt-input/drag-overlay"
import { promptPlaceholder } from "./prompt-input/placeholder"
import { ImagePreview } from "@opencode-ai/ui/image-preview"
import { createPromptPair } from "./prompt-input/autocomplete-pair"
import { createModelAutocomplete, createAutocompleteSettings } from "./prompt-input/autocomplete-model"
import { GhostText } from "./prompt-input/ghost-text"
import { shouldRender } from "./prompt-input/sync"
import { useSpring } from "@opencode-ai/ui/motion-spring"
import { DialogPromptEditor } from "@/components/dialog-prompt-editor"
import { Popover } from "@opencode-ai/ui/popover"
import { showToast } from "@opencode-ai/ui/toast"
import { getFilename } from "@opencode-ai/util/path"
import { merge, value } from "./prompt-input/expand"
import { SessionPickerPopover } from "./prompt-input/session-picker"
import { type SessionHistoryEntry } from "@/context/session-history"
import { working as sessionWorking } from "@/pages/session/session-working"
import { createInputUndoEntry, createInputUndoState, recordInputUndo, stepInputUndo } from "./prompt-input/input-undo"
import { workspaceKey } from "@/pages/layout/helpers"
import { uiPerfTriggerDown, uiPerfOpen } from "@/utils/ui-perf"

interface PromptInputProps {
  class?: string
  variant?: "dock" | "new-session"
  ref?: (el: HTMLDivElement) => void
  newSessionWorktree?: string
  onNewSessionWorktreeChange?: (worktree: string) => void
  onNewSessionWorktreeReset?: () => void
  edit?: { id: string; prompt: Prompt; context: FollowupDraft["context"] }
  onEditLoaded?: () => void
  shouldQueue?: () => boolean
  onQueue?: (draft: FollowupDraft) => void
  onAbort?: () => void
  onSubmit?: () => void
  onSubmitted?: () => void
}

const EXAMPLES = [
  "prompt.example.1",
  "prompt.example.2",
  "prompt.example.3",
  "prompt.example.4",
  "prompt.example.5",
  "prompt.example.6",
  "prompt.example.7",
  "prompt.example.8",
  "prompt.example.9",
  "prompt.example.10",
  "prompt.example.11",
  "prompt.example.12",
  "prompt.example.13",
  "prompt.example.14",
  "prompt.example.15",
  "prompt.example.16",
  "prompt.example.17",
  "prompt.example.18",
  "prompt.example.19",
  "prompt.example.20",
  "prompt.example.21",
  "prompt.example.22",
  "prompt.example.23",
  "prompt.example.24",
  "prompt.example.25",
] as const

const NON_EMPTY_TEXT = /[^\s\u200B]/
const promptTooltipDelay = 350

function dbg() {
  if (typeof window === "undefined") return false
  try {
    return window.localStorage.getItem("opencode.ui.debug") === "1"
  } catch {
    return false
  }
}

function logPromptHover(name: string, phase: string, event?: { timeStamp?: number }) {
  if (!dbg()) return
  const now = typeof performance === "undefined" ? undefined : performance.now()
  console.debug("[prompt:hover]", {
    name,
    phase,
    eventTime: event?.timeStamp,
    now,
  })
}

function logPromptOpen(name: string, fields: Record<string, string | number | boolean | undefined>) {
  if (!dbg()) return
  console.debug("[prompt:open]", { name, ...fields })
}

const GitContext = () => {
  const sdk = useSDK()
  const sync = useSync()
  const language = useLanguage()
  const platform = usePlatform()
  const { params } = useSessionLayout()
  const [open, setOpen] = createSignal(false)
  const [snap, setSnap] = createSignal(sync.data.vcs)

  const rawBranch = createMemo(() => sync.data.vcs?.branch?.trim())
  const info = createMemo(() => (params.id ? sync.session.get(params.id) : undefined))
  const dir = createMemo(() => info()?.directory || sync.data.path.directory || sdk.directory)
  const listed = createMemo(() => {
    const items = snap()?.worktrees ?? sync.data.vcs?.worktrees ?? []
    const fallback = sync.data.path.worktree || sync.project?.worktree || sdk.directory
    if (items.some((item) => workspaceKey(item.path) === workspaceKey(fallback))) return items
    return [{ path: fallback, branch: rawBranch() }, ...items]
  })
  const current = createMemo(() => {
    const key = workspaceKey(dir())
    return listed()
      .filter((item) => key === workspaceKey(item.path) || key.startsWith(`${workspaceKey(item.path)}/`))
      .toSorted((a, b) => b.path.length - a.path.length)[0]
  })
  const root = createMemo(() => current()?.path || sync.data.path.worktree || sync.project?.worktree || sdk.directory)
  const repo = createMemo(() => sync.project?.name || getFilename(root()))
  const local = createMemo(() => workspaceKey(dir()) === workspaceKey(root()))
  const kind = createMemo(() => (local() ? language.t("workspace.type.local") : language.t("workspace.type.sandbox")))
  const worktrees = createMemo(() => {
    if (listed().some((item) => workspaceKey(item.path) === workspaceKey(root()))) return listed()
    return [{ path: root(), branch: current()?.branch || rawBranch() }, ...listed()]
  })
  const branch = createMemo(() => worktrees().find((item) => item.path === root())?.branch?.trim() || rawBranch())
  const branches = createMemo(() => {
    const items = (snap()?.branches ?? sync.data.vcs?.branches ?? []).filter(Boolean)
    if (items.length) return items
    return branch() ? [branch()!] : []
  })
  const showBranches = createMemo(() => branches().length > 1)
  const win = createMemo(() => platform.platform === "desktop" && platform.os === "windows")

  createEffect(() => {
    setSnap(sync.data.vcs)
  })

  createEffect(() => {
    if (!open()) return
    sdk.client.vcs
      .get()
      .then((result) => result.data)
      .then((data) => data && setSnap(data))
      .catch(() => undefined)
  })

  const copy = (path: string) => {
    console.debug("[GitContext] copy worktree path", { path })
    const clip = typeof navigator === "undefined" ? undefined : navigator.clipboard
    if (!clip?.writeText) {
      console.debug("[GitContext] clipboard unavailable", { path })
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: path,
      })
      return
    }
    void clip.writeText(path).then(
      () => {
        console.debug("[GitContext] copied worktree path", { path })
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("session.share.copy.copied"),
          description: path,
        })
      },
      (err: unknown) => {
        console.debug("[GitContext] failed to copy worktree path", { path, err })
        showToast({
          variant: "error",
          title: language.t("common.requestFailed"),
          description: err instanceof Error ? err.message : String(err),
        })
      },
    )
  }

  return (
    <Show when={sync.project?.vcs === "git" && branch()}>
      <Popover
        open={open()}
        onOpenChange={setOpen}
        placement="top-start"
        gutter={6}
        triggerAs={Button}
        triggerProps={{
          variant: "ghost",
          size: "normal",
          class: "prompt-pick min-w-0 max-w-[320px] group",
        }}
        class="w-[560px] max-w-[calc(100vw-40px)]"
        trigger={
          <div class="min-w-0 flex items-center gap-1.5 px-1.5">
            <Icon name="branch" size="small" class="shrink-0 text-icon-base" />
            <span class="truncate text-text-strong">{branch()}</span>
            <Icon name="chevron-down" size="small" class="shrink-0 text-icon-weak" />
          </div>
        }
      >
        <div class="flex flex-col gap-4">
          <div class="flex flex-col gap-1">
            <div class="text-11-medium uppercase tracking-[0.08em] text-text-weak">Git context</div>
            <div class="flex items-center gap-2 min-w-0">
              <Icon name="branch" size="small" class="shrink-0 text-icon-base" />
              <div class="min-w-0 flex-1">
                <div class="truncate text-14-medium text-text-strong">{branch()}</div>
                <div class="truncate text-12-regular text-text-weak">
                  {repo()} - {kind()}
                </div>
              </div>
            </div>
          </div>

          <Show when={worktrees().length > 0}>
            <div class="min-w-0">
              <div class="mb-2 text-11-medium uppercase tracking-[0.08em] text-text-weak">Worktrees</div>
              <div class="flex flex-col gap-1.5">
                <For each={worktrees().slice(0, 8)}>
                  {(item) => {
                    const active = () => item.path === root()
                    return (
                      <div class="flex items-start gap-2 min-w-0 px-2 py-1.5 text-12-regular">
                        <Icon
                          name="folder"
                          size="small"
                          class="mt-0.5 shrink-0"
                          classList={{
                            "text-icon-weak": !active(),
                            "text-icon-success-base": active(),
                          }}
                        />
                        <div class="min-w-0 flex-1">
                          <div
                            class="truncate"
                            style={{
                              color: active() ? "var(--icon-success-active)" : undefined,
                              "font-weight": active() ? "600" : undefined,
                            }}
                            classList={{ "text-text-base": !active() }}
                          >
                            {getFilename(item.path)}
                          </div>
                          <button
                            type="button"
                            class="group/path inline-flex max-w-full items-start gap-1 rounded-sm text-left"
                            aria-label={`${language.t("command.project.copyPath")}: ${item.path}`}
                            title={item.path}
                            onClick={() => copy(item.path)}
                          >
                            <span
                              class="break-all font-mono text-[12px] leading-5 transition-colors group-hover/path:underline"
                              style={{ color: active() ? "var(--icon-success-active)" : undefined }}
                              classList={{
                                "text-text-weak": !active(),
                                "hover:text-text-strong": !active(),
                              }}
                            >
                              {item.path}
                            </span>
                            <Icon
                              name="copy"
                              size="small"
                              class="mt-0.5 shrink-0 transition-colors"
                              classList={{
                                "text-icon-weak group-hover/path:text-icon-base": !active(),
                                "text-icon-success-base group-hover/path:text-icon-success-active": active(),
                              }}
                            />
                          </button>
                        </div>
                      </div>
                    )
                  }}
                </For>
              </div>
            </div>
          </Show>

          <Show when={showBranches()}>
            <div class="min-w-0">
              <div class="mb-2 text-11-medium uppercase tracking-[0.08em] text-text-weak">Branches</div>
              <div class="flex flex-col gap-1.5">
                <For each={branches().slice(0, 8)}>
                  {(item) => (
                    <div class="flex items-center gap-2 min-w-0 text-12-regular">
                      <Icon
                        name="branch"
                        size="small"
                        class="shrink-0"
                        classList={{
                          "text-icon-weak": item !== branch(),
                          "text-icon-success-base": item === branch(),
                        }}
                      />
                      <span
                        class="truncate"
                        style={{
                          color: item === branch() ? "var(--icon-success-active)" : undefined,
                          "font-weight": item === branch() ? "600" : undefined,
                        }}
                        classList={{ "text-text-base": item !== branch() }}
                      >
                        {item}
                      </span>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Show>
        </div>
      </Popover>
    </Show>
  )
}

export const PromptInput: Component<PromptInputProps> = (props) => {
  const sdk = useSDK()
  const queryOptions = useQueryOptions()

  const sync = useSync()
  const local = useLocal()
  const files = useFile()
  const prompt = usePrompt()
  const layout = useLayout()
  const comments = useComments()
  const dialog = useDialog()
  const providers = useProviders()
  const command = useCommand()
  const permission = usePermission()
  const language = useLanguage()
  type DictKey = keyof typeof enDict
  const kw = (...keys: DictKey[]) => (language.locale() === "en" ? undefined : keys.map((k) => enDict[k]).join(" "))
  const platform = usePlatform()
  const server = useServer()
  const win = createMemo(() => platform.platform === "desktop" && platform.os === "windows")
  const { params, tabs, view } = useSessionLayout()
  const extraAgentIntegration = createMemo(() => server.current?.integration)
  const extraAgentCaps = createMemo(() => extraAgentCapabilities(extraAgentIntegration()))
  const hasAgentChoose = createMemo(() => !!extraAgentCaps()?.agentChoose)
  const hideAgentSelector = createMemo(() => !!extraAgentCaps()?.hideAgent)
  const hideVariantSelector = createMemo(() => !!extraAgentCaps()?.hideVariant)
  let editorRef!: HTMLDivElement
  let fileInputRef: HTMLInputElement | undefined
  let scrollRef!: HTMLDivElement
  let slashPopoverRef!: HTMLDivElement
  let inputUndo = createInputUndoState(createInputUndoEntry(DEFAULT_PROMPT, 0))
  let inputUndoLast = 0

  const mirror = { input: false }
  const inset = 56
  const space = `${inset}px`

  const scrollCursorIntoView = () => {
    const container = scrollRef
    const selection = window.getSelection()
    if (!container || !selection || selection.rangeCount === 0) return

    const range = selection.getRangeAt(0)
    if (!editorRef.contains(range.startContainer)) return

    const cursor = getCursorPosition(editorRef)
    const length = promptLength(prompt.current().filter((part) => part.type !== "image"))
    if (cursor >= length) {
      container.scrollTop = container.scrollHeight
      return
    }

    const rect = range.getClientRects().item(0) ?? range.getBoundingClientRect()
    if (!rect.height) return

    const containerRect = container.getBoundingClientRect()
    const top = rect.top - containerRect.top + container.scrollTop
    const bottom = rect.bottom - containerRect.top + container.scrollTop
    const padding = 12

    if (top < container.scrollTop + padding) {
      container.scrollTop = Math.max(0, top - padding)
      return
    }

    if (bottom > container.scrollTop + container.clientHeight - inset) {
      container.scrollTop = bottom - container.clientHeight + inset
    }
  }

  const queueScroll = (count = 2) => {
    requestAnimationFrame(() => {
      scrollCursorIntoView()
      if (count > 1) queueScroll(count - 1)
    })
  }

  const activeFileTab = createSessionTabs({
    tabs,
    pathFromTab: files.pathFromTab,
    normalizeTab: (tab) => (tab.startsWith("file://") ? files.tab(tab) : tab),
  }).activeFileTab

  const commentInReview = (path: string) => {
    const sessionID = params.id
    if (!sessionID) return false

    const diffs = sync.data.session_diff[sessionID]
    if (!diffs) return false
    return diffs.some((diff) => diff.file === path)
  }

  const openComment = (item: { path: string; commentID?: string; commentOrigin?: "review" | "file" }) => {
    if (!item.commentID) return

    const focus = { file: item.path, id: item.commentID }
    comments.setActive(focus)

    const queueCommentFocus = (attempts = 6) => {
      const schedule = (left: number) => {
        requestAnimationFrame(() => {
          comments.setFocus({ ...focus })
          if (left <= 0) return
          requestAnimationFrame(() => {
            const current = comments.focus()
            if (!current) return
            if (current.file !== focus.file || current.id !== focus.id) return
            schedule(left - 1)
          })
        })
      }

      schedule(attempts)
    }

    const wantsReview = item.commentOrigin === "review" || (item.commentOrigin !== "file" && commentInReview(item.path))
    if (wantsReview) {
      if (!view().reviewPanel.opened()) view().reviewPanel.open()
      layout.fileTree.setTab("changes")
      tabs().setActive("review")
      queueCommentFocus()
      return
    }

    if (!view().reviewPanel.opened()) view().reviewPanel.open()
    layout.fileTree.setTab("all")
    const tab = files.tab(item.path)
    void tabs().open(tab)
    tabs().setActive(tab)
    void Promise.resolve(files.load(item.path)).finally(() => queueCommentFocus())
  }

  const recent = createMemo(() => {
    const all = tabs().all()
    const active = activeFileTab()
    const order = active ? [active, ...all.filter((x) => x !== active)] : all
    const seen = new Set<string>()
    const paths: string[] = []

    for (const tab of order) {
      const path = files.pathFromTab(tab)
      if (!path) continue
      if (seen.has(path)) continue
      seen.add(path)
      paths.push(path)
    }

    return paths
  })
  const info = createMemo(() => (params.id ? sync.session.get(params.id) : undefined))
  const status = createMemo(
    () =>
      sync.data.session_status[params.id ?? ""] ?? {
        type: "idle",
      },
  )
  const messages = createMemo(() => {
    const id = params.id
    if (!id) return []
    return sync.data.message[id] ?? []
  })
  const working = createMemo(() => sessionWorking(status(), messages()))
  const tip = () => {
    if (working()) {
      return (
        <div class="flex items-center gap-2">
          <span>{language.t("prompt.action.stop")}</span>
          <span class="text-icon-base text-12-medium text-[10px]!">{language.t("common.key.esc")}</span>
        </div>
      )
    }

    return (
      <div class="flex items-center gap-2">
        <span>{language.t("prompt.action.send")}</span>
        <Icon name="enter" size="small" class="text-icon-base" />
      </div>
    )
  }
  const imageAttachments = createMemo(() =>
    prompt.current().filter((part): part is ImageAttachmentPart => part.type === "image"),
  )

  const [store, setStore] = createStore<{
    popover: "at" | "slash" | null
    historyIndex: number
    savedPrompt: PromptHistoryEntry | null
    placeholder: number
    draggingType: "image" | "@mention" | null
    mode: "normal" | "shell"
    applyingHistory: boolean
  }>({
    popover: null,
    historyIndex: -1,
    savedPrompt: null as PromptHistoryEntry | null,
    placeholder: Math.floor(Math.random() * EXAMPLES.length),
    draggingType: null,
    mode: "normal",
    applyingHistory: false,
  })

  const buttonsSpring = useSpring(() => (store.mode === "normal" ? 1 : 0), { visualDuration: 0.2, bounce: 0 })
  const motion = (value: number) => ({
    opacity: value,
    transform: `scale(${0.95 + value * 0.05})`,
    "pointer-events": value > 0.5 ? ("auto" as const) : ("none" as const),
  })
  const buttons = createMemo(() => motion(buttonsSpring()))
  const shell = createMemo(() => motion(1 - buttonsSpring()))
  const control = createMemo(() => ({ height: "28px", ...buttons() }))
  const glass = createMemo(() => ({
    "background-color":
      platform.platform === "desktop" ? "var(--surface-raised-stronger-non-alpha)" : "rgb(12 12 14 / 0.34)",
    "backdrop-filter": platform.platform === "desktop" ? "none" : "blur(40px) saturate(150%)",
    "-webkit-backdrop-filter": platform.platform === "desktop" ? "none" : "blur(40px) saturate(150%)",
  }))
  const commentCount = createMemo(() => {
    if (store.mode === "shell") return 0
    return prompt.context.items().filter((item) => !!item.comment?.trim()).length
  })
  const blank = createMemo(() => {
    const text = prompt
      .current()
      .map((part) => ("content" in part ? part.content : ""))
      .join("")
    return text.trim().length === 0 && imageAttachments().length === 0 && commentCount() === 0
  })
  const stopping = createMemo(() => working() && blank())
  const tip = () => {
    if (stopping()) {
      return (
        <div class="flex items-center gap-2">
          <span>{language.t("prompt.action.stop")}</span>
          <span class="text-icon-base text-12-medium text-[10px]!">{language.t("common.key.esc")}</span>
        </div>
      )
    }

    return (
      <div class="flex items-center gap-2">
        <span>{language.t("prompt.action.send")}</span>
        <Icon name="enter" size="small" class="text-icon-base" />
      </div>
    )
  }

  const contextItems = createMemo(() => {
    const items = prompt.context.items()
    if (store.mode !== "shell") return items
    return items.filter((item) => !item.comment?.trim())
  })

  const hasUserPrompt = createMemo(() => {
    const sessionID = params.id
    if (!sessionID) return false
    const messages = sync.data.message[sessionID]
    if (!messages) return false
    return messages.some((m) => m.role === "user")
  })
  const [submit, setSubmit] = createSignal(false)

  const [history, setHistory] = persisted(
    Persist.global("prompt-history", ["prompt-history.v1"]),
    createStore<{
      entries: PromptHistoryStoredEntry[]
    }>({
      entries: [],
    }),
  )
  const [shellHistory, setShellHistory] = persisted(
    Persist.global("prompt-history-shell", ["prompt-history-shell.v1"]),
    createStore<{
      entries: PromptHistoryStoredEntry[]
    }>({
      entries: [],
    }),
  )
  const [prefs, setPrefs] = persisted(
    Persist.global("prompt-layout", ["prompt-layout.v1"]),
    createStore({
      read: false,
    }),
  )

  createEffect(() => {
    if (!submit()) return
    if (!prompt.dirty() && !hasUserPrompt()) return
    setSubmit(false)
  })

  const suggest = createMemo(() => !hasUserPrompt() && !submit())
  const read = createMemo(() => prefs.read)

  const placeholder = createMemo(() =>
    promptPlaceholder({
      mode: store.mode,
      commentCount: commentCount(),
      example: suggest() ? (store.mode === "shell" ? "git status" : language.t(EXAMPLES[store.placeholder])) : "",
      suggest: suggest(),
      t: (key, params) => language.t(key as Parameters<typeof language.t>[0], params as never),
    }),
  )

  const historyComments = () => {
    const byID = new Map(comments.all().map((item) => [`${item.file}\n${item.id}`, item] as const))
    return prompt.context.items().flatMap((item) => {
      if (item.type !== "file") return []
      const comment = item.comment?.trim()
      if (!comment) return []

      const selection = item.commentID ? byID.get(`${item.path}\n${item.commentID}`)?.selection : undefined
      const nextSelection =
        selection ??
        (item.selection
          ? ({
              start: item.selection.startLine,
              end: item.selection.endLine,
            } satisfies SelectedLineRange)
          : undefined)
      if (!nextSelection) return []

      return [
        {
          id: item.commentID ?? item.key,
          path: item.path,
          selection: { ...nextSelection },
          comment,
          time: item.commentID ? (byID.get(`${item.path}\n${item.commentID}`)?.time ?? Date.now()) : Date.now(),
          origin: item.commentOrigin,
          preview: item.preview,
        } satisfies PromptHistoryComment,
      ]
    })
  }

  const applyHistoryComments = (items: PromptHistoryComment[]) => {
    comments.replace(
      items.map((item) => ({
        id: item.id,
        file: item.path,
        selection: { ...item.selection },
        comment: item.comment,
        time: item.time,
      })),
    )
    prompt.context.replaceComments(
      items.map((item) => ({
        type: "file" as const,
        path: item.path,
        selection: selectionFromLines(item.selection),
        comment: item.comment,
        commentID: item.id,
        commentOrigin: item.origin,
        preview: item.preview,
      })),
    )
  }

  const applyHistoryPrompt = (entry: PromptHistoryEntry, position: "start" | "end") => {
    const p = entry.prompt
    const length = position === "start" ? 0 : promptLength(p)
    setStore("applyingHistory", true)
    applyHistoryComments(entry.comments)
    resetInputUndo(p, length)
    prompt.set(p, length)
    requestAnimationFrame(() => {
      editorRef.focus()
      setCursorPosition(editorRef, length)
      setStore("applyingHistory", false)
      queueScroll()
    })
  }

  const getCaretState = () => {
    const selection = window.getSelection()
    const textLength = promptLength(prompt.current())
    if (!selection || selection.rangeCount === 0) {
      return { collapsed: false, cursorPosition: 0, textLength }
    }
    const anchorNode = selection.anchorNode
    if (!anchorNode || !editorRef.contains(anchorNode)) {
      return { collapsed: false, cursorPosition: 0, textLength }
    }
    return {
      collapsed: selection.isCollapsed,
      cursorPosition: getCursorPosition(editorRef),
      textLength,
    }
  }

  const escBlur = () => platform.platform === "desktop" && platform.os === "macos"

  const pick = () => fileInputRef?.click()

  const setMode = (mode: "normal" | "shell") => {
    setStore("mode", mode)
    setStore("popover", null)
    requestAnimationFrame(() => editorRef?.focus())
  }

  const shellModeKey = "mod+shift+x"
  const normalModeKey = "mod+shift+e"

  command.register("prompt-input", () => [
    {
      id: "file.attach",
      title: language.t("prompt.action.attachFile"),
      keywords: kw("prompt.action.attachFile"),
      category: language.t("command.category.file"),
      keybind: "mod+u",
      disabled: store.mode !== "normal",
      onSelect: pick,
    },
    {
      id: "prompt.mode.shell",
      title: language.t("command.prompt.mode.shell"),
      keywords: kw("command.prompt.mode.shell"),
      category: language.t("command.category.session"),
      keybind: shellModeKey,
      disabled: store.mode === "shell",
      onSelect: () => setMode("shell"),
    },
    {
      id: "prompt.mode.normal",
      title: language.t("command.prompt.mode.normal"),
      keywords: kw("command.prompt.mode.normal"),
      category: language.t("command.category.session"),
      keybind: normalModeKey,
      disabled: store.mode === "normal",
      onSelect: () => setMode("normal"),
    },
  ])

  const closePopover = () => setStore("popover", null)

  const resetHistoryNavigation = (force = false) => {
    if (!force && (store.historyIndex < 0 || store.applyingHistory)) return
    setStore("historyIndex", -1)
    setStore("savedPrompt", null)
  }

  const resetInputUndo = (entry: Prompt = prompt.current(), cursor = prompt.cursor() ?? promptLength(entry)) => {
    inputUndo = createInputUndoState(createInputUndoEntry(entry, cursor))
    inputUndoLast = 0
  }

  const syncInputUndo = (next: Prompt, cursor: number, prev = prompt.current()) => {
    const now = Date.now()
    inputUndo = recordInputUndo({
      state: inputUndo,
      prev: createInputUndoEntry(prev, prompt.cursor() ?? promptLength(prev)),
      next: createInputUndoEntry(next, cursor),
      time: now,
      last: inputUndoLast,
    })
    inputUndoLast = now
  }

  const applyInputUndoEntry = (entry: { prompt: Prompt; cursor: number }) => {
    closePopover()
    resetHistoryNavigation(true)
    prompt.set(entry.prompt, entry.cursor)
    requestAnimationFrame(() => {
      editorRef.focus()
      setCursorPosition(editorRef, entry.cursor)
      queueScroll()
    })
  }

  const clearEditor = () => {
    editorRef.innerHTML = ""
  }

  const setEditorText = (text: string) => {
    clearEditor()
    editorRef.textContent = text
  }

  const focusEditorEnd = () => {
    requestAnimationFrame(() => {
      editorRef.focus()
      const range = document.createRange()
      const selection = window.getSelection()
      range.selectNodeContents(editorRef)
      range.collapse(false)
      selection?.removeAllRanges()
      selection?.addRange(range)
    })
  }

  const currentCursor = () => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || !editorRef.contains(selection.anchorNode)) return null
    return getCursorPosition(editorRef)
  }

  const restoreFocus = () => {
    requestAnimationFrame(() => {
      const cursor = prompt.cursor() ?? promptLength(prompt.current())
      editorRef.focus()
      setCursorPosition(editorRef, cursor)
      queueScroll()
    })
  }

  const renderEditorWithCursor = (parts: Prompt) => {
    const cursor = currentCursor()
    renderEditor(parts)
    if (cursor !== null) setCursorPosition(editorRef, cursor)
  }

  createEffect(() => {
    params.id
    if (params.id) return
    if (!suggest()) return
    const interval = setInterval(() => {
      setStore("placeholder", (prev) => (prev + 1) % EXAMPLES.length)
    }, 6500)
    onCleanup(() => clearInterval(interval))
  })

  createEffect(
    on(
      () => [params.dir, params.id] as const,
      () => resetInputUndo(),
      { defer: true },
    ),
  )

  const [composing, setComposing] = createSignal(false)
  const isImeComposing = (event: KeyboardEvent) => event.isComposing || composing() || event.keyCode === 229

  const handleBlur = () => {
    closePopover()
    setComposing(false)
  }

  const handleCompositionStart = () => {
    setComposing(true)
  }

  const handleCompositionEnd = () => {
    setComposing(false)
    requestAnimationFrame(() => {
      if (composing()) return
      reconcile(prompt.current().filter((part) => part.type !== "image"))
    })
  }

  const agentList = createMemo(() =>
    sync.data.agent
      .filter((agent) => !agent.hidden && agent.mode !== "primary")
      .map((agent): AtOption => ({ type: "agent", name: agent.name, display: agent.name })),
  )
  const agentNames = createMemo(() => local.agent.list().map((agent) => agent.name))

  const handleAtSelect = (option: AtOption | undefined) => {
    if (!option) return
    if (option.type === "agent") {
      addPart({ type: "agent", name: option.name, content: "@" + option.name, start: 0, end: 0 })
    } else {
      addPart({ type: "file", path: option.path, content: "@" + option.path, start: 0, end: 0 })
    }
  }

  const atKey = (x: AtOption | undefined) => {
    if (!x) return ""
    return x.type === "agent" ? `agent:${x.name}` : `file:${x.path}`
  }

  const {
    flat: atFlat,
    active: atActive,
    setActive: setAtActive,
    onInput: atOnInput,
    onKeyDown: atOnKeyDown,
  } = useFilteredList<AtOption>({
    items: async (query) => {
      const agents = agentList()
      const open = recent()
      const seen = new Set(open)
      const pinned: AtOption[] = open.map((path) => ({ type: "file", path, display: path, recent: true }))
      if (!query.trim()) return [...agents, ...pinned]
      const paths = await files.searchFilesAndDirectories(query)
      const fileOptions: AtOption[] = paths
        .filter((path) => !seen.has(path))
        .map((path) => ({ type: "file", path, display: path }))
      return [...agents, ...pinned, ...fileOptions]
    },
    key: atKey,
    filterKeys: ["display"],
    groupBy: (item) => {
      if (item.type === "agent") return "agent"
      if (item.recent) return "recent"
      return "file"
    },
    sortGroupsBy: (a, b) => {
      const rank = (category: string) => {
        if (category === "agent") return 0
        if (category === "recent") return 1
        return 2
      }
      return rank(a.category) - rank(b.category)
    },
    onSelect: handleAtSelect,
  })

  const slashCommands = createMemo<SlashCommand[]>(() => {
    const integration = extraAgentIntegration()
    const caps = extraAgentCaps()
    if (integration && caps?.slashCommands) {
      return caps.slashCommands.map(([trigger, description]) => ({
        id: `${integration}.${trigger}`,
        trigger,
        title: trigger,
        description,
        type: "extra-agent" as const,
        agentId: integration,
      }))
    }

    const builtin = command.options
      .filter((opt) => !opt.disabled && !opt.id.startsWith("suggested.") && opt.slash)
      .map((opt) => ({
        id: opt.id,
        trigger: opt.slash!,
        title: opt.title,
        description: opt.description,
        keybind: opt.keybind,
        type: "builtin" as const,
      }))

    const builtinTriggers = new Set(builtin.map((b) => b.trigger))

    const custom = sync.data.command
      .filter((cmd) => !builtinTriggers.has(cmd.name))
      .map((cmd) => ({
        id: `custom.${cmd.name}`,
        trigger: cmd.name,
        title: cmd.name,
        description: cmd.description,
        type: "custom" as const,
        source: cmd.source,
      }))

    return [...custom, ...builtin]
  })

  const handleSlashSelect = (cmd: SlashCommand | undefined) => {
    if (!cmd) return
    closePopover()
    const images = imageAttachments()

    if (cmd.type === "custom" || cmd.type === "extra-agent") {
      const text = `/${cmd.trigger} `
      setEditorText(text)
      resetInputUndo([{ type: "text", content: text, start: 0, end: text.length }], text.length)
      prompt.set([{ type: "text", content: text, start: 0, end: text.length }], text.length)
      focusEditorEnd()
      return
    }

    clearEditor()
    resetInputUndo(DEFAULT_PROMPT, 0)
    prompt.set([{ type: "text", content: "", start: 0, end: 0 }], 0)
    command.trigger(cmd.id, "slash")
  }

  const {
    flat: slashFlat,
    active: slashActive,
    setActive: setSlashActive,
    onInput: slashOnInput,
    onKeyDown: slashOnKeyDown,
  } = useFilteredList<SlashCommand>({
    items: slashCommands,
    key: (x) => x?.id,
    filterKeys: ["trigger", "title"],
    onSelect: handleSlashSelect,
  })

  const createPill = (part: FileAttachmentPart | AgentPart) => {
    const pill = document.createElement("span")
    pill.textContent = part.content
    pill.setAttribute("data-type", part.type)
    if (part.type === "file") pill.setAttribute("data-path", part.path)
    if (part.type === "agent") pill.setAttribute("data-name", part.name)
    pill.setAttribute("contenteditable", "false")
    pill.style.userSelect = "text"
    pill.style.cursor = "default"
    return pill
  }

  const isNormalizedEditor = () =>
    Array.from(editorRef.childNodes).every((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent ?? ""
        if (!text.includes("\u200B")) return true
        if (text !== "\u200B") return false

        const prev = node.previousSibling
        const next = node.nextSibling
        const prevIsBr = prev?.nodeType === Node.ELEMENT_NODE && (prev as HTMLElement).tagName === "BR"
        return !!prevIsBr && !next
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return false
      const el = node as HTMLElement
      if (el.dataset.type === "file") return true
      if (el.dataset.type === "agent") return true
      return el.tagName === "BR"
    })

  const renderEditor = (parts: Prompt) => {
    clearEditor()
    for (const part of parts) {
      if (part.type === "text") {
        editorRef.appendChild(createTextFragment(part.content))
        continue
      }
      if (part.type === "file" || part.type === "agent") {
        editorRef.appendChild(createPill(part))
      }
    }

    const last = editorRef.lastChild
    if (last?.nodeType === Node.ELEMENT_NODE && (last as HTMLElement).tagName === "BR") {
      editorRef.appendChild(document.createTextNode("\u200B"))
    }
  }

  // Auto-scroll active command into view when navigating with keyboard
  createEffect(() => {
    const activeId = slashActive()
    if (!activeId || !slashPopoverRef) return

    requestAnimationFrame(() => {
      const element = slashPopoverRef.querySelector(`[data-slash-id="${activeId}"]`)
      element?.scrollIntoView({ block: "nearest", behavior: "smooth" })
    })
  })
  const selectPopoverActive = () => {
    if (store.popover === "at") {
      const items = atFlat()
      if (items.length === 0) return
      const active = atActive()
      const item = items.find((entry) => atKey(entry) === active) ?? items[0]
      handleAtSelect(item)
      return
    }

    if (store.popover === "slash") {
      const items = slashFlat()
      if (items.length === 0) return
      const active = slashActive()
      const item = items.find((entry) => entry.id === active) ?? items[0]
      handleSlashSelect(item)
    }
  }

  const reconcile = (input: Prompt) => {
    if (mirror.input) {
      mirror.input = false
      if (isNormalizedEditor()) return

      renderEditorWithCursor(input)
      return
    }

    const dom = parseFromDOM()
    if (isNormalizedEditor() && isPromptEqual(input, dom)) return

    renderEditorWithCursor(input)
  }

  createEffect(
    on(
      () => prompt.current(),
      (currentParts) => {
        const inputParts = currentParts.filter((part) => part.type !== "image")
        const mirrorMode = mirror.input
        if (mirrorMode) mirror.input = false
        const normalized = isNormalizedEditor()

        if (mirrorMode) {
          if (!shouldRender({ composing: composing(), mirror: true, normalized, equal: false })) return
          renderEditorWithCursor(inputParts)
          return
        }

        if (composing()) return

        const domParts = parseFromDOM()
        const equal = isPromptEqual(inputParts, domParts)
        if (!shouldRender({ composing: false, mirror: false, normalized, equal })) return

        renderEditorWithCursor(inputParts)
      },
    ),
  )

  const parseFromDOM = (): Prompt => {
    const parts: Prompt = []
    let position = 0
    let buffer = ""

    const flushText = () => {
      let content = buffer
      if (content.includes("\r")) content = content.replace(/\r\n?/g, "\n")
      if (content.includes("\u200B")) content = content.replace(/\u200B/g, "")
      buffer = ""
      if (!content) return
      parts.push({ type: "text", content, start: position, end: position + content.length })
      position += content.length
    }

    const pushFile = (file: HTMLElement) => {
      const content = file.textContent ?? ""
      parts.push({
        type: "file",
        path: file.dataset.path!,
        content,
        start: position,
        end: position + content.length,
      })
      position += content.length
    }

    const pushAgent = (agent: HTMLElement) => {
      const content = agent.textContent ?? ""
      parts.push({
        type: "agent",
        name: agent.dataset.name!,
        content,
        start: position,
        end: position + content.length,
      })
      position += content.length
    }

    const visit = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        buffer += node.textContent ?? ""
        return
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return

      const el = node as HTMLElement
      if (el.dataset.type === "file") {
        flushText()
        pushFile(el)
        return
      }
      if (el.dataset.type === "agent") {
        flushText()
        pushAgent(el)
        return
      }
      if (el.tagName === "BR") {
        buffer += "\n"
        return
      }

      for (const child of Array.from(el.childNodes)) {
        visit(child)
      }
    }

    const children = Array.from(editorRef.childNodes)
    children.forEach((child, index) => {
      const isBlock = child.nodeType === Node.ELEMENT_NODE && ["DIV", "P"].includes((child as HTMLElement).tagName)
      visit(child)
      if (isBlock && index < children.length - 1) {
        buffer += "\n"
      }
    })

    flushText()

    if (parts.length === 0) parts.push(...DEFAULT_PROMPT)
    return parts
  }

  const handleInput = () => {
    const prev = prompt.current()
    const rawParts = parseFromDOM()
    const images = imageAttachments()
    const cursorPosition = getCursorPosition(editorRef)
    const rawText =
      rawParts.length === 1 && rawParts[0]?.type === "text"
        ? rawParts[0].content
        : rawParts.map((p) => ("content" in p ? p.content : "")).join("")
    const hasNonText = rawParts.some((part) => part.type !== "text")
    const textContent = (editorRef.textContent ?? "").replace(/\u200B/g, "")
    const shouldReset =
      textContent.length === 0 && rawText.replace(/\n/g, "").length === 0 && !hasNonText && images.length === 0

    if (shouldReset) {
      closePopover()
      resetHistoryNavigation()
      if (prompt.dirty()) {
        syncInputUndo(DEFAULT_PROMPT, 0, prev)
        mirror.input = true
        prompt.set(DEFAULT_PROMPT, 0)
      }
      queueScroll()
      return
    }

    const shellMode = store.mode === "shell"

    if (!shellMode) {
      const atMatch = rawText.substring(0, cursorPosition).match(/@(\S*)$/)
      const slashMatch = rawText.match(/^\/(\S*)$/)

      if (atMatch) {
        atOnInput(atMatch[1])
        setStore("popover", "at")
      } else if (slashMatch) {
        slashOnInput(slashMatch[1])
        setStore("popover", "slash")
      } else {
        closePopover()
      }
    } else {
      closePopover()
    }

    resetHistoryNavigation()

    syncInputUndo([...rawParts, ...images], cursorPosition, prev)
    mirror.input = true
    prompt.set([...rawParts, ...images], cursorPosition)
    queueScroll()

    // Schedule model prediction after user stops typing (500ms debounce)
    schedulePrediction()
  }

  const addPart = (part: ContentPart) => {
    if (part.type === "image") return false

    const selection = window.getSelection()
    if (!selection) return false

    if (selection.rangeCount === 0 || !editorRef.contains(selection.anchorNode)) {
      editorRef.focus()
      const cursor = prompt.cursor() ?? promptLength(prompt.current())
      setCursorPosition(editorRef, cursor)
    }

    if (selection.rangeCount === 0) return false
    const range = selection.getRangeAt(0)
    if (!editorRef.contains(range.startContainer)) return false

    if (part.type === "file" || part.type === "agent") {
      const cursorPosition = getCursorPosition(editorRef)
      const rawText = prompt
        .current()
        .map((p) => ("content" in p ? p.content : ""))
        .join("")
      const textBeforeCursor = rawText.substring(0, cursorPosition)
      const atMatch = textBeforeCursor.match(/@(\S*)$/)
      const pill = createPill(part)
      const gap = document.createTextNode(" ")

      if (atMatch) {
        const start = atMatch.index ?? cursorPosition - atMatch[0].length
        setRangeEdge(editorRef, range, "start", start)
        setRangeEdge(editorRef, range, "end", cursorPosition)
      }

      range.deleteContents()
      range.insertNode(gap)
      range.insertNode(pill)
      range.setStartAfter(gap)
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
    }

    if (part.type === "text") {
      const fragment = createTextFragment(part.content)
      const last = fragment.lastChild
      range.deleteContents()
      range.insertNode(fragment)
      if (last) {
        if (last.nodeType === Node.TEXT_NODE) {
          const text = last.textContent ?? ""
          if (text === "\u200B") {
            range.setStart(last, 0)
          }
          if (text !== "\u200B") {
            range.setStart(last, text.length)
          }
        }
        if (last.nodeType !== Node.TEXT_NODE) {
          const isBreak = last.nodeType === Node.ELEMENT_NODE && (last as HTMLElement).tagName === "BR"
          const next = last.nextSibling
          const emptyText = next?.nodeType === Node.TEXT_NODE && (next.textContent ?? "") === ""
          if (isBreak && (!next || emptyText)) {
            const placeholder = next && emptyText ? next : document.createTextNode("\u200B")
            if (!next) last.parentNode?.insertBefore(placeholder, null)
            placeholder.textContent = "\u200B"
            range.setStart(placeholder, 1)
          } else {
            range.setStartAfter(last)
          }
        }
      }
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
    }

    handleInput()
    closePopover()
    return true
  }

  const addToHistory = (prompt: Prompt, mode: "normal" | "shell") => {
    const currentHistory = mode === "shell" ? shellHistory : history
    const setCurrentHistory = mode === "shell" ? setShellHistory : setHistory
    const next = prependHistoryEntry(currentHistory.entries, prompt, mode === "shell" ? [] : historyComments())
    if (next === currentHistory.entries) return
    setCurrentHistory("entries", next)
  }

  createEffect(
    on(
      () => props.edit?.id,
      (id) => {
        const edit = props.edit
        if (!id || !edit) return

        for (const item of prompt.context.items()) {
          prompt.context.remove(item.key)
        }

        for (const item of edit.context) {
          prompt.context.add({
            type: item.type,
            path: item.path,
            selection: item.selection,
            comment: item.comment,
            commentID: item.commentID,
            commentOrigin: item.commentOrigin,
            preview: item.preview,
          })
        }

        setStore("mode", "normal")
        setStore("popover", null)
        setStore("historyIndex", -1)
        setStore("savedPrompt", null)
        prompt.set(edit.prompt, promptLength(edit.prompt))
        resetInputUndo(edit.prompt, promptLength(edit.prompt))
        requestAnimationFrame(() => {
          editorRef.focus()
          setCursorPosition(editorRef, promptLength(edit.prompt))
          queueScroll()
        })
        props.onEditLoaded?.()
      },
      { defer: true },
    ),
  )

  const navigateHistory = (direction: "up" | "down") => {
    const result = navigatePromptHistory({
      direction,
      entries: store.mode === "shell" ? shellHistory.entries : history.entries,
      historyIndex: store.historyIndex,
      currentPrompt: prompt.current(),
      currentComments: historyComments(),
      savedPrompt: store.savedPrompt,
    })
    if (!result.handled) return false
    setStore("historyIndex", result.historyIndex)
    setStore("savedPrompt", result.savedPrompt)
    applyHistoryPrompt(result.entry, result.cursor)
    return true
  }

  const { addAttachments, removeAttachment, handlePaste } = createPromptAttachments({
    editor: () => editorRef,
    isDialogActive: () => !!dialog.active,
    setDraggingType: (type) => setStore("draggingType", type),
    focusEditor: () => {
      editorRef.focus()
      setCursorPosition(editorRef, promptLength(prompt.current()))
    },
    addPart,
    readClipboardImage: platform.readClipboardImage,
  })

  const { handlePairKeyDown } = createPromptPair({
    editor: () => editorRef,
    addPart,
  })

  const { settings: autocompleteSettings } = createAutocompleteSettings()

  const { ghostText, schedulePrediction, handleGhostKeyDown } = createModelAutocomplete({
    enabled: () => autocompleteSettings.enabled,
    predictionModel: () => autocompleteSettings.model,
    getCurrentPromptText: () =>
      prompt
        .current()
        .map((p) => ("content" in p ? p.content : ""))
        .join(""),
    addPart,
  })

  const apply = (raw: string, base: Prompt) => {
    const text = raw.replace(/\r\n?/g, "\n")
    const next = merge(text, base)
    const cursor = promptLength(next)
    closePopover()
    resetHistoryNavigation(true)
    syncInputUndo(next, cursor)
    prompt.set(next, cursor)
    queueScroll()
    schedulePrediction()
    setTimeout(() => {
      editorRef?.focus()
      setCursorPosition(editorRef, cursor)
      queueScroll()
    }, 120)
  }

  const insertTextAtCursor = (raw: string) => {
    const text = raw.replace(/\r\n?/g, "\n")
    if (!text) return
    const base = prompt.current()
    const baseValue = value(base)
    const cursor =
      editorRef && document.activeElement && editorRef.contains(document.activeElement)
        ? getCursorPosition(editorRef)
        : promptLength(base)
    const before = baseValue.slice(0, cursor)
    const after = baseValue.slice(cursor)
    const leadPad = before.length > 0 && !before.endsWith("\n") ? "\n" : ""
    const tailPad = after.length > 0 && !after.startsWith("\n") ? "\n" : ""
    const insertion = `${leadPad}${text}${tailPad}`
    const merged = `${before}${insertion}${after}`
    const next = merge(merged, base)
    const newCursor = cursor + insertion.length
    closePopover()
    resetHistoryNavigation(true)
    syncInputUndo(next, newCursor)
    prompt.set(next, newCursor)
    queueScroll()
    schedulePrediction()
    requestAnimationFrame(() => {
      editorRef?.focus()
      setCursorPosition(editorRef, newCursor)
      queueScroll()
    })
  }

  const buildSessionRefXml = (entry: SessionHistoryEntry) => {
    const xmlEscape = (s: string) =>
      s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    const project = (getFilename(entry.directory) || entry.directory || "").trim()
    const title = (entry.title ?? "").trim()
    return [
      "<opencode-session>",
      `  <project>${xmlEscape(project)}</project>`,
      `  <id>${xmlEscape(entry.id)}</id>`,
      `  <title>${xmlEscape(title)}</title>`,
      "</opencode-session>",
    ].join("\n")
  }

  const insertSessionRef = (entry: SessionHistoryEntry) => {
    insertTextAtCursor(buildSessionRefXml(entry))
  }

  const expand = () => {
    const base = prompt.current()
    dialog.show(() => (
      <DialogPromptEditor text={value(base)} placeholder={placeholder()} save={(text) => apply(text, base)} />
    ))
  }

  const accepting = createMemo(() => {
    const id = params.id
    if (!id) return false
    return permission.isAutoAccepting(id, sdk.directory)
  })
  const acceptLabel = createMemo(() =>
    language.t(accepting() ? "command.permissions.autoaccept.disable" : "command.permissions.autoaccept.enable"),
  )
  const toggleAccept = () => {
    if (!params.id) {
      permission.toggleAutoAcceptDirectory(sdk.directory)
      return
    }

    permission.toggleAutoAccept(params.id, sdk.directory)
  }
  const toggleRead = () => setPrefs("read", (v) => !v)

  const { abort, handleSubmit } = createPromptSubmit({
    info,
    imageAttachments,
    commentCount,
    autoAccept: accepting,
    mode: () => store.mode,
    working,
    editor: () => editorRef,
    queueScroll,
    promptLength,
    addToHistory,
    resetHistoryNavigation: () => {
      resetHistoryNavigation(true)
    },
    setMode: (mode) => setStore("mode", mode),
    setPopover: (popover) => setStore("popover", popover),
    resetInputUndo,
    newSessionWorktree: () => props.newSessionWorktree,
    onNewSessionWorktreeReset: props.onNewSessionWorktreeReset,
    shouldQueue: props.shouldQueue,
    onQueue: props.onQueue,
    onAbort: props.onAbort,
    onSubmit: props.onSubmit,
    onSubmitted: () => {
      setSubmit(true)
      props.onSubmitted?.()
    },
  })

  const handleKeyDown = (event: KeyboardEvent) => {
    const mod = event.metaKey || event.ctrlKey

    if (mod && !event.altKey && event.key.toLowerCase() === "z") {
      const dir = event.shiftKey ? "redo" : "undo"
      const next = stepInputUndo(inputUndo, dir)
      if (!next) return
      event.preventDefault()
      inputUndo = next.state
      applyInputUndoEntry(next.entry)
      return
    }

    if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "u") {
      event.preventDefault()
      if (store.mode !== "normal") return
      pick()
      return
    }

    if (event.key === "Backspace") {
      const selection = window.getSelection()
      if (selection && selection.isCollapsed) {
        const node = selection.anchorNode
        const offset = selection.anchorOffset
        if (node && node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent ?? ""
          if (/^\u200B+$/.test(text) && offset > 0) {
            const range = document.createRange()
            range.setStart(node, 0)
            range.collapse(true)
            selection.removeAllRanges()
            selection.addRange(range)
          }
        }
      }
    }

    // Ghost text: Tab accepts, Escape dismisses, any key dismisses
    // Must check before popover Tab handling so Tab can accept ghost text
    if (ghostText()) {
      handleGhostKeyDown(event)
      // If Tab was consumed by ghost text, stop here
      if (event.defaultPrevented) return
    }

    // Pair auto-completion - call before other key logic
    // The pair handler skips when metaKey/ctrlKey/altKey are held or IME is composing
    // It does NOT interfere with @, /, or ! triggers (those are not pair chars)
    if (!store.popover && store.mode !== "shell" && !isImeComposing(event)) {
      if (handlePairKeyDown(event)) return
    }

    if (event.key === "!" && store.mode === "normal") {
      const cursorPosition = getCursorPosition(editorRef)
      if (cursorPosition === 0) {
        setStore("mode", "shell")
        setStore("popover", null)
        event.preventDefault()
        return
      }
    }

    if (event.key === "Escape") {
      if (store.popover) {
        closePopover()
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (store.mode === "shell") {
        setStore("mode", "normal")
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (working()) {
        void abort()
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (escBlur()) {
        editorRef.blur()
        event.preventDefault()
        event.stopPropagation()
        return
      }
    }

    if (store.mode === "shell") {
      const { collapsed, cursorPosition, textLength } = getCaretState()
      if (event.key === "Backspace" && collapsed && cursorPosition === 0 && textLength === 0) {
        setStore("mode", "normal")
        event.preventDefault()
        return
      }
    }

    // Handle Shift+Enter BEFORE IME check - Shift+Enter is never used for IME input
    // and should always insert a newline regardless of composition state
    if (event.key === "Enter" && event.shiftKey) {
      addPart({ type: "text", content: "\n", start: 0, end: 0 })
      event.preventDefault()
      return
    }

    if (event.key === "Enter" && isImeComposing(event)) {
      return
    }

    const ctrl = event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey

    if (store.popover) {
      if (event.key === "Tab") {
        selectPopoverActive()
        event.preventDefault()
        return
      }
      const nav = event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "Enter"
      const ctrlNav = ctrl && (event.key === "n" || event.key === "p")
      if (nav || ctrlNav) {
        if (store.popover === "at") {
          atOnKeyDown(event)
          event.preventDefault()
          return
        }
        if (store.popover === "slash") {
          slashOnKeyDown(event)
        }
        event.preventDefault()
        return
      }
    }

    if (ctrl && event.code === "KeyG") {
      if (store.popover) {
        closePopover()
        event.preventDefault()
        return
      }
      if (working()) {
        void abort()
        event.preventDefault()
      }
      return
    }

    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      const hasModifier = event.ctrlKey || event.metaKey
      if (!hasModifier) return

      if (event.key === "ArrowUp") {
        if (navigateHistory("up")) {
          event.preventDefault()
        }
        return
      }

      if (navigateHistory("down")) {
        event.preventDefault()
      }
      return
    }

    // Note: Shift+Enter is handled earlier, before IME check
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      if (event.repeat) return
      if (
        working() &&
        prompt
          .current()
          .map((part) => ("content" in part ? part.content : ""))
          .join("")
          .trim().length === 0 &&
        imageAttachments().length === 0 &&
        commentCount() === 0
      ) {
        return
      }
      void handleSubmit(event)
    }
  }

  const variants = createMemo(() => ["default", ...local.model.variant.list()])
  const trace = dbg()
  const hover = { skipDelayDuration: 0 }

  const variantLabel = createMemo(() => {
    const defaultText = language.t("common.default")
    return (x: string) => x === "default" ? defaultText : x
  })

  return (
    <div class="relative size-full flex flex-col gap-0">
      {(promptReady(), null)}
      <PromptPopover
        popover={store.popover}
        setSlashPopoverRef={(el) => (slashPopoverRef = el)}
        atFlat={atFlat()}
        atActive={atActive() ?? undefined}
        atKey={atKey}
        setAtActive={setAtActive}
        onAtSelect={handleAtSelect}
        slashFlat={slashFlat()}
        slashActive={slashActive() ?? undefined}
        setSlashActive={setSlashActive}
        onSlashSelect={handleSlashSelect}
        commandKeybind={command.keybind}
        t={(key) => language.t(key as Parameters<typeof language.t>[0])}
      />
      <Show when={!read()}>
        <DockShellForm
          onSubmit={handleSubmit}
          data-slot="prompt-shell"
          style={glass()}
          classList={{
            "group/prompt-input": true,
            "prompt-shell-shadow": true,
            "border-icon-info-active border-dashed": store.draggingType !== null,
            [props.class ?? ""]: !!props.class,
          }}
        >
          <PromptDragOverlay
            type={store.draggingType}
            label={language.t(
              store.draggingType === "@mention" ? "prompt.dropzone.file.label" : "prompt.dropzone.label",
            )}
          />
          <PromptContextItems
            items={contextItems()}
            active={(item) => {
              const active = comments.active()
              return !!item.commentID && item.commentID === active?.id && item.path === active?.file
            }}
            openComment={openComment}
            remove={(item) => {
              if (item.commentID) comments.remove(item.path, item.commentID)
              prompt.context.remove(item.key)
            }}
            t={(key) => language.t(key as Parameters<typeof language.t>[0])}
          />
          <PromptImageAttachments
            attachments={imageAttachments()}
            onOpen={(attachment) =>
              dialog.show(() => <ImagePreview src={attachment.dataUrl} alt={attachment.filename} />)
            }
            onRemove={removeAttachment}
            removeLabel={language.t("prompt.attachment.remove")}
          />
          <div
            class="relative"
            onMouseDown={(e) => {
              const target = e.target
              if (!(target instanceof HTMLElement)) return
              if (
                target.closest(
                  '[data-action="prompt-attach"], [data-action="prompt-expand"], [data-action="prompt-submit"]',
                )
              ) {
                return
              }
              editorRef?.focus()
            }}
          >
            <div
              class="relative min-h-[144px] max-h-[280px] overflow-y-auto no-scrollbar"
              ref={(el) => (scrollRef = el)}
              style={{ "scroll-padding-bottom": space }}
            >
              <div
                data-component="prompt-input"
                ref={(el) => {
                  editorRef = el
                  props.ref?.(el)
                }}
                role="textbox"
                aria-multiline="true"
                aria-label={placeholder()}
                contenteditable="true"
                autocapitalize="off"
                autocorrect="off"
                spellcheck={false}
                onInput={handleInput}
                onPaste={handlePaste}
                onCompositionStart={handleCompositionStart}
                onCompositionEnd={handleCompositionEnd}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                classList={{
                  "select-text": true,
                  "w-full pl-4 pr-4 pt-3 text-14-regular text-text-strong focus:outline-none whitespace-pre-wrap": true,
                  "[&_[data-type=file]]:text-syntax-property": true,
                  "[&_[data-type=agent]]:text-syntax-type": true,
                  "font-mono!": true,
                }}
                style={{ "padding-bottom": space }}
              />
              <Show when={!prompt.dirty()}>
                <div
                  class="absolute top-0 inset-x-0 pl-4 pr-4 pt-3 text-14-regular text-text-weak pointer-events-none whitespace-nowrap truncate"
                  classList={{ "font-mono!": store.mode === "shell" }}
                  style={{ "padding-bottom": space }}
                >
                  {placeholder()}
                </div>
              </Show>
            </div>

            <div class="pointer-events-none absolute inset-x-3 bottom-3 flex items-end justify-end gap-3">
              <div class="pointer-events-auto flex items-center gap-2.5">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={ACCEPTED_FILE_TYPES.join(",")}
                  class="hidden"
                  onChange={(e) => {
                    const list = e.currentTarget.files
                    if (list) void addAttachments(Array.from(list))
                    e.currentTarget.value = ""
                  }}
                />

                <div
                  aria-hidden={store.mode !== "normal"}
                  class="flex items-center gap-2.5 transition-all duration-200 ease-out"
                  classList={{
                    "opacity-100 translate-y-0 scale-100 pointer-events-auto": store.mode === "normal",
                    "opacity-0 translate-y-2 scale-95 pointer-events-none": store.mode !== "normal",
                  }}
                >
                  <TooltipKeybind
                    {...hover}
                    placement="top"
                    title={language.t("prompt.action.attachFile")}
                    keybind={command.keybind("file.attach")}
                  >
                    <Button
                      data-action="prompt-attach"
                      type="button"
                      variant="ghost"
                      class="size-9 rounded-full p-0"
                      style={buttons()}
                      onClick={pick}
                      disabled={store.mode !== "normal"}
                      tabIndex={store.mode === "normal" ? undefined : -1}
                      aria-label={language.t("prompt.action.attachFile")}
                    >
                      <Icon name="plus" class="size-4.5" />
                    </Button>
                  </TooltipKeybind>
                  <Show when={platform.platform === "desktop"}>
                    <Tooltip {...hover} placement="top" value={language.t("prompt.action.expand")}>
                      <IconButton
                        data-action="prompt-expand"
                        type="button"
                        icon="expand"
                        variant="ghost"
                        class="size-9 rounded-full"
                        style={buttons()}
                        onClick={expand}
                        disabled={store.mode !== "normal"}
                        tabIndex={store.mode === "normal" ? undefined : -1}
                        aria-label={language.t("prompt.action.expand")}
                      />
                    </Tooltip>
                  </Show>
                  <Tooltip {...hover} placement="top" inactive={!prompt.dirty() && !working()} value={tip()}>
                    <IconButton
                      data-action="prompt-submit"
                      type="submit"
                      disabled={store.mode !== "normal" || (!prompt.dirty() && !working() && commentCount() === 0)}
                      tabIndex={store.mode === "normal" ? undefined : -1}
                      icon={working() ? "stop" : "arrow-up-bold"}
                      variant="primary"
                      iconSize={working() ? "normal" : "medium"}
                      class="size-10 rounded-full shadow-xs-border"
                      style={buttons()}
                      aria-label={working() ? language.t("prompt.action.stop") : language.t("prompt.action.send")}
                    />
                  </Tooltip>
                </div>
              </div>
            </div>
          </div>
        </DockShellForm>
      </Show>
      <Show when={store.mode === "normal" || store.mode === "shell"}>
        <DockTray attach="top">
          <div class="px-1.75 pt-5.5 pb-2 flex items-center gap-2 min-w-0">
            <div class="flex items-center gap-1.5 min-w-0 flex-1 relative">
              <div
                class="h-7 flex items-center gap-1.5 max-w-[160px] min-w-0 absolute inset-y-0 left-0"
                style={{
                  padding: "0 4px 0 8px",
                  ...shell(),
                }}
              >
                <span class="truncate text-13-medium text-text-strong">{language.t("prompt.mode.shell")}</span>
                <div class="size-4 shrink-0" />
              </div>
              <div class="flex items-center gap-1.5 min-w-0 flex-1">
                <Show
                  when={hasAgentChoose()}
                  fallback={
                    <>
                      <Show when={!hideAgentSelector()}>
                        <TooltipKeybind
                          {...hover}
                          placement="top"
                          gutter={4}
                          openDelay={promptTooltipDelay}
                          lazyExpand={true}
                          onOpenChange={
                            trace
                              ? (open) => {
                                  logPromptHover("agent-selector", open ? "tooltip-open" : "tooltip-close")
                                }
                              : undefined
                          }
                          title={language.t("command.agent.cycle")}
                          keybind={command.keybind("agent.cycle")}
                        >
                          <Select
                            debugName={trace ? "agent-selector" : undefined}
                            size="normal"
                            options={agentNames()}
                            current={local.agent.current()?.name ?? ""}
                            onSelect={local.agent.set}
                            class="prompt-pick prompt-agent capitalize"
                            valueClass="truncate"
                            triggerStyle={control()}
                            variant="ghost"
                            triggerProps={
                              trace
                                ? {
                                    onPointerEnter: (e: PointerEvent) =>
                                      logPromptHover("agent-selector", "pointer-enter", e),
                                    onPointerLeave: (e: PointerEvent) =>
                                      logPromptHover("agent-selector", "pointer-leave", e),
                                    onFocus: () => logPromptHover("agent-selector", "focus"),
                                    onBlur: () => logPromptHover("agent-selector", "blur"),
                                    onPointerDown: (e: PointerEvent) => uiPerfTriggerDown("agent-selector", e),
                                  }
                                : undefined
                            }
                            onOpenChange={
                              trace
                                ? (open) => {
                                    logPromptHover("agent-selector", open ? "select-open" : "select-close")
                                    logPromptOpen("agent-selector", {
                                      open,
                                      count: agentNames().length,
                                      current: local.agent.current()?.name ?? "none",
                                    })
                                    uiPerfOpen("agent-selector", open)
                                  }
                                : undefined
                            }
                          />
                        </TooltipKeybind>
                      </Show>
                      <Show
                        when={providers.paid().length > 0}
                        fallback={
                          <TooltipKeybind
                            {...hover}
                            placement="top"
                            gutter={4}
                            openDelay={promptTooltipDelay}
                            lazyExpand={true}
                            onOpenChange={
                              trace
                                ? (open) => {
                                    logPromptHover("model-selector-unpaid", open ? "tooltip-open" : "tooltip-close")
                                  }
                                : undefined
                            }
                            title={language.t("command.model.choose")}
                            keybind={command.keybind("model.choose")}
                          >
                            <Button
                              as="div"
                              variant="ghost"
                              size="normal"
                              class="prompt-pick min-w-0 max-w-[320px] group"
                              style={control()}
                              onPointerEnter={
                                trace
                                  ? (e: PointerEvent) => logPromptHover("model-selector-unpaid", "pointer-enter", e)
                                  : undefined
                              }
                              onPointerLeave={
                                trace
                                  ? (e: PointerEvent) => logPromptHover("model-selector-unpaid", "pointer-leave", e)
                                  : undefined
                              }
                              onFocus={trace ? () => logPromptHover("model-selector-unpaid", "focus") : undefined}
                              onBlur={trace ? () => logPromptHover("model-selector-unpaid", "blur") : undefined}
                              onClick={(e: MouseEvent) => {
                                logPromptHover("model-selector-unpaid", "click", e)
                                dialog.show(() => <DialogSelectModelUnpaid />)
                              }}
                            >
                              <Show when={local.model.current()?.provider?.id}>
                                <ProviderIcon
                                  id={local.model.current()!.provider.id}
                                  class="size-4 shrink-0 opacity-100"
                                />
                              </Show>
                              <span class="truncate">
                                {local.model.current()?.name ?? language.t("dialog.model.select.title")}
                              </span>
                              <Icon name="chevron-down" size="small" class="shrink-0" />
                            </Button>
                          </TooltipKeybind>
                        }
                      >
                        <TooltipKeybind
                          {...hover}
                          placement="top"
                          gutter={4}
                          openDelay={promptTooltipDelay}
                          lazyExpand={true}
                          onOpenChange={
                            trace
                              ? (open) => {
                                  logPromptHover("model-selector", open ? "tooltip-open" : "tooltip-close")
                                }
                              : undefined
                          }
                          title={language.t("command.model.choose")}
                          keybind={command.keybind("model.choose")}
                        >
                          <ModelSelectorPopover
                            debugName={trace ? "model-selector" : undefined}
                            triggerAs={Button}
                            triggerProps={{
                              variant: "ghost",
                              size: "normal",
                              style: control(),
                              class: "prompt-pick min-w-0 max-w-[320px] group",
                              ...(trace
                                ? {
                                    onPointerEnter: (e: PointerEvent) =>
                                      logPromptHover("model-selector", "pointer-enter", e),
                                    onPointerLeave: (e: PointerEvent) =>
                                      logPromptHover("model-selector", "pointer-leave", e),
                                    onFocus: () => logPromptHover("model-selector", "focus"),
                                    onBlur: () => logPromptHover("model-selector", "blur"),
                                    onPointerDown: (e: PointerEvent) => uiPerfTriggerDown("model-selector", e),
                                  }
                                : {}),
                            }}
                            onOpenChange={
                              trace
                                ? (open) => {
                                    logPromptHover("model-selector", open ? "popover-open" : "popover-close")
                                    const list = local.model.list()
                                    const visible = list.filter((item) =>
                                      local.model.visible({ modelID: item.id, providerID: item.provider.id }),
                                    )
                                    const providers = new Set(visible.map((item) => item.provider.id))
                                    logPromptOpen("model-selector", {
                                      open,
                                      total: list.length,
                                      visible: visible.length,
                                      providers: providers.size,
                                      current: local.model.current()?.id ?? "none",
                                      current_provider: local.model.current()?.provider?.id ?? "none",
                                    })
                                    uiPerfOpen("model-selector", open)
                                  }
                                : undefined
                            }
                          >
                            <Show when={local.model.current()?.provider?.id}>
                              <ProviderIcon
                                id={local.model.current()!.provider.id}
                                class="size-4 shrink-0 opacity-100"
                              />
                            </Show>
                            <span class="truncate">
                              {local.model.current()?.name ?? language.t("dialog.model.select.title")}
                            </span>
                            <Icon name="chevron-down" size="small" class="shrink-0" />
                          </ModelSelectorPopover>
                        </TooltipKeybind>
                      </Show>
                      <Show when={!hideVariantSelector()}>
                        <TooltipKeybind
                          {...hover}
                          placement="top"
                          gutter={4}
                          openDelay={promptTooltipDelay}
                          lazyExpand={true}
                          onOpenChange={
                            trace
                              ? (open) => {
                                  logPromptHover("variant-selector", open ? "tooltip-open" : "tooltip-close")
                                }
                              : undefined
                          }
                          title={language.t("command.model.variant.cycle")}
                          keybind={command.keybind("model.variant.cycle")}
                        >
                          <Select
                            size="normal"
                            options={variants()}
                            current={local.model.variant.current() ?? "default"}
                            label={variantLabel()}
                            onSelect={(x) => local.model.variant.set(x === "default" ? undefined : x)}
                            class="prompt-pick prompt-variant capitalize max-w-[160px]"
                            valueClass="truncate"
                            triggerStyle={control()}
                            variant="ghost"
                            triggerProps={
                              trace
                                ? {
                                    onPointerEnter: (e: PointerEvent) =>
                                      logPromptHover("variant-selector", "pointer-enter", e),
                                    onPointerLeave: (e: PointerEvent) =>
                                      logPromptHover("variant-selector", "pointer-leave", e),
                                    onFocus: () => logPromptHover("variant-selector", "focus"),
                                    onBlur: () => logPromptHover("variant-selector", "blur"),
                                  }
                                : undefined
                            }
                            onOpenChange={
                              trace
                                ? (open) => {
                                    logPromptHover("variant-selector", open ? "select-open" : "select-close")
                                  }
                                : undefined
                            }
                          />
                        </TooltipKeybind>
                      </Show>
                    </>
                  }
                >
                  <div class="flex items-center gap-1.5 min-w-0">
                    <Button
                      as="div"
                      variant="ghost"
                      size="normal"
                      class="prompt-pick min-w-0 max-w-[160px]"
                      style={control()}
                    >
                      <span class="truncate">OpenClaw</span>
                    </Button>
                    <Button
                      as="div"
                      variant="ghost"
                      size="normal"
                      class="prompt-pick min-w-0 max-w-[220px]"
                      style={control()}
                    >
                      <span class="truncate">Claw</span>
                    </Button>
                  </div>
                </Show>
                <GitContext />
                <TooltipKeybind
                  {...hover}
                  placement="top"
                  gutter={8}
                  title={acceptLabel()}
                  keybind={command.keybind("permissions.autoaccept")}
                >
                  <Button
                    data-action="prompt-permissions"
                    variant="ghost"
                    onClick={toggleAccept}
                    classList={{
                      "h-7 w-7 p-0 shrink-0 flex items-center justify-center": true,
                      "text-text-base": !accepting(),
                      "hover:bg-surface-success-base": accepting(),
                    }}
                    style={control()}
                    aria-label={acceptLabel()}
                    aria-pressed={accepting()}
                  >
                    <Icon name="shield" size="small" classList={{ "text-icon-success-base": accepting() }} />
                  </Button>
                </TooltipKeybind>
                <Tooltip {...hover} placement="top" value={language.t("session.read")}>
                  <IconButton
                    data-action="prompt-read"
                    type="button"
                    icon="read"
                    variant="ghost"
                    class="size-7 shrink-0"
                    iconSize="normal"
                    style={control()}
                    onClick={toggleRead}
                    aria-label={language.t("session.read")}
                    aria-pressed={read()}
                  />
                </Tooltip>
                <Show when={!!extraAgentIntegration()}>
                  <Tooltip {...hover} placement="top" value={language.t("prompt.action.insertSession")}>
                    <SessionPickerPopover
                      onSelect={insertSessionRef}
                      ariaLabel={language.t("prompt.action.insertSession")}
                      headerText={language.t("prompt.session.menuTitle")}
                      emptyText={language.t("prompt.session.empty")}
                      triggerStyle={control()}
                      placement="top-end"
                    />
                  </Tooltip>
                </Show>
              </div>
            </div>
          </DockShellForm>
          <Show when={store.mode === "normal" || store.mode === "shell"}>
            <DockTray attach="top">
              <div class="px-1.75 pt-5.5 pb-2 flex items-center gap-2 min-w-0">
                <div class="flex items-center gap-1.5 min-w-0 flex-1 relative">
                  <div
                    class="h-7 flex items-center gap-1.5 min-w-0 absolute inset-0"
                    style={{
                      padding: "0 0px 0 8px",
                      ...shell(),
                    }}
                  >
                    <Icon name="console" />
                    <span class="truncate text-13-medium text-text-base">{language.t("prompt.mode.shell")}</span>
                    <div class="flex-1" />
                    <Button
                      variant="ghost"
                      class="text-text-base"
                      onClick={() => {
                        setStore("mode", "normal")
                      }}
                    >
                      {language.t("common.cancel")}
                    </Button>
                  </div>
                  <div class="flex items-center gap-1.5 min-w-0 flex-1 h-7">
                    <Show when={!agentsLoading()}>
                      <div
                        data-component="prompt-agent-control"
                        style={agentsShouldFadeIn() ? { animation: "fade-in 0.3s" } : undefined}
                      >
                        <TooltipKeybind
                          placement="top"
                          gutter={4}
                          title={language.t("command.agent.cycle")}
                          keybind={command.keybind("agent.cycle")}
                        >
                          <Select
                            size="normal"
                            options={agentNames()}
                            current={local.agent.current()?.name ?? ""}
                            onSelect={(value) => {
                              local.agent.set(value)
                              restoreFocus()
                            }}
                            class="capitalize max-w-[160px] text-text-base"
                            valueClass="truncate text-13-regular text-text-base"
                            triggerStyle={control()}
                            triggerProps={{ "data-action": "prompt-agent" }}
                            variant="ghost"
                          />
                        </TooltipKeybind>
                      </div>
                    </Show>
                    <Show when={!providersLoading()}>
                      <Show when={store.mode !== "shell"}>
                        <div
                          data-component="prompt-model-control"
                          style={providersShouldFadeIn() ? { animation: "fade-in 0.3s" } : undefined}
                        >
                          <Show
                            when={providers.paid().length > 0}
                            fallback={
                              <TooltipKeybind
                                placement="top"
                                gutter={4}
                                title={language.t("command.model.choose")}
                                keybind={command.keybind("model.choose")}
                              >
                                <Button
                                  data-action="prompt-model"
                                  as="div"
                                  variant="ghost"
                                  size="normal"
                                  class="min-w-0 max-w-[320px] text-13-regular text-text-base group"
                                  style={control()}
                                  onClick={() => {
                                    void import("@/components/dialog-select-model-unpaid").then((x) => {
                                      dialog.show(() => <x.DialogSelectModelUnpaid model={local.model} />)
                                    })
                                  }}
                                >
                                  <Show when={local.model.current()?.provider?.id}>
                                    <ProviderIcon
                                      id={local.model.current()?.provider?.id ?? ""}
                                      class="size-4 shrink-0 opacity-40 group-hover:opacity-100 transition-opacity duration-150"
                                      style={{ "will-change": "opacity", transform: "translateZ(0)" }}
                                    />
                                  </Show>
                                  <span class="truncate">
                                    {local.model.current()?.name ?? language.t("dialog.model.select.title")}
                                  </span>
                                  <Icon name="chevron-down" size="small" class="shrink-0" />
                                </Button>
                              </TooltipKeybind>
                            }
                          >
                            <TooltipKeybind
                              placement="top"
                              gutter={4}
                              title={language.t("command.model.choose")}
                              keybind={command.keybind("model.choose")}
                            >
                              <ModelSelectorPopover
                                model={local.model}
                                triggerAs={Button}
                                triggerProps={{
                                  variant: "ghost",
                                  size: "normal",
                                  style: control(),
                                  class: "min-w-0 max-w-[320px] text-13-regular text-text-base group",
                                  "data-action": "prompt-model",
                                }}
                                onClose={restoreFocus}
                              >
                                <Show when={local.model.current()?.provider?.id}>
                                  <ProviderIcon
                                    id={local.model.current()?.provider?.id ?? ""}
                                    class="size-4 shrink-0 opacity-40 group-hover:opacity-100 transition-opacity duration-150"
                                    style={{ "will-change": "opacity", transform: "translateZ(0)" }}
                                  />
                                </Show>
                                <span class="truncate">
                                  {local.model.current()?.name ?? language.t("dialog.model.select.title")}
                                </span>
                                <Icon name="chevron-down" size="small" class="shrink-0" />
                              </ModelSelectorPopover>
                            </TooltipKeybind>
                          </Show>
                        </div>
                        <Show when={variants().length > 2}>
                          <div
                            data-component="prompt-variant-control"
                            style={providersShouldFadeIn() ? { animation: "fade-in 0.3s" } : undefined}
                          >
                            <TooltipKeybind
                              placement="top"
                              gutter={4}
                              title={language.t("command.model.variant.cycle")}
                              keybind={command.keybind("model.variant.cycle")}
                            >
                              <Select
                                size="normal"
                                options={variants()}
                                current={local.model.variant.current() ?? "default"}
                                label={(x) => (x === "default" ? language.t("common.default") : x)}
                                onSelect={(value) => {
                                  local.model.variant.set(value === "default" ? undefined : value)
                                  restoreFocus()
                                }}
                                class="capitalize max-w-[160px] text-text-base"
                                valueClass="truncate text-13-regular text-text-base"
                                triggerStyle={control()}
                                triggerProps={{ "data-action": "prompt-model-variant" }}
                                variant="ghost"
                              />
                            </TooltipKeybind>
                          </div>
                        </Show>
                      </Show>
                    </Show>
                  </div>
                </div>
              </div>
            </DockTray>
          </Show>
        </Match>
      </Switch>
    </div>
  )
}
