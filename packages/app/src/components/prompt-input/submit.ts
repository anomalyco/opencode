import type { Message, Session } from "@opencode-ai/sdk/v2/client"
import { showToast } from "@/utils/toast"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { Binary } from "@opencode-ai/core/util/binary"
import { useNavigate, useParams, useSearchParams } from "@solidjs/router"
import { batch, type Accessor } from "solid-js"
import type { FileSelection } from "@/context/file"
import { useServer } from "@/context/server"
import { useTabs } from "@/context/tabs"
import { useServerSync, type ServerSync } from "@/context/server-sync"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useLocal } from "@/context/local"
import { usePermission } from "@/context/permission"
import { type ContextItem, type ImageAttachmentPart, type Prompt, type usePrompt } from "@/context/prompt"
import { useSDK, type DirectorySDK } from "@/context/sdk"
import { useSync, type DirectorySync } from "@/context/sync"
import { Identifier } from "@/utils/id"
import { Worktree as WorktreeState } from "@/utils/worktree"
import { buildRequestParts } from "./build-request-parts"
import { setCursorPosition } from "./editor-dom"
import { formatServerError } from "@/utils/server-errors"
import { ScopedKey } from "@/utils/server-scope"
import { buildBudgetPart, buildUltracodeParts } from "./ultracode"
import {
  extractReservedBudget,
  parseWorkflowArgs,
  parseWorkflowCommand,
  resolveDirectWorkflowCommand,
  type WorkflowArgDeclaration,
} from "./workflow-command"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import type { WorkflowInfo } from "@opencode-ai/sdk/v2"
import {
  approvalDecision,
  isApproved,
  nextApprovedList,
  rememberSessionApproval,
} from "@/components/dialog-workflow-approval-helpers"
import { showWorkflowApproval } from "@/components/dialog-workflow-approval"

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
  // Ultracode directives for this turn. Transported separately from the prompt
  // so buildRequestParts can emit them as leading synthetic <system-reminder>
  // parts instead of fusing them into the visible user text (TUI parity).
  directives?: string[]
}

type FollowupSendInput = {
  client: DirectorySDK["client"]
  serverSync: ServerSync
  sync: DirectorySync
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
  const [, setStore] = input.serverSync.child(input.draft.sessionDirectory)

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
  // Backstop (Bonus A): workflow-sourced commands are discovery-only rows with
  // an EMPTY template — executing one via session.command would silently no-op
  // the turn. A `/<name>` draft that still reaches the queue for a workflow
  // therefore falls through to the plain-prompt path below instead.
  if (cmd && input.sync.data.command.find((item) => item.name === cmd && item.source !== "workflow")) {
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
    directives: input.draft.directives,
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
    if (!(await wait())) {
      batch(() => {
        setIdle()
        remove()
      })
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
    batch(() => {
      setIdle()
      remove()
    })
    throw err
  }
}

type PromptSubmitInput = {
  prompt: ReturnType<typeof usePrompt>
  info: Accessor<{ id: string } | undefined>
  imageAttachments: Accessor<ImageAttachmentPart[]>
  commentCount: Accessor<number>
  autoAccept: Accessor<boolean>
  mode: Accessor<"normal" | "shell">
  ultracodeSession: Accessor<boolean>
  openWorkflowDashboard: () => void
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
  const dialog = useDialog()
  const serverSync = useServerSync()
  const local = useLocal()
  const permission = usePermission()
  const prompt = input.prompt
  const layout = useLayout()
  const language = useLanguage()
  const params = useParams()
  const [search] = useSearchParams<{ draftId?: string }>()
  const server = useServer()
  const tabs = useTabs()
  const pendingKey = (sessionID: string) => ScopedKey.from(sdk().scope, sessionID)

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

    serverSync().todo.set(sessionID, [])
    const [, setStore] = serverSync().child(sdk().directory)
    setStore("todo", sessionID, [])

    input.onAbort?.()

    const key = pendingKey(sessionID)
    const queued = pending.get(key)
    if (queued) {
      queued.abort.abort()
      queued.cleanup()
      pending.delete(key)
      return Promise.resolve()
    }
    return sdk()
      .client.session.abort({
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

  const clearContext = () => {
    for (const item of prompt.context.items()) {
      prompt.context.remove(item.key)
    }
  }

  const seed = (dir: string, info: Session) => {
    const [, setStore] = serverSync().child(dir)
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

    if (text.trim().length === 0 && images.length === 0 && input.commentCount() === 0) {
      if (input.working()) void abort()
      return
    }

    // Workflow command routing (parity with the TUI dispatch): `/workflows` and
    // `/workflow` with no name open the dashboard; `/workflow <name>` starts a
    // run. This must run BEFORE the generic /command (session.command) branch so a
    // workflow is never sent as a plain custom command. Only in normal mode.
    const workflowCommand = mode === "normal" ? parseWorkflowCommand(text) : undefined
    // Bonus A: a direct `/<name>` for a DISCOVERED workflow (server-registered
    // command with source:'workflow' and an empty discovery-only template) must
    // start a real run instead of falling into the generic /command branch,
    // which would send session.command with the empty template — no run, no
    // approval gate. Commands keep precedence: this is only consulted when
    // parseWorkflowCommand did not already claim the input.
    const directWorkflow = workflowCommand
      ? undefined
      : mode === "normal"
        ? resolveDirectWorkflowCommand(text, sync().data.command)
        : undefined
    if (workflowCommand?.type === "dashboard") {
      input.addToHistory(currentPrompt, mode)
      input.resetHistoryNavigation()
      prompt.reset()
      input.setMode("normal")
      input.setPopover(null)
      input.openWorkflowDashboard()
      return
    }

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

    const projectDirectory = sdk().directory
    const isNewSession = !params.id
    const shouldAutoAccept = isNewSession && input.autoAccept()
    const worktreeSelection = input.newSessionWorktree?.() || "main"

    let sessionDirectory = projectDirectory
    let client = sdk().client

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
        WorktreeState.pending(sdk().scope, createdWorktree.directory)
        sessionDirectory = createdWorktree.directory
      }

      if (worktreeSelection !== "main" && worktreeSelection !== "create") {
        sessionDirectory = worktreeSelection
      }

      if (sessionDirectory !== projectDirectory) {
        client = sdk().createClient({
          directory: sessionDirectory,
          throwOnError: true,
        })
        serverSync().child(sessionDirectory)
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
        // Item 13: the ultracode toggle was flipped before this session existed
        // — persist the flag now so the very first prompt already gets the
        // server-side standing opt-in (fresh session, nothing to merge).
        if (input.ultracodeSession()) {
          void client.session
            .update({ sessionID: created.id, metadata: { ultracode: true } })
            .catch(() => {})
        }
        if (shouldAutoAccept) permission.enableAutoAccept(session.id, sessionDirectory)
        local.session.promote(sessionDirectory, session.id)
        layout.handoff.setTabs(base64Encode(sessionDirectory), session.id)
        const draftID = search.draftId
        if (draftID) tabs.promoteDraft(draftID, { server: server.key, sessionId: session.id })
        else navigate(`/${base64Encode(sessionDirectory)}/session/${session.id}`)
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

    // `/workflow <name>` (or a direct `/<name>` resolved against the server's
    // workflow-sourced commands) → start the run. Resolve the workflow's declared
    // arguments for type-aware coercion, then call workflow.start with the
    // current session as the permission context (mirror TUI index.tsx:1202-1264).
    // An interactive start is gated behind the approval dialog (parity with the
    // TUI): config.workflows.approval ∈ always/first-run(default)/never decides
    // whether to ask; "Yes, always" persists consent to workflows.approved.
    // Runs BEFORE the queue check so a workflow start is never deferred into the
    // session.command queue path.
    const startCommand = workflowCommand?.type === "start" ? workflowCommand : directWorkflow
    if (startCommand) {
      clearInput()
      const { name, args } = startCommand
      void (async () => {
        try {
          const workflows = await client.workflow
            .list({ directory: sessionDirectory })
            .then((response) => response.data ?? [])
            .catch(() => [] as WorkflowInfo[])
          const info = workflows.find((workflow) => workflow.name === name)
          const declaration = (info?.meta.arguments ?? {}) as WorkflowArgDeclaration
          const parsedArgs = parseWorkflowArgs(args, declaration)

          // Reserved `budget=` argument: a workflow-declared budget argument wins
          // and passes through untouched; otherwise the value becomes the start
          // payload's cost cap (USD). An invalid value aborts the start with a
          // toast — never a silently dropped cap. Validated BEFORE the approval
          // gate so the user is never asked to approve an invalid start.
          const reserved = extractReservedBudget(parsedArgs, declaration)
          if (reserved.invalid !== undefined) {
            showToast({
              title: language.t("toast.workflow.budget.invalid.title"),
              description: language.t("toast.workflow.budget.invalid.description", { value: reserved.invalid }),
            })
            return
          }

          // Approval gate (parity with the TUI start gate). An unknown name has no
          // info, so it cannot render a meaningful dialog — let the start surface
          // the engine's "not found" rather than asking to approve a non-existent
          // workflow. A known workflow follows the configured approval mode.
          const approvedList = sync().data.config?.workflows?.approved ?? []
          const decision = !info
            ? "start"
            : approvalDecision({
                mode: sync().data.config?.workflows?.approval,
                alreadyApproved: isApproved(name, approvedList),
              })
          if (decision === "ask") {
            const reply = await showWorkflowApproval(dialog, { info: info!, args: parsedArgs })
            if (reply === "cancel") {
              showToast({ title: language.t("toast.workflow.approval.cancelled.title", { name }) })
              return
            }
            if (reply === "always") {
              // Remember in-session first so a second start this session never
              // re-asks even before the persisted config re-syncs.
              rememberSessionApproval(name)
              const next = nextApprovedList(name, approvedList)
              if (next)
                await client.config
                  .update({ directory: sessionDirectory, config: { workflows: { approved: next } } })
                  .catch(() => {})
            }
          }

          const result = await client.workflow.start({
            name,
            directory: sessionDirectory,
            workflowStartPayload: {
              args: reserved.args,
              ...(reserved.budget !== undefined ? { budget: reserved.budget } : {}),
              permissionSessionID: session.id,
            },
          })
          showToast({
            title: language.t("toast.workflow.started.title"),
            description: language.t("toast.workflow.started.description", { name }),
          })
          const startedSession = result.data?.session_id
          if (startedSession) navigate(`/${base64Encode(sessionDirectory)}/session/${startedSession}`)
        } catch (err) {
          showToast({
            title: language.t("toast.workflow.start.failed.title"),
            description: errorMessage(err),
          })
        }
      })()
      return
    }

    // Ultracode directive injection on a normal prompt (parity with the TUI's
    // ultracodeParts). The directives travel on draft.directives and become
    // leading synthetic <system-reminder> parts in buildRequestParts — never
    // fused into the visible user text. The keyword is still STRIPPED from the
    // visible text (TUI consistency; the original leaves it standing — that
    // call is owned by the TUI part of this parity item and must stay uniform
    // across UIs). Runs before the queue branch so queued followups carry
    // their directives too. Item 13: only the per-turn keyword directive is
    // injected here — the session toggle lives server-side as
    // session.metadata.ultracode and needs no per-message part.
    if (mode === "normal" && !text.trimStart().startsWith("/")) {
      const keywordEnabled = sync().data.config?.workflows?.ultracode_keyword ?? true
      const ultracode = buildUltracodeParts({ text, keywordEnabled })
      // Budget directive (`+$<n>`): applied AFTER the ultracode strip, on
      // ultracode.text, so the strip order is deterministic (ultracode first,
      // budget second). The config gate (workflows.budget_directive) lands with
      // the engine track's config/SDK regen; the cast keeps the defensive
      // `?? true` read compiling until the generated type carries the field.
      const budgetEnabled =
        (sync().data.config?.workflows as { budget_directive?: boolean } | undefined)?.budget_directive ?? true
      const budget = buildBudgetPart({ text: ultracode.text, enabled: budgetEnabled })
      const directives = [...ultracode.directives, ...(budget.directive !== undefined ? [budget.directive] : [])]
      if (directives.length > 0) {
        draft.directives = directives
        // Strip the keyword/directive from the visible text parts so the user
        // prompt the model sees no longer contains the trigger tokens. Collapse
        // the body to a single text part when stripping (the spans were computed
        // over the joined text) while preserving non-text parts.
        if (budget.text !== text) {
          const nonText = currentPrompt.filter((part) => part.type !== "text")
          draft.prompt = [{ type: "text", content: budget.text, start: 0, end: 0 }, ...nonText]
        }
      }
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
      const customCommand = sync().data.command.find((c) => c.name === commandName)
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
      sync().session.optimistic.remove({
        directory: sessionDirectory,
        sessionID: session.id,
        messageID,
      })
    }

    removeCommentItems(commentItems)
    clearInput()

    const waitForWorktree = async () => {
      const worktree = WorktreeState.get(sdk().scope, sessionDirectory)
      if (!worktree || worktree.status !== "pending") return true

      if (sessionDirectory === projectDirectory) {
        sync().set("session_status", session.id, { type: "busy" })
      }

      const controller = new AbortController()
      const cleanup = () => {
        if (sessionDirectory === projectDirectory) {
          sync().set("session_status", session.id, { type: "idle" })
        }
        removeOptimisticMessage()
        restoreCommentItems(commentItems)
        restoreInput()
      }

      pending.set(pendingKey(session.id), { abort: controller, cleanup })

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

      const result = await Promise.race([
        WorktreeState.wait(sdk().scope, sessionDirectory),
        abortWait,
        timeout,
      ]).finally(() => {
        if (timer.id === undefined) return
        clearTimeout(timer.id)
      })
      pending.delete(pendingKey(session.id))
      if (controller.signal.aborted) return false
      if (result.status === "failed") throw new Error(result.message)
      return true
    }

    void sendFollowupDraft({
      client,
      sync: sync(),
      serverSync: serverSync(),
      draft,
      messageID,
      optimisticBusy: sessionDirectory === projectDirectory,
      before: waitForWorktree,
    }).catch((err) => {
      pending.delete(pendingKey(session.id))
      if (sessionDirectory === projectDirectory) {
        sync().set("session_status", session.id, { type: "idle" })
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
