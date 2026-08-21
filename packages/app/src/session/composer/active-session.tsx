import type { SessionUserActions } from "@opencode-ai/session-ui/message"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { getFilename } from "@opencode-ai/util/path"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { isScrollKeyTarget, scrollKey, scrollKeyOwner } from "@opencode-ai/ui/scroll-view"
import { useMutation } from "@tanstack/solid-query"
import { makeEventListener } from "@solid-primitives/event-listener"
import { useNavigate, useSearchParams } from "@solidjs/router"
import { createEffect, createMemo, on, onMount, Show, untrack, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { PromptInputV2Composer, usePromptInputV2Controller } from "@/components/prompt-input-v2"
import { setCursorPosition } from "@/components/prompt-input/editor-dom"
import { promptLength } from "@/components/prompt-input/history"
import type { FollowupDraft } from "@/components/prompt-input/submit"
import { useComments } from "@/context/comments"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useLocal } from "@/context/local"
import { usePlatform } from "@/context/platform"
import { usePrompt } from "@/context/prompt"
import { useWorkspaceLocation } from "@/context/location"
import { useServerSDK } from "@/context/server-sdk"
import { useComposerCommands } from "../commands/use-composer-commands"
import { useSessionCommands } from "../commands/use-session-commands"
import type { SessionModel } from "../model"
import type { SessionScreenLayout } from "../screen-layout"
import { restorePromptModel, syncPromptModel, syncSessionModel } from "../session-model-helpers"
import type { SessionTimelineInteraction } from "../timeline/interaction"
import { Persist, persisted } from "@/utils/persist"
import { requireServerKey, sessionHref } from "@/utils/session-route"
import {
  createPromptInputController,
  createSessionComposerController,
  createSessionComposerRegionController,
  SessionComposerRegion,
} from "./index"

type FollowupItem = FollowupDraft & { id: string }
type FollowupEdit = Pick<FollowupItem, "id" | "prompt" | "context">
const emptyFollowups: FollowupItem[] = []

export function createActiveSessionComposer(input: {
  session: SessionModel
  screen: SessionScreenLayout
  timeline: SessionTimelineInteraction
  deferRender: Accessor<boolean>
}) {
  const comments = useComments()
  const command = useCommand()
  const dialog = useDialog()
  const language = useLanguage()
  const local = useLocal()
  const location = useWorkspaceLocation()
  const navigate = useNavigate()
  const platform = usePlatform()
  const prompt = usePrompt()
  const server = useServerSDK()
  const [searchParams, setSearchParams] = useSearchParams<{ prompt?: string }>()
  const state = createSessionComposerController()
  const controls = createPromptInputController({
    sessionKey: input.session.identity.sessionKey,
    sessionID: () => input.session.identity.params.id,
  })
  const [view, setView] = createStore({ newSessionWorktree: "main" })
  const [followup, setFollowup] = persisted(
    Persist.serverWorkspace(server.scope, location().directory, "followup"),
    createStore<{
      items: Record<string, FollowupItem[] | undefined>
      failed: Record<string, string | undefined>
      paused: Record<string, boolean | undefined>
      edit: Record<string, FollowupEdit | undefined>
    }>({ items: {}, failed: {}, paused: {}, edit: {} }),
  )
  let promptRef: HTMLDivElement | undefined

  createEffect(() => {
    if (!prompt.ready()) return
    untrack(() => {
      if (input.session.identity.params.id) return
      const text = searchParams.prompt
      if (!text) return
      prompt.set([{ type: "text", content: text, start: 0, end: text.length }], text.length)
      setSearchParams({ ...searchParams, prompt: undefined })
    })
  })
  createEffect(
    on(
      () => [input.timeline.lastUserMessage(), input.session.data.info()] as const,
      () => {
        const message = input.timeline.lastUserMessage()
        const info = input.session.data.info()
        const metadata = message?.metadata
        const agent = typeof metadata?.agent === "string" ? metadata.agent : info?.agent
        const model = metadata?.model
        const selected =
          model &&
          typeof model === "object" &&
          !Array.isArray(model) &&
          typeof model.providerID === "string" &&
          typeof model.modelID === "string"
            ? {
                providerID: model.providerID,
                modelID: model.modelID,
                variant: typeof model.variant === "string" ? model.variant : undefined,
              }
            : info?.model
              ? { providerID: info.model.providerID, modelID: info.model.id, variant: info.model.variant }
              : undefined
        if (info && agent && selected) syncSessionModel(local, { sessionID: info.id, agent, model: selected })
      },
    ),
  )
  let restoredModelSession: string | undefined
  createEffect(() => {
    const id = input.session.identity.params.id
    if (!id || !prompt.ready() || !local.session.ready()) return
    if (restoredModelSession !== id) {
      restoredModelSession = id
      if (restorePromptModel(local, prompt)) return
    }
    syncPromptModel(local, prompt)
  })
  createEffect(
    on(
      () => ({ directory: location().directory, id: input.session.identity.params.id }),
      (next, previous) => {
        if (!previous || (next.directory === previous.directory && next.id === previous.id)) return
        if (previous.id && !next.id) local.session.reset()
      },
      { defer: true },
    ),
  )
  createEffect(
    on(
      () => location().directory,
      (directory) => {
        if (directory) setView("newSessionWorktree", "main")
      },
      { defer: true },
    ),
  )
  const newSessionWorktree = createMemo(() => {
    if (view.newSessionWorktree === "create") return "create"
    const project = input.session.project()
    if (project && location().directory !== project.worktree) return location().directory
    return "main"
  })
  const queuedFollowups = createMemo(() => {
    const id = input.session.identity.params.id
    return id ? (followup.items[id] ?? emptyFollowups) : emptyFollowups
  })
  const editingFollowup = createMemo<FollowupEdit | undefined>(() => {
    const id = input.session.identity.params.id
    return id ? followup.edit[id] : undefined
  })
  const followupMutation = useMutation(() => ({
    mutationFn: async (request: { sessionID: string; id: string; manual?: boolean }) => {
      if (!(followup.items[request.sessionID] ?? []).some((entry) => entry.id === request.id)) return
      if (request.manual) setFollowup("paused", request.sessionID, undefined)
      setFollowup("failed", request.sessionID, undefined)
      // TODO: Restore queued followups once submission uses current admission APIs.
      setFollowup("failed", request.sessionID, request.id)
    },
  }))
  const followupBusy = (sessionID: string) =>
    followupMutation.isPending && followupMutation.variables?.sessionID === sessionID
  const sendingFollowup = createMemo<string | undefined>(() => {
    const id = input.session.identity.params.id
    return id && followupBusy(id) ? followupMutation.variables?.id : undefined
  })
  const followupText = (item: FollowupDraft) => {
    const text = item.prompt
      .map((part) => {
        if (part.type === "image") return `[image:${part.filename}]`
        if (part.type === "file") return `[file:${part.path}]`
        if (part.type === "agent") return `@${part.name}`
        return part.content
      })
      .join("")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => !!line)
    return text || `[${language.t("common.attachment")}]`
  }
  const sendFollowup = (sessionID: string, id: string, manual?: boolean) => {
    if (input.session.shared.data.session.get(sessionID)?.parentID) return Promise.resolve()
    if (!(followup.items[sessionID] ?? []).some((entry) => entry.id === id) || followupBusy(sessionID)) {
      return Promise.resolve()
    }
    return followupMutation.mutateAsync({ sessionID, id, manual })
  }
  const editFollowup = (id: string) => {
    const sessionID = input.session.identity.params.id
    if (!sessionID || followupBusy(sessionID)) return
    const item = queuedFollowups().find((entry) => entry.id === id)
    if (!item) return
    setFollowup("items", sessionID, (items) => (items ?? []).filter((entry) => entry.id !== id))
    setFollowup("failed", sessionID, (value) => (value === id ? undefined : value))
    setFollowup("edit", sessionID, { id: item.id, prompt: item.prompt, context: item.context })
  }
  const openAttachment: NonNullable<SessionUserActions["openAttachment"]> = (file) => {
    const url = file.source.type === "uri" ? file.source.uri : `data:${file.mime};base64,${file.data}`
    const download = () => {
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = getFilename(file.name) || "attachment"
      anchor.click()
    }
    const path = file.name ?? ""
    const absolute = path.startsWith("/") || path.startsWith("\\\\") || /^[a-zA-Z]:[\\/]/.test(path)
    if (!platform.revealPath || !absolute) return download()
    void platform.revealPath(path).then((revealed) => {
      if (!revealed) download()
    }, download)
  }
  createEffect(() => {
    const sessionID = input.session.identity.params.id
    const item = queuedFollowups()[0]
    if (!sessionID || !item || followupBusy(sessionID)) return
    if (followup.failed[sessionID] === item.id || followup.paused[sessionID]) return
    if (input.session.data.isChild() || state.blocked() || input.session.data.working()) return
    void sendFollowup(sessionID, item.id)
  })
  const focus = () => {
    if (!input.session.data.isChild()) promptRef?.focus()
  }
  createEffect(
    on(
      () => input.session.identity.params.id,
      (id) => {
        if (!id) requestAnimationFrame(focus)
      },
    ),
  )
  const editable = (target: EventTarget | null | undefined) => {
    if (!(target instanceof HTMLElement)) return false
    return /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName) || target.isContentEditable
  }
  const activeElement = () => {
    let current: Element | null = document.activeElement
    while (current instanceof HTMLElement && current.shadowRoot?.activeElement)
      current = current.shadowRoot.activeElement
    return current instanceof HTMLElement ? current : undefined
  }
  const handleKeyDown = (event: KeyboardEvent) => {
    const path = event.composedPath()
    const target = path.find((item): item is HTMLElement => item instanceof HTMLElement)
    const active = activeElement()
    if (
      path.some((item) => item instanceof HTMLElement && item.closest("[data-prevent-autofocus]") !== null) ||
      editable(target) ||
      (active && (active.closest("[data-prevent-autofocus]") || editable(active))) ||
      dialog.active
    )
      return
    if (active === promptRef) {
      if (event.key === "Escape") promptRef?.blur()
      return
    }
    const key = scrollKey(event)
    if (key) {
      const scroller = input.timeline.scroller()
      if (!scroller || !isScrollKeyTarget(target ?? null, key)) return
      if (scrollKeyOwner(scroller, target ?? null, key) !== scroller) return
      input.timeline.view.markGesture(scroller)
      return
    }
    if (event.key.length !== 1 || event.key === "Unidentified" || event.ctrlKey || event.metaKey) return
    if (state.blocked() || input.session.data.isChild() || !promptRef) return
    promptRef.focus()
    setCursorPosition(promptRef, prompt.cursor() ?? promptLength(prompt.current()))
  }
  onMount(() => makeEventListener(document, "keydown", handleKeyDown))
  useComposerCommands()
  useSessionCommands({
    session: input.session,
    background: {
      blocking: () => state.background.blocking().length > 0,
      move: state.background.move,
    },
    navigateMessageByOffset: input.timeline.actions.navigateMessage,
    setActiveMessage: input.timeline.actions.setActiveMessage,
    focusInput: focus,
  })
  command.register("session-palette", () => [
    {
      id: "command.palette",
      title: language.t("command.palette"),
      hidden: true,
      onSelect: () => command.trigger("file.open", "palette"),
    },
  ])

  return {
    actions: {
      focus,
      timeline: { revert: () => undefined, openAttachment } satisfies SessionUserActions,
    },
    blocked: state.blocked,
    background: state.background,
    newSessionWorktree,
    queue: {
      edit: editingFollowup,
      enabled: () => false,
      enqueue: (draft: FollowupDraft) => {
        setFollowup("items", draft.sessionID, (items) => [
          ...(items ?? []),
          { id: SessionMessage.ID.create(), ...draft },
        ])
        setFollowup("failed", draft.sessionID, undefined)
        setFollowup("paused", draft.sessionID, undefined)
      },
      onEditLoaded: () => {
        const id = input.session.identity.params.id
        if (id) setFollowup("edit", id, undefined)
      },
      pause: () => {
        const id = input.session.identity.params.id
        if (id) setFollowup("paused", id, true)
      },
    },
    region: {
      centered: input.screen.centered,
      followup: () =>
        input.session.identity.params.id && !input.session.data.isChild()
          ? {
              items: queuedFollowups().map((item) => ({ id: item.id, text: followupText(item) })),
              sending: sendingFollowup(),
              onSend: (id: string) => void sendFollowup(input.session.identity.params.id!, id, true),
              onEdit: editFollowup,
            }
          : undefined,
      openParent: () => {
        const id = input.session.data.parentID()
        if (id) navigate(sessionHref(requireServerKey(input.session.identity.params.serverKey), id))
      },
      prompt,
      ready: () => !input.deferRender() && input.timeline.ready(),
      setDockRef: input.timeline.view.setDockRef,
      setPromptRef: (element: HTMLDivElement) => {
        promptRef = element
      },
      state,
    },
    input: {
      controls,
      setPromptRef: (element: HTMLDivElement) => {
        promptRef = element
      },
    },
    resetWorktree: () => setView("newSessionWorktree", "main"),
    submit: () => {
      comments.clear()
      input.timeline.actions.resume()
    },
    workspaceMoveEligible: createMemo(() => {
      const id = input.session.identity.params.id
      if (!id) return false
      return (
        (followup.items[id]?.length ?? 0) === 0 && !followup.failed[id] && !followup.paused[id] && !followup.edit[id]
      )
    }),
  }
}

export type ActiveSessionComposerModel = ReturnType<typeof createActiveSessionComposer>

export function ActiveSessionComposer(props: {
  model: ActiveSessionComposerModel
  session: SessionModel
  accentSubmit: boolean
  onResponseSubmit: () => void
}) {
  const region = createSessionComposerRegionController({
    state: props.model.region.state,
    sessionKey: props.session.identity.sessionKey,
    sessionID: () => props.session.identity.params.id,
    prompt: props.model.region.prompt,
    ready: props.model.region.ready,
    centered: props.model.region.centered,
    followup: props.model.region.followup,
    revert: () => undefined,
    onResponseSubmit: props.onResponseSubmit,
    openParent: props.model.region.openParent,
    setPromptRef: props.model.region.setPromptRef,
    setDockRef: props.model.region.setDockRef,
  })
  const promptInput = usePromptInputV2Controller({
    get controls() {
      return props.model.input.controls()
    },
    ref: props.model.input.setPromptRef,
    get newSessionWorktree() {
      return props.model.newSessionWorktree()
    },
    onNewSessionWorktreeReset: props.model.resetWorktree,
    onSubmit: props.model.submit,
    get edit() {
      return props.model.queue.edit()
    },
    onEditLoaded: props.model.queue.onEditLoaded,
    shouldQueue: props.model.queue.enabled,
    onQueue: props.model.queue.enqueue,
    onAbort: props.model.queue.pause,
  })
  return (
    <Show when={props.session.identity.params.id}>
      <SessionComposerRegion
        controller={region}
        promptInput={
          <PromptInputV2Composer controller={promptInput} borderUnderlay accentSubmit={props.accentSubmit} />
        }
      />
    </Show>
  )
}
