import type { Message } from "@/types"
import type { SessionInfo } from "@opencode-ai/client/promise"
import { showToast } from "@/utils/toast"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { Binary } from "@opencode-ai/core/util/binary"
import { useNavigate, useParams, useSearchParams } from "@solidjs/router"
import { batch, startTransition, type Accessor } from "solid-js"
import { useTabs } from "@/context/tabs"
import { useServerSync, type ServerSync } from "@/context/server-sync"
import { useLanguage } from "@/context/language"
import { useLocal, type ModelSelection } from "@/context/local"
import { usePermission } from "@/context/permission"
import { type ContextItem, type ImageAttachmentPart, type Prompt, type usePrompt } from "@/context/prompt"
import { useSDK, type DirectorySDK } from "@/context/sdk"
import { useSync, type DirectorySync } from "@/context/sync"
import { Identifier } from "@/utils/id"
import { getDirectory } from "@opencode-ai/core/util/path"
import { buildRequestParts } from "./build-request-parts"
import { setCursorPosition } from "./editor-dom"
import { formatServerError } from "@/utils/server-errors"
import { ScopedKey } from "@/utils/server-scope"
import { createPromptSubmissionState } from "./submission-state"
import { Event } from "@opencode-ai/schema/event"
import { blobDataUrl } from "@/utils/draft-store"

const submitting = new Set<string>()

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
  api: DirectorySDK["api"]["session"]
  serverSync: ServerSync
  sync: DirectorySync
  session: Accessor<{ agent?: string; model?: { id: string; providerID: string; variant?: string } } | undefined>
  draft: FollowupDraft
  messageID?: string
  optimisticBusy?: boolean
}

const draftText = (prompt: Prompt) => prompt.map((part) => ("content" in part ? part.content : "")).join("")

const draftImages = (prompt: Prompt) => prompt.filter((part): part is ImageAttachmentPart => part.type === "image")

export async function sendFollowupDraft(input: FollowupSendInput) {
  const text = draftText(input.draft.prompt)
  const images = draftImages(input.draft.prompt)
  const setBusy = () => {
    if (!input.optimisticBusy) return
    input.serverSync.session.set("session_status", input.draft.sessionID, { type: "busy" })
  }

  const setIdle = () => {
    if (!input.optimisticBusy) return
    input.serverSync.session.set("session_status", input.draft.sessionID, { type: "idle" })
  }

  const [head, ...tail] = text.split(" ")
  const cmd = head?.startsWith("/") ? head.slice(1) : undefined
  if (cmd && input.sync.data.command.find((item) => item.name === cmd)) {
    setBusy()
    try {
      const messageID = Identifier.ascending("message")
      await input.api.command({
        sessionID: input.draft.sessionID,
        id: messageID,
        command: cmd,
        arguments: tail.join(" "),
        agent: input.draft.agent,
        model: {
          id: input.draft.model.modelID,
          providerID: input.draft.model.providerID,
          variant: input.draft.variant,
        },
        files: await Promise.all(
          images.map(async (attachment) => ({
            uri: await blobDataUrl(attachment.blob, attachment.mime),
            name: attachment.filename,
          })),
        ),
      })
      return true
    } catch (err) {
      setIdle()
      throw err
    }
  }

  const messageID = input.messageID ?? Identifier.ascending("message")
  const encodedImages = await Promise.all(
    images.map(async (attachment) => ({
      ...attachment,
      dataUrl: await blobDataUrl(attachment.blob, attachment.mime),
    })),
  )
  const { requestParts, optimisticParts } = buildRequestParts({
    prompt: input.draft.prompt,
    context: input.draft.context,
    images: encodedImages,
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

  batch(() => {
    setBusy()
    add()
  })

  try {
    const session = input.session()
    if (session?.agent !== input.draft.agent) {
      await input.api.switchAgent({ sessionID: input.draft.sessionID, agent: input.draft.agent })
    }
    if (
      session?.model?.providerID !== input.draft.model.providerID ||
      session.model.id !== input.draft.model.modelID ||
      (session.model.variant ?? "default") !== (input.draft.variant ?? "default")
    ) {
      await input.api.switchModel({
        sessionID: input.draft.sessionID,
        model: {
          id: input.draft.model.modelID,
          providerID: input.draft.model.providerID,
          variant: input.draft.variant,
        },
      })
    }

    await input.api.prompt({
      sessionID: input.draft.sessionID,
      id: messageID,
      text: requestParts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n"),
      files: requestParts.flatMap((part) => {
        if (part.type !== "file") return []
        const text = part.source?.text
        return [
          {
            uri: part.url,
            name: part.filename,
            mention: text ? { start: text.start, end: text.end, text: text.value } : undefined,
          },
        ]
      }),
      agents: requestParts.flatMap((part) =>
        part.type === "agent"
          ? [
              {
                name: part.name,
                mention: part.source
                  ? { start: part.source.start, end: part.source.end, text: part.source.value }
                  : undefined,
              },
            ]
          : [],
      ),
    })
    return true
  } catch (err) {
    batch(() => {
      setIdle()
      remove()
    })
    throw err
  }
}

type PromptSubmitInput = {
  prompt: ReturnType<typeof usePrompt>
  info: Accessor<
    { id: string; agent?: string; model?: { id: string; providerID: string; variant?: string } } | undefined
  >
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
  shouldQueue?: Accessor<boolean>
  onQueue?: (draft: FollowupDraft) => void
  onAbort?: () => void
  onSubmit?: () => void
  model?: ModelSelection
}

export function createPromptSubmit(input: PromptSubmitInput) {
  const navigate = useNavigate()
  const sdk = useSDK()
  const sync = useSync()
  const serverSync = useServerSync()
  const local = useLocal()
  const permission = usePermission()
  const prompt = input.prompt
  const language = useLanguage()
  const params = useParams()
  const [search] = useSearchParams<{ draftId?: string }>()
  const tabs = useTabs()
  const errorMessage = (err: unknown) => {
    if (err && typeof err === "object" && "message" in err && typeof err.message === "string") return err.message
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
    serverSync.session.set("todo", sessionID, [])

    input.onAbort?.()

    return sdk()
      .api.session.interrupt({ sessionID })
      .catch(() => {})
  }

  const restoreCommentItems = (
    target: ReturnType<ReturnType<typeof usePrompt>["capture"]>,
    items: (ContextItem & { key: string })[],
  ) => {
    for (const item of items) {
      target.context.add({
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

  const clearContext = (target: ReturnType<ReturnType<typeof usePrompt>["capture"]>) => {
    for (const item of target.context.items()) {
      target.context.remove(item.key)
    }
  }

  const seed = (target: ServerSync, dir: string, info: SessionInfo) => {
    target.session.remember(info)
    const [, setStore] = target.child(dir)
    setStore("session", (list: SessionInfo[]) => {
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

    const target = prompt.capture()
    const submission = createPromptSubmissionState({
      target,
      prompt: target.current(),
      context: target.context.items().slice(),
    })
    const currentPrompt = submission.prompt
    const context = submission.context
    const text = currentPrompt.map((part) => ("content" in part ? part.content : "")).join("")
    const images = input.imageAttachments().slice()
    const mode = input.mode()

    if (text.trim().length === 0 && images.length === 0 && input.commentCount() === 0) {
      if (input.working()) void abort()
      return
    }
    const modelSelection = input.model ?? local.model
    const currentModel = modelSelection.current()
    const currentAgent = local.agent.current()
    const variant = modelSelection.variant.current()
    if (!currentModel || !currentAgent) {
      showToast({
        title: language.t("prompt.toast.modelAgentRequired.title"),
        description: language.t("prompt.toast.modelAgentRequired.description"),
      })
      return
    }

    const submissionSDK = sdk()
    const submissionSync = sync()
    const submissionServerSync = serverSync
    const submissionScope = submissionSDK.scope
    const projectDirectory = submissionSDK.directory
    const sessionID = params.id
    const isNewSession = !sessionID
    const currentSession = input.info()
    const draftID = search.draftId
    const draftServer = draftID ? tabs.draft(draftID).server : undefined
    const capturePrompt = prompt.capture
    const localSession = local.session
    const resetWorktree = input.onNewSessionWorktreeReset
    const onSubmit = input.onSubmit
    const permissionState = permission
    const shouldAutoAccept = isNewSession && input.autoAccept()
    const worktreeSelection = input.newSessionWorktree?.() || "main"
    const submissionKey = ScopedKey.from(
      submissionScope,
      draftID ? `draft:${draftID}` : sessionID ? `session:${sessionID}` : `directory:${projectDirectory}`,
    )
    if (submitting.has(submissionKey)) return
    submitting.add(submissionKey)

    try {
      input.addToHistory(currentPrompt, mode)
      input.resetHistoryNavigation()

      let sessionDirectory = projectDirectory
      if (isNewSession) {
        if (worktreeSelection === "create") {
          const createdWorktree = await submissionSDK.api.worktree
            .create({
              projectID: submissionSync.data.project,
              strategy: "git",
              directory: getDirectory(submissionSync.project?.worktree ?? projectDirectory),
            })
            .then(async (created) => {
              await submissionSDK.api.location.get({ location: { directory: created.directory } })
              return created
            })
            .catch((err) => {
              showToast({
                title: language.t("prompt.toast.worktreeCreateFailed.title"),
                description: errorMessage(err),
              })
            })

          if (!createdWorktree) return
          sessionDirectory = createdWorktree.directory
        }

        if (worktreeSelection !== "main" && worktreeSelection !== "create") {
          sessionDirectory = worktreeSelection
        }

        if (sessionDirectory !== projectDirectory) {
          submissionServerSync.child(sessionDirectory)
        }
      }

      let session = currentSession
      if (!session && isNewSession) {
        const created = await submissionSDK.api.session
          .create({
            agent: currentAgent.name,
            model: { id: currentModel.id, providerID: currentModel.provider.id, variant },
            location: { directory: sessionDirectory },
          })
          .catch((err) => {
            showToast({
              title: language.t("prompt.toast.sessionCreateFailed.title"),
              description: errorMessage(err),
            })
            return undefined
          })
        if (created) {
          seed(submissionServerSync, sessionDirectory, created)
          session = created
          await startTransition(() => {
            if (!session) return
            if (draftID) tabs.updateDraft(draftID, { worktree: undefined })
            if (!draftID) resetWorktree?.()
            if (shouldAutoAccept) permissionState.enableAutoAccept(session.id, sessionDirectory)
            localSession.promote(sessionDirectory, session.id, {
              agent: currentAgent.name,
              model: { providerID: currentModel.provider.id, modelID: currentModel.id },
              variant: variant ?? null,
            })
            if (draftID && draftServer) tabs.promoteDraft(draftID, { server: draftServer, sessionId: session.id })
            else navigate(`/${base64Encode(sessionDirectory)}/session/${session.id}`)
            submission.retarget(
              capturePrompt(
                { dir: base64Encode(sessionDirectory), id: session.id },
                { server: draftServer, scope: submissionScope },
              ),
            )
          })
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
        submission.clear()
        input.setMode("normal")
        input.setPopover(null)
      }

      const restoreInput = () => {
        const restored = submission.restore()
        if (!restored) return false
        restored.target.set(restored.prompt, input.promptLength(restored.prompt))
        if (!submission.current(prompt.capture())) return true
        input.setMode(mode)
        input.setPopover(null)
        requestAnimationFrame(() => {
          const editor = input.editor()
          if (!editor) return
          editor.focus()
          setCursorPosition(editor, input.promptLength(currentPrompt))
          input.queueScroll()
        })
        return true
      }

      if (!isNewSession && mode === "normal" && input.shouldQueue?.()) {
        input.onQueue?.(draft)
        clearContext(submission.target())
        clearInput()
        return
      }

      if (!draftID || search.draftId === draftID) onSubmit?.()

      if (mode === "shell") {
        clearInput()
        const eventID = Event.ID.create()
        void submissionSDK.api.session
          .shell({
            sessionID: session.id,
            id: eventID,
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
        const customCommand = submissionSync.data.command.find((c) => c.name === commandName)
        if (customCommand) {
          clearInput()
          const messageID = Identifier.ascending("message")
          submissionServerSync.session.set("session_status", session.id, { type: "busy" })
          void submissionSDK.api.session
            .command({
              sessionID: session.id,
              id: messageID,
              command: commandName,
              arguments: args.join(" "),
              agent,
              model: { id: model.modelID, providerID: model.providerID, variant },
              files: await Promise.all(
                images.map(async (attachment) => ({
                  uri: await blobDataUrl(attachment.blob, attachment.mime),
                  name: attachment.filename,
                })),
              ),
            })
            .catch((err) => {
              submissionServerSync.session.set("session_status", session.id, { type: "idle" })
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
        submissionSync.session.optimistic.remove({
          directory: sessionDirectory,
          sessionID: session.id,
          messageID,
        })
      }

      for (const item of commentItems) submission.target().context.remove(item.key)
      clearInput()

      void sendFollowupDraft({
        api: submissionSDK.api.session,
        sync: submissionSync,
        serverSync: submissionServerSync,
        session: () => session,
        draft,
        messageID,
        optimisticBusy: sessionDirectory === projectDirectory,
      }).catch((err) => {
        if (sessionDirectory === projectDirectory) {
          submissionSync.set("session_status", session.id, { type: "idle" })
        }
        showToast({
          title: language.t("prompt.toast.promptSendFailed.title"),
          description: errorMessage(err),
        })
        removeOptimisticMessage()
        if (restoreInput()) restoreCommentItems(submission.target(), commentItems)
      })
    } finally {
      submitting.delete(submissionKey)
    }
  }

  return {
    abort,
    handleSubmit,
  }
}
