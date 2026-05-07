import type { SessionPending, SessionPendingDraft } from "@opencode-ai/sdk/v2"
import type { Message, Session } from "@opencode-ai/sdk/v2/client"
import { showToast } from "@opencode-ai/ui/toast"
import { base64Encode } from "@opencode-ai/util/encode"
import { Binary } from "@opencode-ai/util/binary"
import { useNavigate, useParams } from "@solidjs/router"
import type { Accessor } from "solid-js"
import type { FileSelection } from "@/context/file"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useLocal } from "@/context/local"
import { usePermission } from "@/context/permission"
import { useComments } from "@/context/comments"
import { type ContextItem, type ImageAttachmentPart, type Prompt, usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { promptProbe } from "@/testing/prompt"
import { Identifier } from "@/utils/id"
import { Worktree as WorktreeState } from "@/utils/worktree"
import type { PendingActionResult, PendingBlockReason } from "@/pages/session/pending-controller"
import { buildCommandRequestParts, buildRequestParts } from "./build-request-parts"
import { setCursorPosition } from "./editor-dom"
import { formatServerError } from "@/utils/server-errors"

type PendingPrompt = {
  abort: AbortController
  cleanup: VoidFunction
}

const pending = new Map<string, PendingPrompt>()

export type FollowupDraft = {
  sessionID: string
  sessionDirectory: string
  prompt: Prompt
  context: (ContextItem & { key: string })[]
  agent: string
  model: { providerID: string; modelID: string }
  variant?: string
  pendingBaseDraft?: SessionPendingDraft
}

export type FollowupActionBlockReason = PendingBlockReason

export type FollowupActionResult<TState = SessionPending> = PendingActionResult<TState>

type FollowupSendInput = {
  client: ReturnType<typeof useSDK>["client"]
  globalSync: ReturnType<typeof useGlobalSync>
  sync: ReturnType<typeof useSync>
  draft: FollowupDraft
  messageID?: string
  optimisticBusy?: boolean
  before?: () => Promise<boolean> | boolean
}

const draftText = (prompt: Prompt) => prompt.map((part) => ("content" in part ? part.content : "")).join("")

const draftImages = (prompt: Prompt) => prompt.filter((part): part is ImageAttachmentPart => part.type === "image")

export async function sendFollowupDraft(input: FollowupSendInput) {
  const text = draftText(input.draft.prompt)
  const images = draftImages(input.draft.prompt)
  const [, setStore] = input.globalSync.child(input.draft.sessionDirectory)

  const setBusy = () => {
    if (!input.optimisticBusy) return
    setStore("session_status", input.draft.sessionID, { type: "busy" })
  }

  const setIdle = () => {
    if (!input.optimisticBusy) return
    setStore("session_status", input.draft.sessionID, { type: "idle" })
  }

  const wait = async () => {
    const ok = await input.before?.()
    if (ok === false) return false
    return true
  }

  const [head, ...tail] = text.split(" ")
  const cmd = head?.startsWith("/") ? head.slice(1) : undefined
  if (cmd && input.sync.data.command.find((item) => item.name === cmd)) {
    const messageID = input.messageID ?? Identifier.ascending("message")
    const { requestParts } = buildCommandRequestParts({
      prompt: input.draft.prompt.filter((part) => part.type !== "text"),
      context: input.draft.context,
      images,
      messageID,
      sessionID: input.draft.sessionID,
      sessionDirectory: input.draft.sessionDirectory,
    })
    setBusy()
    try {
      if (!(await wait())) {
        setIdle()
        return false
      }

      await input.client.session.command({
        sessionID: input.draft.sessionID,
        command: cmd,
        arguments: tail.join(" "),
        agent: input.draft.agent,
        model: `${input.draft.model.providerID}/${input.draft.model.modelID}`,
        variant: input.draft.variant,
        parts: requestParts,
      })
      return true
    } catch (err) {
      setIdle()
      throw err
    }
  }

  const messageID = input.messageID ?? Identifier.ascending("message")
  const { requestParts, optimisticParts } = buildRequestParts({
    prompt: input.draft.prompt,
    context: input.draft.context,
    images,
    text,
    sessionID: input.draft.sessionID,
    messageID,
    sessionDirectory: input.draft.sessionDirectory,
  })

  const message: Message = {
    id: messageID,
    sessionID: input.draft.sessionID,
    role: "user",
    time: { created: Date.now() },
    agent: input.draft.agent,
    model: { ...input.draft.model, variant: input.draft.variant },
  }

  const add = () =>
    input.sync.session.optimistic.add({
      directory: input.draft.sessionDirectory,
      sessionID: input.draft.sessionID,
      message,
      parts: optimisticParts,
    })

  const remove = () =>
    input.sync.session.optimistic.remove({
      directory: input.draft.sessionDirectory,
      sessionID: input.draft.sessionID,
      messageID,
    })

  setBusy()
  add()

  try {
    if (!(await wait())) {
      setIdle()
      remove()
      return false
    }

    await input.client.session.promptAsync({
      sessionID: input.draft.sessionID,
      agent: input.draft.agent,
      model: input.draft.model,
      messageID,
      parts: requestParts,
      variant: input.draft.variant,
    })
    return true
  } catch (err) {
    setIdle()
    remove()
    throw err
  }
}

type PromptSubmitInput = {
  info: Accessor<{ id: string } | undefined>
  edit?: Accessor<{ id: string; baseDraft?: SessionPendingDraft } | undefined>
  imageAttachments: Accessor<ImageAttachmentPart[]>
  commentCount: Accessor<number>
  autoAccept: Accessor<boolean>
  mode: Accessor<"normal" | "shell">
  working: Accessor<boolean>
  editor: () => HTMLDivElement | undefined
  queueScroll: () => void
  promptLength: (prompt: Prompt) => number
  addToHistory: (prompt: Prompt, mode: "normal" | "shell") => void
  resetHistoryNavigation: () => void
  setMode: (mode: "normal" | "shell") => void
  setPopover: (popover: "at" | "slash" | null) => void
  newSessionWorktree?: Accessor<string | undefined>
  onNewSessionWorktreeReset?: () => void
  submitBlocked?: Accessor<boolean>
  followupLane?: (event: Event) => "queue" | "steer" | undefined
  followupPending?: Accessor<boolean>
  setFollowupPending?: (pending: boolean) => void
  onQueue?: (draft: FollowupDraft) => Promise<FollowupActionResult> | FollowupActionResult
  onSteer?: (draft: FollowupDraft) => Promise<FollowupActionResult> | FollowupActionResult
  onEditSubmit?: (draft: FollowupDraft) => Promise<FollowupActionResult> | FollowupActionResult
  onAbort?: () => void | (() => void)
  onSubmit?: () => void
}

type CommentItem = {
  path: string
  selection?: FileSelection
  comment?: string
  commentID?: string
  commentOrigin?: "review" | "file"
  preview?: string
}

export function createPromptSubmit(input: PromptSubmitInput) {
  const navigate = useNavigate()
  const sdk = useSDK()
  const sync = useSync()
  const globalSync = useGlobalSync()
  const comments = useComments()
  const local = useLocal()
  const permission = usePermission()
  const prompt = usePrompt()
  const layout = useLayout()
  const language = useLanguage()
  const params = useParams()

  const errorMessage = (err: unknown) => {
    if (err && typeof err === "object" && "data" in err) {
      const data = (err as { data?: { message?: string } }).data
      if (data?.message) return data.message
    }
    if (err instanceof Error) return err.message
    return language.t("common.requestFailed")
  }

  const abort = async () => {
    const sessionID = params.id
    if (!sessionID) return Promise.resolve()

    globalSync.todo.set(sessionID, [])
    const [, setStore] = globalSync.child(sdk.directory)
    setStore("todo", sessionID, [])

    const rollbackAbort = input.onAbort?.()
    const rollback = () => {
      if (typeof rollbackAbort === "function") rollbackAbort()
    }

    const queued = pending.get(sessionID)
    if (queued) {
      queued.abort.abort()
      queued.cleanup()
      pending.delete(sessionID)
      rollback()
      return Promise.resolve()
    }
    return sdk.client.session
      .stop({
        sessionID,
      })
      .then(
        () => undefined,
        () => {
          rollback()
          return undefined
        },
      )
  }

  const restoreCommentItems = (items: CommentItem[]) => {
    for (const item of items) {
      prompt.context.add({
        type: "file",
        path: item.path,
        selection: item.selection,
        comment: item.comment,
        commentID: item.commentID,
        commentOrigin: item.commentOrigin,
        preview: item.preview,
      })
    }
  }

  const removeCommentItems = (items: { key: string }[]) => {
    for (const item of items) {
      prompt.context.remove(item.key)
    }
  }

  const clearContext = () => {
    for (const item of prompt.context.items()) {
      prompt.context.remove(item.key)
    }
  }

  const seed = (dir: string, info: Session) => {
    const [, setStore] = globalSync.child(dir)
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

  const handleSubmit = async (event: Event) => {
    event.preventDefault()

    const currentPrompt = prompt.current()
    const text = currentPrompt.map((part) => ("content" in part ? part.content : "")).join("")
    const images = input.imageAttachments().slice()
    const mode = input.mode()
    const editingID = input.edit?.()?.id
    const blankDraft = text.trim().length === 0 && images.length === 0 && input.commentCount() === 0

    if (blankDraft) {
      if (editingID) return
      if (input.working()) abort()
      return
    }

    if (input.followupPending?.()) return

    const currentModel = local.model.current()
    const currentAgent = local.agent.current()
    const variant = local.model.variant.current()
    if (!currentModel || !currentAgent) {
      showToast({
        title: language.t("prompt.toast.modelAgentRequired.title"),
        description: language.t("prompt.toast.modelAgentRequired.description"),
      })
      return
    }

    input.addToHistory(currentPrompt, mode)
    input.resetHistoryNavigation()
    promptProbe.start()

    const projectDirectory = sdk.directory
    const isNewSession = !params.id
    const shouldAutoAccept = isNewSession && input.autoAccept()
    const worktreeSelection = input.newSessionWorktree?.() || "main"

    let sessionDirectory = projectDirectory
    let client = sdk.client

    if (isNewSession) {
      if (worktreeSelection === "create") {
        const createdWorktree = await client.worktree
          .create({ directory: projectDirectory })
          .then((x) => x.data)
          .catch((err) => {
            showToast({
              title: language.t("prompt.toast.worktreeCreateFailed.title"),
              description: errorMessage(err),
            })
            return undefined
          })

        if (!createdWorktree?.directory) {
          showToast({
            title: language.t("prompt.toast.worktreeCreateFailed.title"),
            description: language.t("common.requestFailed"),
          })
          return
        }
        WorktreeState.pending(createdWorktree.directory)
        sessionDirectory = createdWorktree.directory
      }

      if (worktreeSelection !== "main" && worktreeSelection !== "create") {
        sessionDirectory = worktreeSelection
      }

      if (sessionDirectory !== projectDirectory) {
        client = sdk.createClient({
          directory: sessionDirectory,
          throwOnError: true,
        })
        globalSync.child(sessionDirectory)
      }

      input.onNewSessionWorktreeReset?.()
    }

    let session = input.info()
    if (!session && isNewSession) {
      const created = await client.session
        .create()
        .then((x) => x.data ?? undefined)
        .catch((err) => {
          showToast({
            title: language.t("prompt.toast.sessionCreateFailed.title"),
            description: errorMessage(err),
          })
          return undefined
        })
      if (created) {
        seed(sessionDirectory, created)
        session = created
        if (shouldAutoAccept) permission.enableAutoAccept(session.id, sessionDirectory)
        local.session.promote(sessionDirectory, session.id)
        layout.handoff.setTabs(base64Encode(sessionDirectory), session.id)
        navigate(`/${base64Encode(sessionDirectory)}/session/${session.id}`)
      }
    }
    if (!session) {
      showToast({
        title: language.t("prompt.toast.promptSendFailed.title"),
        description: language.t("prompt.toast.promptSendFailed.description"),
      })
      return
    }

    const model = {
      modelID: currentModel.id,
      providerID: currentModel.provider.id,
    }
    const agent = currentAgent.name
    const context = prompt.context.items().slice()
    const draft: FollowupDraft = {
      sessionID: session.id,
      sessionDirectory,
      prompt: currentPrompt,
      context,
      agent,
      model,
      variant,
      pendingBaseDraft: input.edit?.()?.baseDraft,
    }
    const currentComments = comments.all().map((item) => ({
      ...item,
      selection: { ...item.selection },
    }))
    const applyFollowup = async (lane: "queue" | "steer") => {
      input.setFollowupPending?.(true)
      try {
        const result = await (lane === "queue" ? input.onQueue?.(draft) : input.onSteer?.(draft))
        if (!result || result.kind === "applied") {
          clearDraftState()
        } else if (result.kind === "failed") {
          restoreInput()
        }
      } catch {
        restoreInput()
      } finally {
        input.setFollowupPending?.(false)
      }
    }

    const clearInput = () => {
      prompt.reset()
      input.setMode("normal")
      input.setPopover(null)
    }

    const clearDraftState = () => {
      clearContext()
      clearInput()
      comments.clear()
    }

    const hasActiveDraftState = () =>
      draftText(prompt.current()).trim().length > 0 ||
      prompt.current().some((part) => part.type === "image") ||
      prompt.context.items().length > 0 ||
      comments.all().length > 0

    const restoreInput = () => {
      prompt.set(currentPrompt, input.promptLength(currentPrompt))
      input.setMode(editingID ? "normal" : mode)
      input.setPopover(null)
      requestAnimationFrame(() => {
        const editor = input.editor()
        if (!editor) return
        editor.focus()
        setCursorPosition(editor, input.promptLength(currentPrompt))
        input.queueScroll()
      })
    }

    const restoreDraftState = () => {
      if (hasActiveDraftState()) return
      clearContext()
      for (const item of context) {
        prompt.context.add(item)
      }
      comments.replace(currentComments)
      restoreInput()
    }

    const restoreAsyncSendState = () => {
      const currentParts = prompt.current()
      if (draftText(currentParts).trim().length > 0 || draftImages(currentParts).length > 0) return

      const expectedContextKeys = context.filter((item) => !commentItems.some((comment) => comment.key === item.key)).map((item) => item.key)
      const currentContextKeys = prompt.context.items().map((item) => item.key)
      if (
        currentContextKeys.length !== expectedContextKeys.length ||
        currentContextKeys.some((key, index) => key !== expectedContextKeys[index])
      ) {
        return
      }

      const liveComments = comments.all()
      if (
        liveComments.length !== currentComments.length ||
        liveComments.some(
          (item, index) =>
            item.id !== currentComments[index]?.id ||
            item.file !== currentComments[index]?.file ||
            item.comment !== currentComments[index]?.comment,
        )
      ) {
        return
      }

      restoreCommentItems(commentItems)
      restoreInput()
    }

    if (editingID && mode === "shell") {
      input.setMode("normal")
      restoreInput()
      return
    }

    if (editingID) {
      input.setFollowupPending?.(true)
      try {
        const result = await input.onEditSubmit?.(draft)
        if (!result || result.kind === "applied") {
          clearDraftState()
        } else if (result.kind === "failed") {
          restoreInput()
        }
      } catch {
        restoreInput()
      } finally {
        input.setFollowupPending?.(false)
      }
      return
    }

    const followupLane = !isNewSession && mode === "normal" ? input.followupLane?.(event) : undefined
    if (followupLane) {
      await applyFollowup(followupLane)
      return
    }

    if (input.submitBlocked?.()) return

    promptProbe.submit({ sessionID: session.id, directory: sessionDirectory })
    input.onSubmit?.()

    if (mode === "shell") {
      clearInput()
      client.session
        .shell({
          sessionID: session.id,
          agent,
          model,
          command: text,
        })
        .catch((err) => {
          showToast({
            title: language.t("prompt.toast.shellSendFailed.title"),
            description: errorMessage(err),
          })
          restoreInput()
        })
      return
    }

    if (text.startsWith("/")) {
      const [cmdName, ...args] = text.split(" ")
      const commandName = cmdName.slice(1)
      const customCommand = sync.data.command.find((c) => c.name === commandName)
      if (customCommand) {
        const messageID = Identifier.ascending("message")
        const { requestParts } = buildCommandRequestParts({
          prompt: currentPrompt.filter((part) => part.type !== "text"),
          context,
          images,
          messageID,
          sessionID: session.id,
          sessionDirectory,
        })
        input.setFollowupPending?.(true)
        clearDraftState()
        client.session
          .command({
            sessionID: session.id,
            command: commandName,
            arguments: args.join(" "),
            agent,
            model: `${model.providerID}/${model.modelID}`,
            variant,
            parts: requestParts,
          })
          .catch((err) => {
            showToast({
              title: language.t("prompt.toast.commandSendFailed.title"),
              description: formatServerError(err, language.t, language.t("common.requestFailed")),
            })
            restoreDraftState()
          })
          .finally(() => {
            input.setFollowupPending?.(false)
          })
        return
      }
    }

    const commentItems = context.filter((item) => item.type === "file" && !!item.comment?.trim())
    const messageID = Identifier.ascending("message")

    const removeOptimisticMessage = () => {
      sync.session.optimistic.remove({
        directory: sessionDirectory,
        sessionID: session.id,
        messageID,
      })
    }

    removeCommentItems(commentItems)
    clearInput()

    const waitForWorktree = async () => {
      const worktree = WorktreeState.get(sessionDirectory)
      if (!worktree || worktree.status !== "pending") return true

      if (sessionDirectory === projectDirectory) {
        sync.set("session_status", session.id, { type: "busy" })
      }

      const controller = new AbortController()
      const cleanup = () => {
        if (sessionDirectory === projectDirectory) {
          sync.set("session_status", session.id, { type: "idle" })
        }
        removeOptimisticMessage()
        restoreCommentItems(commentItems)
        restoreInput()
      }

      pending.set(session.id, { abort: controller, cleanup })

      const abortWait = new Promise<Awaited<ReturnType<typeof WorktreeState.wait>>>((resolve) => {
        if (controller.signal.aborted) {
          resolve({ status: "failed", message: "aborted" })
          return
        }
        controller.signal.addEventListener(
          "abort",
          () => {
            resolve({ status: "failed", message: "aborted" })
          },
          { once: true },
        )
      })

      const timeoutMs = 5 * 60 * 1000
      const timer = { id: undefined as number | undefined }
      const timeout = new Promise<Awaited<ReturnType<typeof WorktreeState.wait>>>((resolve) => {
        timer.id = window.setTimeout(() => {
          resolve({
            status: "failed",
            message: language.t("workspace.error.stillPreparing"),
          })
        }, timeoutMs)
      })

      const result = await Promise.race([WorktreeState.wait(sessionDirectory), abortWait, timeout]).finally(() => {
        if (timer.id === undefined) return
        clearTimeout(timer.id)
      })
      pending.delete(session.id)
      if (controller.signal.aborted) return false
      if (result.status === "failed") throw new Error(result.message)
      return true
    }

    void sendFollowupDraft({
      client,
      sync,
      globalSync,
      draft,
      messageID,
      optimisticBusy: sessionDirectory === projectDirectory,
      before: waitForWorktree,
    }).catch((err) => {
      pending.delete(session.id)
      if (sessionDirectory === projectDirectory) {
        sync.set("session_status", session.id, { type: "idle" })
      }
      showToast({
        title: language.t("prompt.toast.promptSendFailed.title"),
        description: errorMessage(err),
      })
      removeOptimisticMessage()
      restoreAsyncSendState()
    })
  }

  return {
    abort,
    handleSubmit,
  }
}
