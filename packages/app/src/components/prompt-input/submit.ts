import type { Message, Session } from "@opencode-ai/sdk/v2/client"
import { showToast } from "@opencode-ai/ui/toast"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { Binary } from "@opencode-ai/core/util/binary"
import { useNavigate, useParams } from "@solidjs/router"
import type { Accessor } from "solid-js"
import type { FileSelection } from "@/context/file"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useLocal } from "@/context/local"
import { usePermission } from "@/context/permission"
import { type ContextItem, type ImageAttachmentPart, type Prompt, usePrompt } from "@/context/prompt"
import { useServer } from "@/context/server"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { Identifier } from "@/utils/id"
import { Worktree as WorktreeState } from "@/utils/worktree"
import { buildRequestParts } from "./build-request-parts"
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
}

type FollowupSendInput = {
  client: ReturnType<typeof useSDK>["client"]
  globalSync: ReturnType<typeof useGlobalSync>
  sync: ReturnType<typeof useSync>
  draft: FollowupDraft
  messageID?: string
  optimisticBusy?: boolean
  before?: () => Promise<boolean> | boolean
}

function errorName(err: unknown) {
  if (!err || typeof err !== "object") return
  const value = err as { name?: unknown }
  return typeof value.name === "string" ? value.name : undefined
}

function aborted(err: unknown) {
  const name = errorName(err)
  if (name === "AbortError" || name === "MessageAbortedError") return true
  const msg = formatServerError(err).toLowerCase()
  return msg.includes("operation was aborted")
}

async function delivered(
  client: ReturnType<typeof useSDK>["client"],
  sessionID: string,
  messageID: string,
) {
  const found = (items: { id: string }[] | undefined) => items?.some((item) => item.id === messageID) ?? false
  for (const ms of [0, 150, 400]) {
    if (ms) await new Promise((resolve) => setTimeout(resolve, ms))
    const resp = await client.session.messages({ sessionID, limit: 20 }).catch(() => undefined)
    if (found(resp?.data?.map((item) => item.info))) return true
  }
  return false
}

const draftText = (prompt: Prompt) => prompt.map((part) => ("content" in part ? part.content : "")).join("")

const draftImages = (prompt: Prompt) => prompt.filter((part): part is ImageAttachmentPart => part.type === "image")

const submitMeasureSummary = () =>
  performance
    .getEntriesByType("measure")
    .filter((e) => e.name.startsWith("submit:"))
    .map((e) => `${e.name.replace("submit:", "")}=${Math.round(e.duration)}ms`)
    .join(" ")

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
    setBusy()
    try {
      if (!(await wait())) {
        setIdle()
        return false
      }

      await input.client.session.command({
        sessionID: input.draft.sessionID,
        messageID,
        command: cmd,
        arguments: tail.join(" "),
        agent: input.draft.agent,
        model: `${input.draft.model.providerID}/${input.draft.model.modelID}`,
        variant: input.draft.variant,
        parts: images.map((attachment) => ({
          id: Identifier.ascending("part"),
          type: "file" as const,
          mime: attachment.mime,
          url: attachment.dataUrl,
          filename: attachment.filename,
        })),
      })
      return true
    } catch (err) {
      if (await delivered(input.client, input.draft.sessionID, messageID)) return true
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
    model: input.draft.model,
    variant: input.draft.variant,
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
  performance.mark("submit:optimistic-add:start")
  add()
  performance.mark("submit:optimistic-add:end")
  performance.measure("submit:optimistic-add", "submit:optimistic-add:start", "submit:optimistic-add:end")

  try {
    if (!(await wait())) {
      setIdle()
      remove()
      return false
    }

    performance.mark("submit:http-send:start")
    await input.client.session.promptAsync({
      sessionID: input.draft.sessionID,
      agent: input.draft.agent,
      model: input.draft.model,
      messageID,
      parts: requestParts,
      variant: input.draft.variant,
    })
    performance.mark("submit:http-send:end")
    performance.measure("submit:http-send", "submit:http-send:start", "submit:http-send:end")
    performance.measure("submit:total", "submit:start", "submit:http-send:end")
    console.debug(`[perf:submit] breakdown ${submitMeasureSummary()}`)
    return true
  } catch (err) {
    if (await delivered(input.client, input.draft.sessionID, messageID)) return true
    setIdle()
    remove()
    throw err
  }
}

type PromptSubmitInput = {
  info: Accessor<{ id: string } | undefined>
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
  resetInputUndo: (prompt?: Prompt, cursor?: number) => void
  newSessionWorktree?: Accessor<string | undefined>
  onNewSessionWorktreeReset?: () => void
  shouldQueue?: Accessor<boolean>
  onQueue?: (draft: FollowupDraft) => void
  onAbort?: () => void
  onSubmit?: () => void
  onSubmitted?: () => void
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
  const local = useLocal()
  const server = useServer()
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

    const t0 = performance.now()
    console.debug(`[abort] start sessionID=${sessionID} directory=${sdk.directory} t=${t0}`)

    globalSync.todo.set(sessionID, [])
    const [, setStore] = globalSync.child(sdk.directory)
    setStore("todo", sessionID, [])

    setStore("session_status", sessionID, { type: "idle" })
    let optimisticTarget: string | undefined
    setStore("message", sessionID, (list) => {
      if (!list?.length) return list
      const lastIdx = list.length - 1
      const last = list[lastIdx]
      if (!last || last.role !== "assistant" || typeof last.time.completed === "number") return list
      optimisticTarget = last.id
      const next = list.slice()
      next[lastIdx] = { ...last, time: { ...last.time, completed: Date.now() } }
      return next
    })
    console.debug(`[abort] optimistic local state sessionID=${sessionID} msgCompleted=${optimisticTarget ?? "none"} dt=${performance.now() - t0}`)

    input.onAbort?.()

    const queued = pending.get(sessionID)
    if (queued) {
      console.debug(`[abort] cancel local pending sessionID=${sessionID} directory=${sdk.directory}`)
      queued.abort.abort()
      queued.cleanup()
      pending.delete(sessionID)
    }
    console.debug(`[abort] POST /session/:id/abort sessionID=${sessionID} directory=${sdk.directory} queued=${!!queued}`)
    return sdk.client.session
      .abort({
        sessionID,
      })
      .then(() => {
        console.debug(`[abort] POST done sessionID=${sessionID} totalMs=${performance.now() - t0}`)
      })
      .catch((err) => {
        console.debug(`[abort] POST failed sessionID=${sessionID} err=${String(err)}`)
      })
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

    // Clear stale marks from previous submit
    performance.clearMarks("submit:start")
    performance.clearMarks("submit:session-create:start")
    performance.clearMarks("submit:session-create:end")
    performance.clearMarks("submit:navigate:start")
    performance.clearMarks("submit:navigate:end")
    performance.clearMarks("submit:clear-input:start")
    performance.clearMarks("submit:clear-input:end")
    performance.clearMarks("submit:first-raf")
    performance.clearMarks("submit:optimistic-add:start")
    performance.clearMarks("submit:optimistic-add:end")
    performance.clearMarks("submit:http-send:start")
    performance.clearMarks("submit:http-send:end")
    performance.clearMarks("submit:dom-mount")

    performance.mark("submit:start")

    const currentPrompt = prompt.current()
    const text = currentPrompt.map((part) => ("content" in part ? part.content : "")).join("")
    const images = input.imageAttachments().slice()
    const mode = input.mode()

    if (text.trim().length === 0 && images.length === 0 && input.commentCount() === 0) {
      if (input.working()) abort()
      return
    }

    const openclaw = server.current?.integration === "openclaw"
    const genericagent = server.current?.integration === "genericagent"
    const currentModel =
      local.model.current() ??
      (openclaw
        ? {
            id: "claw",
            name: "Claw",
            provider: { id: "openclaw", name: "OpenClaw", models: {} },
          }
        : undefined)
    const currentAgent = local.agent.current() ?? (openclaw ? { name: "claw" } : undefined)
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

    const currentDirectory = sdk.directory
    const rootDirectory = sync.project?.worktree || currentDirectory

    const isNewSession = !params.id
    const shouldAutoAccept = isNewSession && input.autoAccept()
    const worktreeSelection = input.newSessionWorktree?.() || "main"

    let sessionDirectory = currentDirectory
    let sessionCwd: string | undefined
    let client = sdk.client

    if (isNewSession) {
      if (genericagent) {
        if (worktreeSelection !== "main" && worktreeSelection !== "create") {
          sessionCwd = worktreeSelection
        }
        sessionDirectory = currentDirectory
        client = sdk.client
      } else {
        if (worktreeSelection === "main") {
          sessionDirectory = rootDirectory
        }

        if (worktreeSelection === "create") {
          const rootClient =
            rootDirectory === currentDirectory
              ? sdk.client
              : sdk.createClient({
                  directory: rootDirectory,
                  throwOnError: true,
                })
          const createdWorktree = await rootClient.worktree
            .create({ directory: rootDirectory })
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

        if (sessionDirectory !== currentDirectory) {
          // Guard: 确保 sessionDirectory 不为空（worktree 场景）
          if (!sessionDirectory || sessionDirectory.trim() === "") {
            console.error(
              `[BUG] sessionDirectory is empty in worktree path sessionDirectory=${sessionDirectory || ""} currentDirectory=${currentDirectory} rootDirectory=${rootDirectory} worktreeSelection=${worktreeSelection}`,
            )
            showToast({
              variant: "error",
              title: language.t("prompt.toast.sessionCreateFailed.title"),
              description: "工作树目录配置错误，请重试",
            })
            return
          }
          client = sdk.createClient({
            directory: sessionDirectory,
            throwOnError: true,
          })
          globalSync.child(sessionDirectory)
        } else {
          client = sdk.client
        }
      }

      input.onNewSessionWorktreeReset?.()
    }

    let session = input.info()
    if (!session && isNewSession) {
      performance.mark("submit:session-create:start")
      const createSession = client.session.create.bind(client.session) as (
        parameters?: undefined,
        options?: { body?: { cwd?: string } },
      ) => Promise<{ data?: Session }>
      const created = await createSession(
        undefined,
        genericagent && sessionCwd
          ? ({
              body: { cwd: sessionCwd },
            } as Parameters<typeof createSession>[1])
          : undefined,
      )
        .then((x) => x.data ?? undefined)
        .catch((err) => {
          showToast({
            title: language.t("prompt.toast.sessionCreateFailed.title"),
            description: errorMessage(err),
          })
          return undefined
        })
      performance.mark("submit:session-create:end")
      performance.measure("submit:session-create", "submit:session-create:start", "submit:session-create:end")
      if (created) {
        seed(sessionDirectory, created)
        session = created
        if (shouldAutoAccept) permission.enableAutoAccept(session.id, sessionDirectory)
        local.session.promote(sessionDirectory, session.id)
        layout.handoff.setTabs(base64Encode(sessionDirectory), session.id)
        performance.mark("submit:navigate:start")
        navigate(`/${base64Encode(sessionDirectory)}/session/${session.id}`)
        performance.mark("submit:navigate:end")
        performance.measure("submit:navigate", "submit:navigate:start", "submit:navigate:end")
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
    }

    const clearInput = () => {
      prompt.reset()
      input.resetInputUndo()
      input.setMode("normal")
      input.setPopover(null)
    }

    const restoreInput = () => {
      prompt.set(currentPrompt, input.promptLength(currentPrompt))
      input.resetInputUndo(currentPrompt, input.promptLength(currentPrompt))
      input.setMode(mode)
      input.setPopover(null)
      requestAnimationFrame(() => {
        const editor = input.editor()
        if (!editor) return
        editor.focus()
        setCursorPosition(editor, input.promptLength(currentPrompt))
        input.queueScroll()
      })
    }

    if (!isNewSession && mode === "normal" && input.shouldQueue?.()) {
      input.onQueue?.(draft)
      clearContext()
      clearInput()
      return
    }

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
        clearInput()
        client.session
          .command({
            sessionID: session.id,
            messageID,
            command: commandName,
            arguments: args.join(" "),
            agent,
            model: `${model.providerID}/${model.modelID}`,
            variant,
            parts: images.map((attachment) => ({
              id: Identifier.ascending("part"),
              type: "file" as const,
              mime: attachment.mime,
              url: attachment.dataUrl,
              filename: attachment.filename,
            })),
          })
          .catch(async (err) => {
            if (await delivered(client, session.id, messageID)) return
            showToast({
              title: language.t("prompt.toast.commandSendFailed.title"),
              description: formatServerError(err, language.t, language.t("common.requestFailed")),
            })
            restoreInput()
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
    performance.mark("submit:clear-input:start")
    clearInput()
    performance.mark("submit:clear-input:end")
    performance.measure("submit:clear-input", "submit:clear-input:start", "submit:clear-input:end")
    performance.measure("submit:sync-path", "submit:start", "submit:clear-input:end")

    requestAnimationFrame(() => {
      performance.mark("submit:first-raf")
      performance.measure("submit:to-first-raf", "submit:start", "submit:first-raf")
      console.debug(`[perf:submit] first-raf breakdown ${submitMeasureSummary()}`)
      input.onSubmitted?.()
    })

    const waitForWorktree = async () => {
      const worktree = WorktreeState.get(sessionDirectory)
      if (!worktree || worktree.status !== "pending") return true

      if (sessionDirectory === currentDirectory) {
        sync.set("session_status", session.id, { type: "busy" })
      }

      const controller = new AbortController()
      const cleanup = () => {
        if (sessionDirectory === currentDirectory) {
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
      optimisticBusy: sessionDirectory === currentDirectory,
      before: waitForWorktree,
    }).catch((err) => {
      if (aborted(err)) return
      pending.delete(session.id)
      if (sessionDirectory === currentDirectory) {
        sync.set("session_status", session.id, { type: "idle" })
      }
      showToast({
        title: language.t("prompt.toast.promptSendFailed.title"),
        description: errorMessage(err),
      })
      removeOptimisticMessage()
      restoreCommentItems(commentItems)
      restoreInput()
    })
  }

  return {
    abort,
    handleSubmit,
  }
}
