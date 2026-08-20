import type { Data } from "@opencode-ai/client/solid"
import { showToast } from "@/utils/toast"
import { base64Encode } from "@opencode-ai/util/encode"
import { useNavigate, useParams, useSearchParams } from "@solidjs/router"
import { startTransition, type Accessor } from "solid-js"
import { useTabs } from "@/context/tabs"
import { useData } from "@/context/server"
import { useLanguage } from "@/context/language"
import { useLocal, type ModelSelection } from "@/context/local"
import { usePermission } from "@/context/permission"
import { type ContextItem, type ImageAttachmentPart, type Prompt, type usePrompt } from "@/context/prompt"
import { useWorkspaceLocation } from "@/context/location"
import { useServerSDK, type ServerSDK } from "@/context/server-sdk"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { getDirectory } from "@opencode-ai/util/path"
import { buildPromptRequest } from "./build-prompt-request"
import { setCursorPosition } from "./editor-dom"
import { formatServerError } from "@/utils/server-errors"
import { ScopedKey } from "@/utils/server-scope"
import { createPromptSubmissionState } from "./submission-state"
import { Event } from "@opencode-ai/schema/event"
import { blobDataUrl } from "@/utils/draft-store"
import { useServer } from "@/context/server"
import { sessionHref } from "@/utils/session-route"

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
  api: ServerSDK["api"]["session"]
  data: Data
  session: Accessor<{ agent?: string; model?: { id: string; providerID: string; variant?: string } } | undefined>
  draft: FollowupDraft
  optimisticBusy?: boolean
}

const draftText = (prompt: Prompt) => prompt.map((part) => ("content" in part ? part.content : "")).join("")

const draftImages = (prompt: Prompt) => prompt.filter((part): part is ImageAttachmentPart => part.type === "image")

export async function sendFollowupDraft(input: FollowupSendInput) {
  const text = draftText(input.draft.prompt)
  const images = draftImages(input.draft.prompt)
  const setBusy = () => {
    if (!input.optimisticBusy) return
    input.data.session.setStatus(input.draft.sessionID, "running")
  }

  const setIdle = () => {
    if (!input.optimisticBusy) return
    input.data.session.setStatus(input.draft.sessionID, "idle")
  }

  const [head, ...tail] = text.split(" ")
  const cmd = head?.startsWith("/") ? head.slice(1) : undefined
  if (
    cmd &&
    input.data.location.command.list({ directory: input.draft.sessionDirectory })?.some((item) => item.name === cmd)
  ) {
    setBusy()
    try {
      await input.api.command({
        sessionID: input.draft.sessionID,
        id: SessionMessage.ID.create(),
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

  const encodedImages = await Promise.all(
    images.map(async (attachment) => ({
      ...attachment,
      dataUrl: await blobDataUrl(attachment.blob, attachment.mime),
    })),
  )
  const request = buildPromptRequest({
    prompt: input.draft.prompt,
    context: input.draft.context,
    images: encodedImages,
    text,
    sessionDirectory: input.draft.sessionDirectory,
  })

  setBusy()

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

    // The data layer admits optimistically under a client-minted ID: the
    // prompt renders immediately and rolls back if the server rejects it.
    await input.data.session.prompt({
      sessionID: input.draft.sessionID,
      text: request.text,
      files: request.files.map((file) => ({ uri: file.uri, name: file.name, mention: file.mention })),
      agents: request.agents,
      metadata: {
        displayText: request.displayText,
        comments: request.comments,
        agent: input.draft.agent,
        model: {
          ...input.draft.model,
          ...(input.draft.variant ? { variant: input.draft.variant } : {}),
        },
      },
    })
    return true
  } catch (err) {
    setIdle()
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
  const sdk = useWorkspaceLocation()
  const serverSDK = useServerSDK()
  const data = useData()
  const server = useServer()
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
    input.onAbort?.()

    return serverSDK.api.session.interrupt({ sessionID }).catch(() => {})
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
    const submissionServerSDK = serverSDK
    const submissionData = data
    const submissionScope = submissionServerSDK.scope
    const submissionServer = server.key
    const projectDirectory = submissionSDK.directory
    const sessionID = params.id
    const isNewSession = !sessionID
    const currentSession = input.info()
    const draftID = search.draftId
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
          const createdWorktree = await submissionServerSDK.api.worktree
            .create({
              projectID: submissionData.location.info({ directory: projectDirectory })?.project.id ?? "",
              strategy: "git",
              directory: getDirectory(
                submissionData.location.info({ directory: projectDirectory })?.project.directory ?? projectDirectory,
              ),
            })
            .then(async (created) => {
              await submissionServerSDK.api.location.get({ location: { directory: created.directory } })
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
      }

      let session = currentSession
      if (!session && isNewSession) {
        const created = await submissionServerSDK.api.session
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
          submissionData.session.remember(created)
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
            if (draftID) tabs.promoteDraft(draftID, { server: submissionServer, sessionId: session.id })
            else navigate(sessionHref(submissionServer, session.id))
            submission.retarget(
              capturePrompt(
                { dir: base64Encode(sessionDirectory), id: session.id },
                { server: submissionServer, scope: submissionScope },
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
        void submissionServerSDK.api.session
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
        const customCommand = submissionData.location.command
          .list({ directory: sessionDirectory })
          ?.find((command) => command.name === commandName)
        if (customCommand) {
          clearInput()
          submissionData.session.setStatus(session.id, "running")
          void submissionServerSDK.api.session
            .command({
              sessionID: session.id,
              id: SessionMessage.ID.create(),
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
              submissionData.session.setStatus(session.id, "idle")
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

      for (const item of commentItems) submission.target().context.remove(item.key)
      clearInput()

      void sendFollowupDraft({
        api: submissionServerSDK.api.session,
        data: submissionData,
        session: () => session,
        draft,
        optimisticBusy: sessionDirectory === projectDirectory,
      }).catch((err) => {
        if (sessionDirectory === projectDirectory) {
          submissionData.session.setStatus(session.id, "idle")
        }
        showToast({
          title: language.t("prompt.toast.promptSendFailed.title"),
          description: errorMessage(err),
        })
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
