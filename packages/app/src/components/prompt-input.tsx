import { useFilteredList } from "@opencode-ai/ui/hooks"
import { useSpring } from "@opencode-ai/ui/motion-spring"
import { createEffect, on, Component, Show, onCleanup, onMount, createMemo, createSignal } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/util/encode"
import { Binary } from "@opencode-ai/util/binary"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { createStore } from "solid-js/store"
import { useLocal } from "@/context/local"
import { selectionFromLines, type SelectedLineRange, useFile } from "@/context/file"
import {
  ContentPart,
  DEFAULT_PROMPT,
  isLineContextItem,
  isPromptEqual,
  Prompt,
  usePrompt,
  ImageAttachmentPart,
  AgentPart,
  FileAttachmentPart,
} from "@/context/prompt"
import { useLayout } from "@/context/layout"
import { useSDK } from "@/context/sdk"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useSync } from "@/context/sync"
import { useComments } from "@/context/comments"
import { Button } from "@opencode-ai/ui/button"
import { DockShellForm, DockTray } from "@opencode-ai/ui/dock-surface"
import { Icon } from "@opencode-ai/ui/icon"
import { showToast } from "@opencode-ai/ui/toast"
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
import { usePromptDocBridge } from "@/context/prompt-doc-bridge"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useClientEnv } from "@/context/client-env"
import { useParentParams } from "@/context/parent-params"
import { useSessionLayout } from "@/pages/session/session-layout"
import { createOpenDiffTab, createSessionTabs } from "@/pages/session/helpers"
import { promptEnabled, promptProbe } from "@/testing/prompt"
import { createTextFragment, getCursorPosition, setCursorPosition, setRangeEdge } from "./prompt-input/editor-dom"
import { createPromptAttachments } from "./prompt-input/attachments"
import { captureDisplayImage } from "./prompt-input/capture"
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
import { clearAfterQueue } from "./prompt-input/composer-submit"
import {
  followupShouldQueue,
  NON_EMPTY_TEXT,
  promptHasDraft,
  sessionBusy,
  submitIntent,
  type FollowupMode,
} from "./prompt-input/composer-state"
import { createPromptSubmit, type FollowupDraft } from "./prompt-input/submit"
import { PromptPopover, type AtOption, type SlashCommand } from "./prompt-input/slash-popover"
import { PromptContextItems } from "./prompt-input/context-items"
import { PromptImageAttachments } from "./prompt-input/image-attachments"
import { PromptDragOverlay } from "./prompt-input/drag-overlay"
import { promptPlaceholder } from "./prompt-input/placeholder"
import { promptFromDocMarkdown } from "@/components/prompt-input/prompt-plain"
import { PromptDocShell } from "./prompt-input/doc-shell"
import { createPromptDoc } from "./prompt-input/doc"
import { createOpenSessionFile } from "./prompt-input/open-session-file"
import { lineRefToSelection } from "@/components/blocksuite/line-reference-url"
import { createPromptContextSync } from "./prompt-input/context-sync"
import { connectSubmit, respondSubmit, startSubmit, startStopSubmit, type DocSubmitState } from "./prompt-input/doc-submit"
import { DialogDocSubmit } from "./doc-submit/dialog-doc-submit"
import { ImagePreview } from "@opencode-ai/ui/image-preview"

interface PromptInputProps {
  class?: string
  ref?: (el: HTMLDivElement) => void
  expanded?: boolean
  onComposerExpand?: (opts?: { initialScale?: number }) => void
  onComposerCollapse?: () => void
  composerShell?: {
    size: number
    min: number
    max: number
    onResize: (height: number) => void
  }
  newSessionWorktree?: string
  onNewSessionWorktreeReset?: () => void
  edit?: { id: string; prompt: Prompt; context: FollowupDraft["context"] }
  onEditLoaded?: () => void
  followupMode?: FollowupMode
  onQueue?: (draft: FollowupDraft) => void
  onAbort?: () => void
  onSubmit?: () => void
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

const promptTriggersOff = import.meta.env.VITE_DISABLE_PROMPT_TRIGGERS === "true"
const permissionsOff = import.meta.env.VITE_DISABLE_PROMPT_PERMISSIONS === "true"
const footerOff = import.meta.env.VITE_DISABLE_PROMPT_FOOTER === "true"
const wysiwygOnly = import.meta.env.VITE_DISABLE_WYSIWYG_ONLY === "true"

type PromptMode = "normal" | "shell" | "doc"

const canvasMode = (mode: PromptMode) => mode === "doc"
const DOC_MIN = 150
const DOC_HEIGHT = 300
const DOC_RATIO = 0.8
// 자동 확대: 입력창 포커스 시 기존 '확대(전체 너비 expanded)'로 자동 진입할지 여부. localStorage 영속.
const AUTO_EXPAND_KEY = "prompt.doc.autoExpand"

export const PromptInput: Component<PromptInputProps> = (props) => {
  const sdk = useSDK()
  const navigate = useNavigate()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const sync = useSync()
  const local = useLocal()
  const files = useFile()
  const prompt = usePrompt()
  const layout = useLayout()
  const env = useClientEnv()
  const comments = useComments()
  const dialog = useDialog()
  const providers = useProviders()
  const command = useCommand()
  const permission = usePermission()
  const language = useLanguage()
  const platform = usePlatform()
  const { params, tabs, view } = useSessionLayout()
  let editorRef!: HTMLDivElement
  let fileInputRef: HTMLInputElement | undefined
  let scrollRef!: HTMLDivElement
  let slashPopoverRef!: HTMLDivElement
  let rootRef: HTMLDivElement | undefined
  let pending: Promise<string | undefined> | undefined

  const mirror = { input: false }
  const inset = 56
  const space = `${inset}px`

  const composerExpand = () => {
    if (!props.onComposerExpand || !props.onComposerCollapse) return
    return {
      expanded: !!props.expanded,
      onExpand: props.onComposerExpand,
      onCollapse: props.onComposerCollapse,
    }
  }

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
    pathFromTab: (tab) => files.pathFromTab(tab) ?? files.pathFromDiffTab(tab),
    normalizeTab: (tab) => {
      if (tab.startsWith("file://")) return files.tab(tab)
      if (tab.startsWith("diff://")) {
        const path = files.pathFromDiffTab(tab)
        if (path) return files.diffTab(path)
      }
      return tab
    },
  }).activeFileTab

  const openDiffTab = createOpenDiffTab({
    tabForPath: files.diffTab,
    openTab: tabs().open,
    setActive: tabs().setActive,
    openReviewPanel: () => {
      if (!view().reviewPanel.opened()) view().reviewPanel.open()
    },
  })

  const commentInReview = (path: string) => {
    const sessionID = params.id
    if (!sessionID) return false

    const diffs = sync.data.session_diff[sessionID]
    if (!diffs) return false
    return diffs.some((diff) => diff.file === path)
  }

  const openSessionFile = createOpenSessionFile({
    commentInReview,
    productionLayout: env.productionLayout,
    reviewPanel: view().reviewPanel,
    fileTree: layout.fileTree,
    tabs: tabs(),
    tabForPath: files.tab,
    openDiffTab,
    normalizePath: files.normalize,
    expandTree: files.tree.expand,
    loadFile: files.load,
    setSelectedLines: files.setSelectedLines,
    setCommentActive: comments.setActive,
    setCommentFocus: comments.setFocus,
    commentFocus: comments.focus,
  })

  const openComment = (item: { path: string; commentID?: string; commentOrigin?: "review" | "file" }) => {
    if (!item.commentID) return
    openSessionFile({
      path: item.path,
      origin: item.commentOrigin,
      commentFocus: { file: item.path, id: item.commentID },
    })
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
  const working = createMemo(() => {
    const id = params.id
    return sessionBusy(status(), id ? sync.data.message[id] : undefined)
  })
  const imageAttachments = createMemo(() =>
    prompt.current().filter((part): part is ImageAttachmentPart => part.type === "image"),
  )

  const [store, setStore] = createStore<{
    popover: "at" | "slash" | null
    historyIndex: number
    savedPrompt: PromptHistoryEntry | null
    placeholder: number
    draggingType: "image" | "@mention" | null
    mode: PromptMode
    applyingHistory: boolean
  }>({
    popover: null,
    historyIndex: -1,
    savedPrompt: null as PromptHistoryEntry | null,
    placeholder: Math.floor(Math.random() * EXAMPLES.length),
    draggingType: null,
    mode: "doc",
    applyingHistory: false,
  })
  const [height, setHeight] = createSignal(DOC_HEIGHT)
  // 자동 확대: 입력창 포커스 시 전체 너비 expanded 로 자동 진입(기본 ON, localStorage 영속).
  const [autoExpand, setAutoExpand] = createSignal(
    (() => {
      try {
        return localStorage.getItem(AUTO_EXPAND_KEY) !== "0"
      } catch {
        return true
      }
    })(),
  )
  const [focusWithin, setFocusWithin] = createSignal(false)
  // 탭 캡처 진행 중 여부. 아래 자동 확대 이펙트가 이 값을 보고 캡처 동안 입력창을 강제 축소한다.
  const [capturing, setCapturing] = createSignal(false)
  // 컴포저 내부에서 시작된 클릭(포커스 못 받는 버튼/컨트롤 포함)으로 포커스가 body 로 빠지는 걸
  // '이탈'로 오인해 축소→재확장 깜빡이는 걸 막기 위한 플래그.
  let pointerDownInside = false
  // 마운트 시 에디터가 자동 포커스되어도 곧바로 확대되지 않도록, 실제 사용자 상호작용 이후에만 자동 확대.
  const [interacted, setInteracted] = createSignal(false)
  const toggleAutoExpand = () => {
    const next = !autoExpand()
    setAutoExpand(next)
    try {
      localStorage.setItem(AUTO_EXPAND_KEY, next ? "1" : "0")
    } catch {}
    // 토글만으로는 현재 확대/축소 상태를 바꾸지 않는다 — 끄면 그 상태 그대로 둔 채 자동 동작만 멈춘다.
  }
  // 자동 확대 ON 이면 포커스 상태를 expanded 에 반영. OFF면 무조건 축소(collapse) 모드로 강제한다.
  createEffect(() => {
    if (!props.onComposerExpand || !props.onComposerCollapse) return
    // 탭 캡처 중엔 확대된 입력창이 캡처 화면을 가리므로 강제로 축소하고, 캡처가 완전히 끝날
    // 때까지 재확대를 막는다. 끝나면(capturing=false) 아래 포커스 기준 로직이 원래 상태로 되돌린다.
    if (capturing()) {
      if (props.expanded) props.onComposerCollapse()
      return
    }
    if (!autoExpand()) {
      if (props.expanded) props.onComposerCollapse()
      return
    }
    if (focusWithin() && interacted() && !props.expanded) props.onComposerExpand({ initialScale: 2 })
    else if (!focusWithin() && props.expanded) props.onComposerCollapse()
  })
  onMount(() => {
    const el = rootRef
    if (!el) return
    // 에디터 본문(prompt-doc) 클릭/타이핑만 '상호작용'으로 친다 — 리사이즈 핸들·액션바 버튼은
    // 제외해, 마운트 자동 포커스 상태에서 작은 입력창 높이 조절(핸들 드래그)이 확대를 유발하지 않게.
    const mark = (e: Event) => {
      const t = e.target
      if (t instanceof Element && t.closest('[data-component="prompt-doc"]')) setInteracted(true)
    }
    // 컴포저 내부에서 시작된 클릭인지 기록. 포커스 못 받는 컨트롤을 눌러 포커스가 body 로 빠져도
    // 이 플래그가 있으면 focusout 에서 '이탈'로 보지 않는다. 키 입력(Tab 이동 등)이 시작되면 해제해
    // 실제 포커스 위치 기준으로 판단하게 한다.
    const trackPointer = (e: PointerEvent) => {
      const t = e.target
      pointerDownInside = t instanceof Node && el.contains(t)
    }
    const clearPointer = () => {
      pointerDownInside = false
    }
    // doc 패널이 pointerdown 전파를 막으므로 캡처 단계로 듣는다.
    el.addEventListener("pointerdown", mark, true)
    el.addEventListener("keydown", mark, true)
    // 컴포저 밖 클릭도 잡아야 하므로 window 캡처로 듣는다.
    window.addEventListener("pointerdown", trackPointer, true)
    el.addEventListener("keydown", clearPointer, true)
    onCleanup(() => {
      el.removeEventListener("pointerdown", mark, true)
      el.removeEventListener("keydown", mark, true)
      window.removeEventListener("pointerdown", trackPointer, true)
      el.removeEventListener("keydown", clearPointer, true)
    })
  })

  const seed = (info: Session) => {
    const [, setStore] = globalSync.child(sdk.directory)
    setStore("session", (list: Session[]) => {
      const result = Binary.search(list, info.id, (item) => item.id)
      const next = [...list]
      if (result.found) {
        next[result.index] = info
        return next
      }
      next.splice(result.index, 0, info)
      return next
    })
  }

  const ensure = async () => {
    if (params.id) return params.id
    if (pending) return pending
    pending = sdk.client.session
      .create()
      .then((res) => {
        const info = res.data
        if (!info) return undefined
        seed(info)
        if (accepting()) permission.enableAutoAccept(info.id, sdk.directory)
        local.session.promote(sdk.directory, info.id)
        layout.handoff.setTabs(base64Encode(sdk.directory), info.id)
        navigate(`/${base64Encode(sdk.directory)}/session/${info.id}`)
        return info.id
      })
      .catch(() => {
        showToast({
          title: language.t("prompt.toast.sessionCreateFailed.title"),
          description: language.t("common.requestFailed"),
        })
        return undefined
      })
      .finally(() => {
        pending = undefined
      })
    return pending
  }

  const max = () => Math.max(DOC_MIN, Math.floor(window.innerHeight * DOC_RATIO))
  const clamp = (value: number) => Math.min(max(), Math.max(DOC_MIN, value))
  const fit = () => {
    if (store.mode !== "doc") return
    setHeight((value) => clamp(value))
  }
  const shellResize = (event: PointerEvent & { currentTarget: HTMLDivElement }) => {
    const bounds = props.composerShell
    if (!bounds || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()

    const start = bounds.size
    const y = event.clientY
    const html = document.documentElement
    const body = document.body
    const cursor = html.style.cursor
    const select = body.style.userSelect
    html.style.cursor = "ns-resize"
    body.style.userSelect = "none"

    const clamp = (value: number) => Math.min(bounds.max, Math.max(bounds.min, value))
    const move = (event: PointerEvent) => {
      bounds.onResize(clamp(start + y - event.clientY))
    }
    const up = () => {
      html.style.cursor = cursor
      body.style.userSelect = select
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", up)
    }

    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    window.addEventListener("pointercancel", up)
  }

  const resize = (event: PointerEvent & { currentTarget: HTMLDivElement }) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()

    const start = height()
    const y = event.clientY
    const html = document.documentElement
    const body = document.body
    const cursor = html.style.cursor
    const select = body.style.userSelect
    html.style.cursor = "ns-resize"
    body.style.userSelect = "none"

    const move = (event: PointerEvent) => {
      setHeight(clamp(start + y - event.clientY))
    }
    const up = () => {
      html.style.cursor = cursor
      body.style.userSelect = select
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", up)
    }

    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    window.addEventListener("pointercancel", up)
  }

  window.addEventListener("resize", fit)
  onCleanup(() => window.removeEventListener("resize", fit))
  createEffect(fit)

  const buttonsSpring = useSpring(() => (store.mode === "shell" ? 0 : 1), { visualDuration: 0.2, bounce: 0 })
  const motion = (value: number) => ({
    opacity: value,
    transform: `scale(${0.95 + value * 0.05})`,
    filter: `blur(${(1 - value) * 2}px)`,
    "pointer-events": value > 0.5 ? ("auto" as const) : ("none" as const),
  })
  const buttons = createMemo(() => motion(buttonsSpring()))
  const submitStyle = createMemo(() => (canvasMode(store.mode) ? motion(1) : buttons()))
  const shell = createMemo(() => motion(1 - buttonsSpring()))
  const control = createMemo(() => ({ height: "28px", ...buttons() }))

  const commentCount = createMemo(() => {
    if (store.mode !== "normal") return 0
    return prompt.context.items().filter((item) => !!item.comment?.trim()).length
  })

  const parentParams = useParentParams()
  const doc = createPromptDoc({
    sessionID: () => params.id,
    url: () => sdk.url,
    directory: () => sdk.directory,
    client: sdk.client,
    submit: () => void submit(),
    user: () => parentParams.user[0],
  })
  // detach() keeps the doc handle (sync + undo history) alive across panel unmounts, so the
  // component itself owns the final teardown.
  onCleanup(() => doc.dispose())

  const bridge = usePromptDocBridge()
  createEffect(() => {
    bridge.setMode(store.mode)
  })
  const relPath = (path: string) => {
    const dir = sdk.directory.replace(/\/+$/, "")
    if (path.startsWith(dir) && (path === dir || path[dir.length] === "/")) {
      return path.slice(dir.length).replace(/^\/+/, "")
    }
    return path
  }

  createEffect(() => {
    bridge.setAddReference((path, nodeType) => {
      if (store.mode !== "doc") return false
      return doc.addReference(relPath(path), nodeType ?? "file")
    })
    bridge.setAddLineReference((input) => {
      if (store.mode !== "doc") return false
      const range = input.selection
      return doc.addLineReference({
        path: relPath(input.path),
        start: range.start,
        end: range.end,
        side: range.side,
        endSide: range.endSide,
        additionStart: range.additionStart,
        additionEnd: range.additionEnd,
        deletionStart: range.deletionStart,
        deletionEnd: range.deletionEnd,
        label: input.label,
        comment: input.comment,
        preview: input.preview,
      })
    })
    bridge.setOpenLineReference((input) => {
      if (store.mode !== "doc") return false
      openSessionFile({ path: input.path, selection: lineRefToSelection(input) })
      return true
    })
    bridge.setOpenFileReference((path, nodeType) => {
      if (store.mode !== "doc") return false
      openSessionFile({ path: relPath(path), nodeType: nodeType === "directory" ? "directory" : "file" })
      return true
    })
    onCleanup(() => {
      bridge.setAddReference(undefined)
      bridge.setAddLineReference(undefined)
      bridge.setOpenLineReference(undefined)
      bridge.setOpenFileReference(undefined)
      bridge.setMode("normal")
    })
  })

  const hasDraft = createMemo(() => {
    if (store.mode === "doc") return doc.filled()
    if (imageAttachments().length > 0 || commentCount() > 0) return true
    if (!prompt.dirty()) return false
    return promptHasDraft(prompt.current())
  })
  const mode = () => props.followupMode ?? "none"
  const submitAction = createMemo(() => submitIntent(working(), hasDraft(), mode()))
  const submitIcon = createMemo(() => {
    if (submitAction() === "stop") return "stop" as const
    return "arrow-up-bold" as const
  })
  const submitLabel = createMemo(() => {
    const action = submitAction()
    if (action === "queue") return language.t("prompt.action.queue")
    if (action === "stop") return language.t("prompt.action.stop")
    return language.t("prompt.action.send")
  })
  const tip = createMemo(() => {
    const action = submitAction()
    if (action === "stop") {
      return (
        <div class="flex items-center gap-2">
          <span>{language.t("prompt.action.stop")}</span>
          <span class="text-icon-base text-12-medium text-[10px]!">{language.t("common.key.esc")}</span>
        </div>
      )
    }

    if (action === "queue") {
      return (
        <div class="flex items-center gap-2">
          <span>{language.t("prompt.action.queue")}</span>
          <Icon name="enter" size="small" class="text-icon-base" />
        </div>
      )
    }

    if (store.mode === "doc") {
      return (
        <div class="flex items-center gap-2">
          <span>{language.t("prompt.action.send")}</span>
          <span class="text-icon-base text-12-medium text-[10px]!">{language.t("common.key.shift")}</span>
          <Icon name="enter" size="small" class="text-icon-base" />
        </div>
      )
    }

    return (
      <div class="flex items-center gap-2">
        <span>{language.t("prompt.action.send")}</span>
        <Icon name="enter" size="small" class="text-icon-base" />
      </div>
    )
  })

  createPromptContextSync({
    sync: doc.sync,
    comments: comments.all,
    context: prompt.context,
    replace: comments.replace,
  })
  const [approval, setApproval] = createSignal<DocSubmitState | undefined>()
  let approvalID: string | undefined
  let finalizedID: string | undefined
  let approvalSession: string | undefined

  const approvalActor = () => doc.actorID()
  const clearContext = () => {
    for (const item of prompt.context.items()) {
      prompt.context.remove(item.key)
    }
  }
  const closeApproval = () => {
    dialog.close()
    approvalID = undefined
    setApproval(undefined)
  }
  const showApproval = (state: DocSubmitState) => {
    const actorID = approvalActor()
    if (!actorID) return
    if (!state.actors.some((item) => item.actorID === actorID)) return
    // Terminal states are handled exactly once per submit: a server replay on reconnect (or a
    // duplicate cast) for an already-resolved submit must not re-clear context or re-open a dialog.
    if (state.status !== "pending") {
      if (finalizedID === state.submitID) return
      finalizedID = state.submitID
      // A 'stop' vote shows no terminal screen — any resolution just closes. Stopping the response
      // and the response finishing on its own are the same end state, so there's nothing to show:
      // on approval the server already cancelled the run; a reject/expire simply does nothing.
      if (state.targetKind === "stop") {
        if (approvalID === state.submitID) closeApproval()
        return
      }
    }
    if (state.status === "sent") {
      clearContext()
      if (approvalID === state.submitID) closeApproval()
      return
    }
    setApproval(state)
    if (approvalID === state.submitID) return
    approvalID = state.submitID
    dialog.show(
      () => (
        <DialogDocSubmit
          state={approval}
          actorID={actorID}
          kind={approval()?.targetKind === "stop" ? "stop" : "doc"}
          approve={() => {
            const current = approval()
            if (!current) return
            void respondSubmit({
              baseUrl: sdk.url,
              directory: sdk.directory,
              sessionID: current.sessionID,
              submitID: current.submitID,
              actorID,
              action: "approve",
            })
              .then(setApproval)
              .catch(() =>
                showToast({
                  title: "전송 동의 실패",
                  description: language.t("common.requestFailed"),
                }),
              )
          }}
          cancel={() => {
            const current = approval()
            if (!current) return
            void respondSubmit({
              baseUrl: sdk.url,
              directory: sdk.directory,
              sessionID: current.sessionID,
              submitID: current.submitID,
              actorID,
              action: "cancel",
            })
              .then(setApproval)
              .catch(() =>
                showToast({
                  title: "전송 동의 취소 실패",
                  description: language.t("common.requestFailed"),
                }),
              )
          }}
          close={closeApproval}
        />
      ),
      () => {
        const current = approval()
        if (current?.status === "pending") {
          approvalID = undefined
          window.setTimeout(() => {
            const next = approval()
            if (next?.status === "pending") showApproval(next)
          }, 120)
          return
        }
        approvalID = undefined
        setApproval(undefined)
      },
    )
  }

  createEffect((prev) => {
    const id = params.id
    if (prev === id) return id
    doc.reset()
    return id
  })

  createEffect(() => {
    const id = params.id
    if (!id) return
    void doc.refresh(id)
  })

  createEffect(() => {
    const sessionID = params.id
    const docID = doc.docID()
    const actorID = doc.actorID()
    if (store.mode !== "doc" || !sessionID || !docID || !actorID) return
    const stop = connectSubmit({
      baseUrl: sdk.url,
      directory: sdk.directory,
      sessionID,
      docID,
      actorID,
      event: (event) => showApproval(event.state),
    })
    onCleanup(stop)
  })

  createEffect(() => {
    const id = params.id
    if (!id) return
    void globalSDK.event.start()
    const unsub = globalSDK.event.on(sdk.directory, (event) => {
      const item = event as {
        type: string
        properties: { sessionID: string; docID: string; clientID?: string; init?: boolean }
      }
      if (item.type !== "doc.prompt.rotated") return
      const props = item.properties
      if (props.sessionID !== id) return
      if (props.clientID === doc.clientID) return
      void doc.pivot(props.sessionID, props.docID, { init: props.init ?? false }).then(() => {
        if (store.mode === "doc") return
        setStore("mode", "doc")
      })
    })
    onCleanup(unsub)
  })

  const contextItems = createMemo(() => {
    const items = prompt.context.items()
    if (store.mode !== "shell") return items
    return items.filter((item) => !isLineContextItem(item) && !item.comment?.trim())
  })

  const hasUserPrompt = createMemo(() => {
    const sessionID = params.id
    if (!sessionID) return false
    const messages = sync.data.message[sessionID]
    if (!messages) return false
    return messages.some((m) => m.role === "user")
  })

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

  const suggest = createMemo(() => !hasUserPrompt())

  const placeholder = createMemo(() =>
    promptPlaceholder({
      mode: store.mode,
      commentCount: commentCount(),
      example: suggest() ? language.t(EXAMPLES[store.placeholder]) : "",
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

  // 캡처 동안엔 확대된 입력창이 화면을 가리므로 축소 상태를 강제한다. 실제 축소/복귀는 위쪽
  // 자동 확대 이펙트가 capturing() 을 보고 처리한다 — 캡처가 완전히 끝나기 전엔 재확대하지 않고,
  // 끝나면 원래(포커스 기준) 상태로 되돌린다. 이미 축소 상태였다면 그대로 축소를 유지한다.
  const captureTab = async () => {
    if (capturing()) return
    setCapturing(true)
    try {
      const file = await captureDisplayImage()
      if (file) {
        if (store.mode === "doc") await doc.addFiles([file])
        else await addAttachments([file])
      }
    } catch {
      showToast({ title: language.t("common.requestFailed") })
    } finally {
      setCapturing(false)
    }
  }

  const setMode = (mode: PromptMode) => {
    if (store.mode === mode) return
    if (store.mode === "doc" && mode !== "doc") doc.detach()
    setStore("mode", mode)
    setStore("popover", null)
    if (mode === "normal") requestAnimationFrame(() => editorRef?.focus())
  }

  const shellModeKey = "mod+shift+x"
  const normalModeKey = "mod+shift+e"
  const modes = [
    { mode: "doc", icon: "code-lines", label: "prompt.mode.doc", action: "prompt-doc" },
    { mode: "normal", icon: "prompt", label: "prompt.mode.normal", action: "prompt-normal" },
  ] as const

  const modeButtons = () => (
    <Show when={!wysiwygOnly}>
      {modes.map((item) => {
        const selected = store.mode === item.mode
        return (
          <Tooltip placement="top" value={language.t(item.label)}>
            <Button
              data-action={item.action}
              data-selected={selected ? "true" : undefined}
              type="button"
              variant="ghost"
              classList={{
                "size-7.5 p-0": true,
                "pointer-events-none bg-surface-base-active text-text-strong [&_[data-slot=icon-svg]]:text-icon-strong":
                  selected,
              }}
              style={canvasMode(store.mode) ? undefined : buttons()}
              aria-disabled={selected}
              tabIndex={selected ? -1 : undefined}
              onClick={() => setMode(item.mode)}
              aria-label={language.t(item.label)}
              aria-pressed={selected}
            >
              <Icon name={item.icon} class="size-4.5" />
            </Button>
          </Tooltip>
        )
      })}
    </Show>
  )

  command.register("prompt-input", () => [
    {
      id: "file.attach",
      title: language.t("prompt.action.attachFile"),
      category: language.t("command.category.file"),
      keybind: "mod+u",
      disabled: store.mode !== "normal",
      onSelect: pick,
    },
    {
      id: "prompt.mode.shell",
      title: language.t("command.prompt.mode.shell"),
      category: language.t("command.category.session"),
      keybind: shellModeKey,
      disabled: store.mode === "shell",
      onSelect: () => setMode("shell"),
    },
    {
      id: "prompt.mode.normal",
      title: language.t("command.prompt.mode.normal"),
      category: language.t("command.category.session"),
      keybind: normalModeKey,
      disabled: store.mode === "normal",
      onSelect: () => setMode("normal"),
    },
    {
      id: "prompt.mode.doc",
      title: language.t("command.prompt.mode.doc"),
      category: language.t("command.category.session"),
      disabled: store.mode === "doc",
      onSelect: () => setMode("doc"),
    },
  ])

  const closePopover = () => setStore("popover", null)

  const resetHistoryNavigation = (force = false) => {
    if (!force && (store.historyIndex < 0 || store.applyingHistory)) return
    setStore("historyIndex", -1)
    setStore("savedPrompt", null)
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

    const custom = sync.data.command.map((cmd) => ({
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
    promptProbe.select(cmd.id)
    closePopover()
    const images = imageAttachments()

    if (cmd.type === "custom") {
      const text = `/${cmd.trigger} `
      setEditorText(text)
      prompt.set([{ type: "text", content: text, start: 0, end: text.length }, ...images], text.length)
      focusEditorEnd()
      return
    }

    clearEditor()
    prompt.set([...DEFAULT_PROMPT, ...images], 0)
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

  if (promptEnabled()) {
    createEffect(() => {
      promptProbe.set({
        popover: store.popover,
        slash: {
          active: slashActive() ?? null,
          ids: slashFlat().map((cmd) => cmd.id),
        },
      })
    })

    onCleanup(() => promptProbe.clear())
  }

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
      (parts) => {
        if (composing()) return
        if (canvasMode(store.mode)) return
        if (!editorRef) return
        reconcile(parts.filter((part) => part.type !== "image"))
      },
    ),
  )

  createEffect(() => {
    if (canvasMode(store.mode)) return
    requestAnimationFrame(() => {
      if (!editorRef) return
      reconcile(prompt.current().filter((part) => part.type !== "image"))
    })
  })

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
    const rawParts = parseFromDOM()
    const images = imageAttachments()
    const cursorPosition = getCursorPosition(editorRef)
    const rawText =
      rawParts.length === 1 && rawParts[0]?.type === "text"
        ? rawParts[0].content
        : rawParts.map((p) => ("content" in p ? p.content : "")).join("")
    const hasNonText = rawParts.some((part) => part.type !== "text")
    const shouldReset = !NON_EMPTY_TEXT.test(rawText) && !hasNonText && images.length === 0

    if (shouldReset) {
      closePopover()
      resetHistoryNavigation()
      if (prompt.dirty()) {
        mirror.input = true
        prompt.set(DEFAULT_PROMPT, 0)
      }
      queueScroll()
      return
    }

    const shellMode = store.mode === "shell"

    if (!shellMode) {
      if (promptTriggersOff) {
        closePopover()
      } else {
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
      }
    } else {
      closePopover()
    }

    resetHistoryNavigation()

    mirror.input = true
    prompt.set([...rawParts, ...images], cursorPosition)
    queueScroll()
  }

  const addPart = (part: ContentPart) => {
    if (part.type === "image") return false
    if (store.mode === "doc") {
      const cursor = prompt.cursor() ?? promptLength(prompt.current())
      prompt.set([...prompt.current(), part], cursor)
      return true
    }

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
            range.setStart(placeholder, 0)
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

  const addToHistory = (prompt: Prompt, mode: PromptMode) => {
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
    enabled: () => true,
    editor: () => editorRef,
    isDialogActive: () => !!dialog.active,
    setDraggingType: (type) => setStore("draggingType", type),
    focusEditor: () => {
      if (store.mode === "doc") {
        doc.refocus()
        return
      }
      editorRef.focus()
      setCursorPosition(editorRef, promptLength(prompt.current()))
    },
    addPart,
    dropPath: async (path) => {
      if (store.mode !== "doc") return false
      const dir = sdk.directory.replace(/\/+$/, "")
      const rel =
        path.startsWith(dir) && (path === dir || path[dir.length] === "/")
          ? path.slice(dir.length).replace(/^\/+/, "")
          : path
      const ok = doc.addReference(rel)
      if (ok) addPart({ type: "file", path, content: "@" + path, start: 0, end: 0 })
      return ok
    },
    dropFiles: async (list) => {
      if (store.mode !== "doc") return false
      const ok = await doc.addFiles(list)
      if (!ok && list.length > 0) {
        showToast({
          title: language.t("common.requestFailed"),
        })
      }
      return true
    },
    readClipboardImage: platform.readClipboardImage,
  })

  const variants = createMemo(() => ["default", ...local.model.variant.list()])
  const accepting = createMemo(() => {
    const id = params.id
    if (!id) return permission.isAutoAcceptingDirectory(sdk.directory)
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

  createEffect(() => {
    if (store.mode !== "doc") return
    if (params.id) return
    void ensure().then((id) => {
      if (!id) return
      void doc.refresh(id)
    })
  })

  const { abort, handleSubmit } = createPromptSubmit({
    info,
    imageAttachments,
    commentCount,
    autoAccept: () => accepting(),
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
    newSessionWorktree: () => (store.mode === "doc" ? "main" : props.newSessionWorktree),
    onNewSessionWorktreeReset: props.onNewSessionWorktreeReset,
    shouldQueue: () => followupShouldQueue(params.id, mode(), working()),
    onQueue: props.onQueue,
    onQueued: async ({ sessionID, mode }) => {
      try {
        await clearAfterQueue({ mode, sessionID, advanceDoc: doc.advance })
      } catch {
        showToast({
          title: language.t("prompt.toast.docAdvanceFailed.title"),
          description: language.t("prompt.toast.docAdvanceFailed.description"),
        })
      }
    },
    onAbort: props.onAbort,
    onSubmit: props.onSubmit,
    approve: async (input) => {
      if (store.mode !== "doc") return false
      const docID = doc.docID()
      const actorID = doc.actorID()
      if (!docID || !actorID) return false
      const list = doc.actors()
      const ids = Array.from(new Set([actorID, ...list.map((item) => item.actorID)]))
      if (ids.length <= 1) return false
      const names: Record<string, string> = {}
      for (const item of list) {
        const name = item.name?.trim()
        if (name && name !== item.actorID) names[item.actorID] = name
      }
      try {
        const state = await startSubmit({
          baseUrl: sdk.url,
          directory: input.sessionDirectory,
          sessionID: input.sessionID,
          docID,
          actorID,
          actorIDs: ids,
          names,
          prompt: {
            messageID: input.messageID,
            agent: input.agent,
            model: input.model,
            variant: input.variant,
            parts: input.parts,
          },
        })
        approvalSession = input.sessionID
        showApproval(state)
        return true
      } catch {
        approvalSession = input.sessionID
        showToast({
          title: "전송 동의 요청 실패",
          description: language.t("common.requestFailed"),
        })
        return true
      }
    },
  })

  const exitDoc = () => {
    doc.detach()
    setStore("mode", "normal")
    setStore("popover", null)
    requestAnimationFrame(() => editorRef?.focus())
  }

  // Stopping the AI mid-response is a shared action in a collaborative doc: gate it behind the same
  // consent vote as sending. Solo (or non-doc) falls straight through to a direct abort. The dialog
  // is driven by the vote, so it stays up even if the response finishes first; on resolution it just
  // closes (server already cancelled on approval, or nothing on reject — same end state either way).
  const requestStop = async () => {
    const sessionID = params.id
    const docID = doc.docID()
    const actorID = doc.actorID()
    if (store.mode !== "doc" || !sessionID || !docID || !actorID) {
      await abort()
      return
    }
    const list = doc.actors()
    const ids = Array.from(new Set([actorID, ...list.map((item) => item.actorID)]))
    if (ids.length <= 1) {
      await abort()
      return
    }
    const names: Record<string, string> = {}
    for (const item of list) {
      const name = item.name?.trim()
      if (name && name !== item.actorID) names[item.actorID] = name
    }
    try {
      const state = await startStopSubmit({
        baseUrl: sdk.url,
        directory: sdk.directory,
        sessionID,
        docID,
        actorID,
        actorIDs: ids,
        names,
      })
      approvalSession = sessionID
      showApproval(state)
    } catch {
      await abort()
    }
  }

  async function submit() {
    if (submitAction() === "stop") {
      await requestStop()
      return
    }

    if (store.mode === "doc") {
      const next = await doc.commitMarkdown()
      const text = next?.text
      if (!text) {
        if (working()) {
          await abort()
          return
        }
        showToast({
          title: language.t("prompt.toast.docEmpty.title"),
          description: language.t("prompt.toast.docEmpty.description"),
        })
        return
      }
      const base = [
        ...promptFromDocMarkdown(text, prompt.current(), doc.docID(), doc.actorID()),
        ...(next?.assets.map((asset) => ({
          type: "image" as const,
          id: asset.id,
          filename: asset.filename,
          mime: asset.mime,
          dataUrl: asset.dataUrl,
        })) ?? []),
      ]
      approvalSession = undefined
      const sessionID = await handleSubmit(undefined, {
        prompt: base,
        prepare: async (id) => [
          ...promptFromDocMarkdown(text, prompt.current(), await doc.refresh(id), doc.actorID()),
          ...base.filter((part) => part.type === "image"),
        ],
      })
      if (!sessionID) return
      if (approvalSession === sessionID) return
      try {
        await doc.advance(sessionID)
      } catch {
        showToast({
          title: language.t("prompt.toast.docAdvanceFailed.title"),
          description: language.t("prompt.toast.docAdvanceFailed.description"),
        })
      }
      return
    }

    await handleSubmit()
  }

  const handleFormSubmit = (event: Event) => {
    event.preventDefault()
    void submit()
  }

  const handleKeyDown = (event: KeyboardEvent) => {
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

    if (!promptTriggersOff && event.key === "!" && store.mode === "normal") {
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

      if (store.mode === "doc") {
        void exitDoc()
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (working()) {
        void requestStop()
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
        void requestStop()
        event.preventDefault()
      }
      return
    }

    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      const { collapsed } = getCaretState()
      if (!collapsed) return

      const cursorPosition = getCursorPosition(editorRef)
      const textContent = prompt
        .current()
        .map((part) => ("content" in part ? part.content : ""))
        .join("")
      const direction = event.key === "ArrowUp" ? "up" : "down"
      if (!canNavigateHistoryAtCursor(direction, textContent, cursorPosition, store.historyIndex >= 0)) return
      if (navigateHistory(direction)) {
        event.preventDefault()
      }
      return
    }

    // Note: Shift+Enter is handled earlier, before IME check
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      if (event.repeat) return
      const action = submitAction()
      if (action === "stop") {
        void requestStop()
        return
      }
      if (store.mode === "doc") {
        void submit()
        return
      }
      void handleSubmit(event)
    }
  }

  return (
    <div
      ref={(el) => (rootRef = el)}
      classList={{
        "relative flex w-full flex-col gap-0": true,
        "size-full max-h-[512px] min-h-0": store.mode !== "doc" && !props.expanded,
        "flex-1 min-h-0": props.expanded,
        relative: props.expanded,
      }}
      style={
        store.mode === "doc" && !props.expanded
          ? {
              height: `${height()}px`,
              "min-height": `${DOC_MIN}px`,
              "max-height": `${max()}px`,
            }
          : undefined
      }
      on:focusin={() => setFocusWithin(true)}
      on:focusout={() => {
        // 다음 틱에 실제 활성 요소가 컴포저 밖이면 focus 해제(에디터 내부 이동 시 깜빡임 방지).
        setTimeout(() => {
          if (!rootRef) return
          if (rootRef.contains(document.activeElement)) return
          // 컴포저 안의 포커스 못 받는 버튼/컨트롤을 눌러 포커스가 body 로 빠진 경우는 이탈이 아니다.
          if (pointerDownInside) return
          setFocusWithin(false)
        }, 0)
      }}
    >
      <Show when={store.mode === "doc" && !props.expanded}>
        <div
          data-component="prompt-doc-resize-handle"
          class="group absolute -top-2.5 left-8 right-8 z-30 flex h-3 cursor-ns-resize touch-none items-center justify-center"
          onPointerDown={resize}
        >
          <div class="h-0.5 w-18 rounded-none bg-border-weaker-base transition-colors group-hover:bg-border-strong-base" />
        </div>
      </Show>
      <Show when={props.expanded && props.composerShell}>
        <div
          data-component="prompt-composer-resize-handle"
          class="group absolute -top-2.5 left-8 right-8 z-30 flex h-3 cursor-ns-resize touch-none items-center justify-center"
          onPointerDown={shellResize}
        >
          <div class="h-0.5 w-18 rounded-none bg-border-weaker-base transition-colors group-hover:bg-border-strong-base" />
        </div>
      </Show>
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
      <DockShellForm
        onSubmit={handleFormSubmit}
        classList={{
          "group/prompt-input": true,
          "border-icon-info-active border-dashed": store.draggingType !== null,
          "flex min-h-0 flex-1 flex-col": canvasMode(store.mode) || props.expanded,
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
          data-component="prompt-body"
          classList={{
            relative: true,
            "flex min-h-0 flex-1 flex-col": canvasMode(store.mode),
          }}
          onMouseDown={(e) => {
            if (canvasMode(store.mode)) return
            const target = e.target
            if (!(target instanceof HTMLElement)) return
            if (
              target.closest(
                '[data-action="prompt-attach"], [data-action="prompt-submit"], [data-action="prompt-normal"], [data-action="prompt-doc"], [data-action="prompt-doc-exit"], [data-action="prompt-permissions"]',
              )
            ) {
              return
            }
            editorRef?.focus()
          }}
        >
          <Show
            when={store.mode === "doc"}
            fallback={
              <div
                classList={{
                  "relative overflow-y-auto no-scrollbar": true,
                  "max-h-[240px]": !props.expanded,
                  "flex-1 min-h-0": props.expanded,
                }}
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
                  autocapitalize={store.mode === "normal" ? "sentences" : "off"}
                  autocorrect={store.mode === "normal" ? "on" : "off"}
                  spellcheck={store.mode === "normal"}
                  onInput={handleInput}
                  onPaste={handlePaste}
                  onCompositionStart={handleCompositionStart}
                  onCompositionEnd={handleCompositionEnd}
                  onBlur={handleBlur}
                  onKeyDown={handleKeyDown}
                  classList={{
                    "select-text": true,
                    "w-full text-14-regular text-text-strong focus:outline-none whitespace-pre-wrap": true,
                    "[&_[data-type=file]]:text-syntax-property": true,
                    "[&_[data-type=agent]]:text-syntax-type": true,
                    "font-mono!": store.mode === "shell",
                  }}
                  style={{ "padding-bottom": space }}
                />
                <Show when={!prompt.dirty()}>
                  <div
                    data-component="prompt-input-placeholder"
                    class="absolute top-0 inset-x-0 text-14-regular text-text-weak pointer-events-none whitespace-nowrap truncate"
                    classList={{ "font-mono!": store.mode === "shell" }}
                    style={{ "padding-bottom": space }}
                  >
                    {placeholder()}
                  </div>
                </Show>
              </div>
            }
          >
            <PromptDocShell
              doc={doc}
              submitIcon={submitIcon()}
              submitLabel={submitLabel()}
              submitDisabled={submitAction() === "send" && !hasDraft()}
              tip={tip()}
              onExit={exitDoc}
              modes={modeButtons()}
              expand={composerExpand()}
              autoExpand={{ enabled: autoExpand(), onToggle: toggleAutoExpand }}
              capture={{ active: capturing(), onCapture: captureTab }}
            />
          </Show>

          <Show when={!canvasMode(store.mode)}>
            <div
              aria-hidden="true"
              class="pointer-events-none absolute inset-x-0 bottom-0"
              style={{
                height: space,
                background:
                  "linear-gradient(to top, var(--surface-raised-stronger-non-alpha) calc(100% - 20px), transparent)",
              }}
            />
          </Show>

          <Show when={!canvasMode(store.mode)}>
            <div class="pointer-events-none absolute bottom-2 right-2 flex items-center gap-1">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ACCEPTED_FILE_TYPES.join(",")}
                hidden
                tabindex={-1}
                aria-hidden="true"
                onChange={(e) => {
                  const list = e.currentTarget.files
                  if (list) void addAttachments(Array.from(list))
                  e.currentTarget.value = ""
                }}
              />

              <div class="flex items-center gap-1 pointer-events-auto">
                <Tooltip placement="top" inactive={submitAction() === "send" && !hasDraft()} value={tip()}>
                  <IconButton
                    data-action="prompt-submit"
                    type="submit"
                    disabled={
                      store.mode === "shell" ||
                      (store.mode === "normal" && !hasDraft() && submitAction() === "send")
                    }
                    tabIndex={store.mode === "shell" ? -1 : undefined}
                    icon={submitIcon()}
                    variant="primary"
                    class="size-7.5"
                    style={submitStyle()}
                    aria-label={submitLabel()}
                  />
                </Tooltip>
              </div>
            </div>

            <div class="pointer-events-none absolute bottom-2 left-2 flex items-center gap-1">
              <Show when={store.mode === "normal"}>
                <div
                  class="pointer-events-auto flex items-center gap-1"
                  style={{
                    "pointer-events": buttonsSpring() > 0.5 ? "auto" : "none",
                  }}
                >
                  <TooltipKeybind
                    placement="top"
                    title={language.t("prompt.action.attachFile")}
                    keybind={command.keybind("file.attach")}
                  >
                    <Button
                      data-action="prompt-attach"
                      type="button"
                      variant="ghost"
                      class="size-7.5 p-0"
                      style={buttons()}
                      onClick={pick}
                      aria-label={language.t("prompt.action.attachFile")}
                    >
                      <Icon name="plus" class="size-4.5" />
                    </Button>
                  </TooltipKeybind>
                  <Tooltip placement="top" value={language.t("prompt.action.captureTab")}>
                    <Button
                      data-action="prompt-capture-tab"
                      type="button"
                      variant="ghost"
                      class="size-7.5 p-0"
                      style={buttons()}
                      onClick={captureTab}
                      aria-disabled={capturing()}
                      aria-label={language.t("prompt.action.captureTab")}
                    >
                      <Icon name="photo" class="size-4.5" />
                    </Button>
                  </Tooltip>
                  {modeButtons()}
                </div>
              </Show>
            </div>
          </Show>
        </div>
      </DockShellForm>
      <Show when={!footerOff && (store.mode === "normal" || store.mode === "shell" || canvasMode(store.mode))}>
        <DockTray attach="top">
          <div class="px-1.75 pt-5.5 pb-2 flex items-center gap-2 min-w-0">
            <div class="flex items-center gap-1.5 min-w-0 flex-1 relative">
              <Show when={store.mode === "shell"}>
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
              </Show>
              <div class="flex items-center gap-1.5 min-w-0 flex-1">
                <div data-component="prompt-agent-control">
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
                      onSelect={local.agent.set}
                      class="capitalize max-w-[160px] text-text-base"
                      valueClass="truncate text-13-regular text-text-base"
                      triggerStyle={control()}
                      triggerProps={{ "data-action": "prompt-agent" }}
                      contentProps={{ "data-codle-menu": "true" }}
                      variant="ghost"
                    />
                  </TooltipKeybind>
                </div>
                {/* ENT-69 운영 빌드에서는 모델/생각수준 피커를 가림 (로컬 vite dev에서만 표시). */}
                <Show when={import.meta.env.DEV}>
                  <div data-component="prompt-model-control">
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
                  <div data-component="prompt-variant-control">
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
                        onSelect={(x) => local.model.variant.set(x === "default" ? undefined : x)}
                        class="capitalize max-w-[160px] text-text-base"
                        valueClass="truncate text-13-regular text-text-base"
                        triggerStyle={control()}
                        triggerProps={{ "data-action": "prompt-model-variant" }}
                        contentProps={{ "data-codle-menu": "true" }}
                        variant="ghost"
                      />
                    </TooltipKeybind>
                  </div>
                </Show>
                <Show when={!permissionsOff}>
                  <TooltipKeybind
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
                </Show>
              </div>
            </div>
          </div>
        </DockTray>
      </Show>
    </div>
  )
}
