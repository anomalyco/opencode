import { Accessor } from "solid-js"
import { produce } from "solid-js/store"
import { useNavigate, useParams } from "@solidjs/router"
import { getFilename } from "@opencode-ai/util/path"
import { createOpencodeClient, type Message, type Part } from "@opencode-ai/sdk/v2/client"
import { Binary } from "@opencode-ai/util/binary"
import { showToast } from "@opencode-ai/ui/toast"
import { base64Encode } from "@opencode-ai/util/encode"
import { useLocal } from "@/context/local"
import {
  usePrompt,
  type AgentPart,
  type FileAttachmentPart,
  type ImageAttachmentPart,
  type Prompt,
} from "@/context/prompt"
import { useLayout } from "@/context/layout"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { useGlobalSync } from "@/context/global-sync"
import { usePlatform } from "@/context/platform"
import { useLanguage } from "@/context/language"
import { Identifier } from "@/utils/id"
import { Worktree as WorktreeState } from "@/utils/worktree"
import type { FileSelection } from "@/context/file"
import { setCursorPosition } from "./editor-dom"

type PendingPrompt = {
  abort: AbortController
  cleanup: VoidFunction
}

const pending = new Map<string, PendingPrompt>()

type PromptSubmitInput = {
  info: Accessor<{ id: string } | undefined>
  imageAttachments: Accessor<ImageAttachmentPart[]>
  commentCount: Accessor<number>
  mode: Accessor<"normal" | "shell">
  working: Accessor<boolean>
  editor: () => HTMLDivElement | undefined
  queueScroll: () => void
  promptLength: (prompt: Prompt) => number
  addToHistory: (prompt: Prompt, mode: "normal" | "shell") => void
  resetHistoryNavigation: () => void
  setMode: (mode: "normal" | "shell") => void
  setPopover: (popover: "at" | "slash" | null) => void
  newSessionWorktree?: string
  onNewSessionWorktreeReset?: () => void
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
  const platform = usePlatform()
  const local = useLocal()
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
    const queued = pending.get(sessionID)
    if (queued) {
      queued.abort.abort()
      queued.cleanup()
      pending.delete(sessionID)
      return Promise.resolve()
    }
    return sdk.client.session
      .abort({
        sessionID,
      })
      .catch(() => {})
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

  const handleSubmit = async (event: Event) => {
    event.preventDefault()

    const currentPrompt = prompt.current()
    const text = currentPrompt.map((part) => ("content" in part ? part.content : "")).join("")
    const images = input.imageAttachments().slice()
    const mode = input.mode()

    if (text.trim().length === 0 && images.length === 0 && input.commentCount() === 0) {
      if (input.working()) abort()
      return
    }

    const currentModel = local.model.current()
    const currentAgent = local.agent.current()
    if (!currentModel || !currentAgent) {
      showToast({
        title: language.t("prompt.toast.modelAgentRequired.title"),
        description: language.t("prompt.toast.modelAgentRequired.description"),
      })
      return
    }

    input.addToHistory(currentPrompt, mode)
    input.resetHistoryNavigation()

    const projectDirectory = sdk.directory
    const isNewSession = !params.id
    const worktreeSelection = input.newSessionWorktree ?? "main"

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
        client = createOpencodeClient({
          baseUrl: sdk.url,
          fetch: platform.fetch,
          directory: sessionDirectory,
          throwOnError: true,
        })
        globalSync.child(sessionDirectory)
      }

      input.onNewSessionWorktreeReset?.()
    }

    let session = input.info()
    if (!session && isNewSession) {
      session = await client.session
        .create()
        .then((x) => x.data ?? undefined)
        .catch((err) => {
          showToast({
            title: language.t("prompt.toast.sessionCreateFailed.title"),
            description: errorMessage(err),
          })
          return undefined
        })
      if (session) {
        layout.handoff.setTabs(base64Encode(sessionDirectory), session.id)
        navigate(`/${base64Encode(sessionDirectory)}/session/${session.id}`)
      }
    }
    if (!session) return

    input.onSubmit?.()

    const model = {
      modelID: currentModel.id,
      providerID: currentModel.provider.id,
    }
    const agent = currentAgent.name
    const variant = local.model.variant.current()

    const clearInput = () => {
      prompt.reset()
      input.setMode("normal")
      input.setPopover(null)
    }

    const restoreInput = () => {
      prompt.set(currentPrompt, input.promptLength(currentPrompt))
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
        clearInput()
        client.session
          .command({
            sessionID: session.id,
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
          .catch((err) => {
            showToast({
              title: language.t("prompt.toast.commandSendFailed.title"),
              description: errorMessage(err),
            })
            restoreInput()
          })
        return
      }
    }

    const toAbsolutePath = (path: string) =>
      path.startsWith("/") ? path : (sessionDirectory + "/" + path).replace("//", "/")

    const fileAttachments = currentPrompt.filter((part) => part.type === "file") as FileAttachmentPart[]
    const agentAttachments = currentPrompt.filter((part) => part.type === "agent") as AgentPart[]

    const fileAttachmentParts = fileAttachments.map((attachment) => {
      const absolute = toAbsolutePath(attachment.path)
      const query = attachment.selection
        ? `?start=${attachment.selection.startLine}&end=${attachment.selection.endLine}`
        : ""
      return {
        id: Identifier.ascending("part"),
        type: "file" as const,
        mime: "text/plain",
        url: `file://${absolute}${query}`,
        filename: getFilename(attachment.path),
        source: {
          type: "file" as const,
          text: {
            value: attachment.content,
            start: attachment.start,
            end: attachment.end,
          },
          path: absolute,
        },
      }
    })

    const agentAttachmentParts = agentAttachments.map((attachment) => ({
      id: Identifier.ascending("part"),
      type: "agent" as const,
      name: attachment.name,
      source: {
        value: attachment.content,
        start: attachment.start,
        end: attachment.end,
      },
    }))

    const usedUrls = new Set(fileAttachmentParts.map((part) => part.url))

    const context = prompt.context.items().slice()
    const commentItems = context.filter((item) => item.type === "file" && !!item.comment?.trim())

    const contextParts: Array<
      | {
          id: string
          type: "text"
          text: string
          synthetic?: boolean
        }
      | {
          id: string
          type: "file"
          mime: string
          url: string
          filename?: string
        }
    > = []

    const commentNote = (path: string, selection: FileSelection | undefined, comment: string) => {
      const start = selection ? Math.min(selection.startLine, selection.endLine) : undefined
      const end = selection ? Math.max(selection.startLine, selection.endLine) : undefined
      const range =
        start === undefined || end === undefined
          ? "this file"
          : start === end
            ? `line ${start}`
            : `lines ${start} through ${end}`

      return `The user made the following comment regarding ${range} of ${path}: ${comment}`
    }

    const addContextFile = (item: { path: string; selection?: FileSelection; comment?: string }) => {
      const absolute = toAbsolutePath(item.path)
      const query = item.selection ? `?start=${item.selection.startLine}&end=${item.selection.endLine}` : ""
      const url = `file://${absolute}${query}`

      const comment = item.comment?.trim()
      if (!comment && usedUrls.has(url)) return
      usedUrls.add(url)

      if (comment) {
        contextParts.push({
          id: Identifier.ascending("part"),
          type: "text",
          text: commentNote(item.path, item.selection, comment),
          synthetic: true,
        })
      }

      contextParts.push({
        id: Identifier.ascending("part"),
        type: "file",
        mime: "text/plain",
        url,
        filename: getFilename(item.path),
      })
    }

    for (const item of context) {
      if (item.type !== "file") continue
      addContextFile({ path: item.path, selection: item.selection, comment: item.comment })
    }

    const imageAttachmentParts = images.map((attachment) => ({
      id: Identifier.ascending("part"),
      type: "file" as const,
      mime: attachment.mime,
      url: attachment.dataUrl,
      filename: attachment.filename,
    }))

    const messageID = Identifier.ascending("message")
    const requestParts = [
      {
        id: Identifier.ascending("part"),
        type: "text" as const,
        text,
      },
      ...fileAttachmentParts,
      ...contextParts,
      ...agentAttachmentParts,
      ...imageAttachmentParts,
    ]

    const optimisticParts = requestParts.map((part) => ({
      ...part,
      sessionID: session.id,
      messageID,
    })) as unknown as Part[]

    const optimisticMessage: Message = {
      id: messageID,
      sessionID: session.id,
      role: "user",
      time: { created: Date.now() },
      agent,
      model,
    }

    const addOptimisticMessage = () => {
      if (sessionDirectory === projectDirectory) {
        sync.set(
          produce((draft) => {
            const messages = draft.message[session.id]
            if (!messages) {
              draft.message[session.id] = [optimisticMessage]
            } else {
              const result = Binary.search(messages, messageID, (m) => m.id)
              messages.splice(result.index, 0, optimisticMessage)
            }
            draft.part[messageID] = optimisticParts
              .filter((part) => !!part?.id)
              .slice()
              .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
          }),
        )
        return
      }

      globalSync.child(sessionDirectory)[1](
        produce((draft) => {
          const messages = draft.message[session.id]
          if (!messages) {
            draft.message[session.id] = [optimisticMessage]
          } else {
            const result = Binary.search(messages, messageID, (m) => m.id)
            messages.splice(result.index, 0, optimisticMessage)
          }
          draft.part[messageID] = optimisticParts
            .filter((part) => !!part?.id)
            .slice()
            .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        }),
      )
    }

    const removeOptimisticMessage = () => {
      if (sessionDirectory === projectDirectory) {
        sync.set(
          produce((draft) => {
            const messages = draft.message[session.id]
            if (messages) {
              const result = Binary.search(messages, messageID, (m) => m.id)
              if (result.found) messages.splice(result.index, 1)
            }
            delete draft.part[messageID]
          }),
        )
        return
      }

      globalSync.child(sessionDirectory)[1](
        produce((draft) => {
          const messages = draft.message[session.id]
          if (messages) {
            const result = Binary.search(messages, messageID, (m) => m.id)
            if (result.found) messages.splice(result.index, 1)
          }
          delete draft.part[messageID]
        }),
      )
    }

    removeCommentItems(commentItems)
    clearInput()
    addOptimisticMessage()

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
          resolve({ status: "failed", message: language.t("workspace.error.stillPreparing") })
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

    const send = async () => {
      const ok = await waitForWorktree()
      if (!ok) return
      await client.session.prompt({
        sessionID: session.id,
        agent,
        model,
        messageID,
        parts: requestParts,
        variant,
      })
    }

    void send().catch((err) => {
      pending.delete(session.id)
      if (sessionDirectory === projectDirectory) {
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
