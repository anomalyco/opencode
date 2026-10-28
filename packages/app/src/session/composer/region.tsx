import type { SessionUserActions } from "@opencode/session-ui/message"
import { getFilename, sameDirectory } from "@opencode/util/path"
import { useDialog } from "@opencode/ui/context/dialog"
import { isScrollKeyTarget, scrollKey, scrollKeyOwner } from "@opencode/ui/scroll-view"
import { makeEventListener } from "@solid-primitives/event-listener"
import { useNavigate } from "@solidjs/router"
import { createEffect, createMemo, on, onCleanup, onMount, Show, type Accessor } from "solid-js"
import { Composer } from "@/composer/composer"
import { VoiceComposer } from "@/voice/composer"
import { useComposerState } from "@/composer/persistence"
import { createComposerControls } from "@/composer/selection"
import { setCursorPosition } from "@/composer/editor/dom"
import { promptLength } from "@/composer/prompt-parts"
import { useCommand } from "@/shell/commands/command"
import { useLanguage } from "@/runtime/i18n/language"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { showToast } from "@/shell/notifications/toast"
import { errorMessage } from "@/shell/layout/helpers"
import { useLocal } from "@/providers/models/selection"
import { usePlatform } from "@/runtime/platform/platform"
import { uuid } from "@/runtime/persistence/uuid"
import { contextItemKey } from "@/composer/schema"
import type { QuoteSource } from "@/composer/quote-source"
import { useWorkspaceLocation } from "@/workspaces/location"
import { requireServerKey, sessionHref } from "@/shell/routes/session"
import { useComposerCommands } from "@/composer/commands"
import { useSessionCommands } from "../commands/use-session-commands"
import type { SessionModel } from "../model"
import type { SessionScreenLayout } from "../screen-layout"
import { syncPromptModel } from "../session-model-helpers"
import type { SessionTimelineInteraction } from "../timeline/interaction"
import { createSessionRevert } from "../revert"
import { useSessionFork } from "../fork"
import { SessionComposerRegion } from "./session-composer-region"
import { createSessionComposerController, type SessionComposerController } from "./controller"
import { SessionQueuePanel } from "./queue-panel"
import { SessionActivityChips, type SessionActivityItem } from "./activity-chips"
import { SessionComposerLane, useComposerLaneAlignment } from "./composer-lane"
import { SessionTodoPill } from "./todo-pill"
import { sessionTodos, todoFinished } from "./todos"
import { useOpenSessionRoute } from "../session-identity-header"
import { resolveSessionComposerSelection } from "./selection"
import { composerModelLabelKey, composerModelLabels, composerProviderName } from "@/composer/model-label"
import { useProviders } from "@/providers/catalog/providers"
import { SubagentBar } from "./subagent-bar"
import { createSessionRequestModel } from "../requests/model"
import type { Region } from "@/runtime/plugin/panels"
import { SessionLocationMissing } from "./location-missing"
import { SessionPluginPills } from "./plugin-pills"
import type { MountedSession, SessionScreen } from "@opencode/plugin/gui"

export function createActiveSessionRegion(input: {
  session: SessionModel
  screen: SessionScreenLayout
  timeline: SessionTimelineInteraction
  region: Region
  visible: Accessor<boolean>
}) {
  const command = useCommand()
  const data = useData()
  const server = useServerSDK()
  const dialog = useDialog()
  const language = useLanguage()
  const local = useLocal()
  const location = useWorkspaceLocation()
  const navigate = useNavigate()
  const platform = usePlatform()
  const prompt = useComposerState()
  const state = createSessionRequestModel()
  const controls = createComposerControls()
  let promptRef: HTMLDivElement | undefined

  createEffect(
    on(
      () => [input.timeline.lastUserMessage(), input.session.data.info()] as const,
      () => {
        const message = input.timeline.lastUserMessage()
        const info = input.session.data.info()
        const selection = resolveSessionComposerSelection(info, message?.metadata)

        if (info && selection.agent && selection.model) {
          local.session.restore({ sessionID: info.id, agent: selection.agent, model: selection.model })
        }
      },
    ),
  )
  createEffect(() => {
    const id = input.session.identity.params.id

    if (!id || !prompt.ready() || !local.session.ready()) return
    // Prompt model is a submission mirror. Local drafts and durable session state own selection.
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

  const openAttachment: NonNullable<SessionUserActions["openAttachment"]> = (file) => {
    const source = file.source
    const fileData = "data" in file ? file.data : undefined
    const fileUri = "uri" in file ? file.uri : undefined

    const inlineUrl =
      source?.type === "uri" ? source.uri : fileData !== undefined ? `data:${file.mime};base64,${fileData}` : undefined

    const download = () => {
      void (
        inlineUrl
          ? Promise.resolve(inlineUrl)
          : fileUri
            ? server.media.load(fileUri, file.mime)
            : Promise.resolve(undefined)
      ).then((url) => {
        if (!url) return
        const anchor = document.createElement("a")
        anchor.href = url
        anchor.download = getFilename(file.name) || "attachment"
        anchor.click()
      })
    }

    const path = file.name ?? ""
    const absolute = path.startsWith("/") || path.startsWith("\\\\") || /^[a-zA-Z]:[\\/]/.test(path)

    if (!platform.revealPath || !absolute) return download()
    void platform.revealPath(path).then((revealed) => {
      if (!revealed) download()
    }, download)
  }

  const focus = () => {
    if (!input.session.data.isChild()) promptRef?.focus()
  }

  const openParent = () => {
    const id = input.session.data.parentID()

    if (id) navigate(sessionHref(requireServerKey(input.session.identity.params.serverKey), id))
  }

  const editable = (target: EventTarget | null | undefined) => {
    if (!(target instanceof HTMLElement)) return false

    return /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName) || target.isContentEditable
  }

  const activeElement = () => {
    let current: Element | null = document.activeElement

    while (current instanceof HTMLElement && current.shadowRoot?.activeElement) {
      current = current.shadowRoot.activeElement
    }

    return current instanceof HTMLElement ? current : undefined
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return
    const path = event.composedPath()
    const target = path.find((item): item is HTMLElement => item instanceof HTMLElement)
    const active = activeElement()

    if (
      path.some((item) => item instanceof HTMLElement && item.closest("[data-prevent-autofocus]") !== null) ||
      editable(target) ||
      (active && (active.closest("[data-prevent-autofocus]") || editable(active))) ||
      dialog.active
    ) {
      return
    }

    if (event.key === "Escape" && input.session.data.isChild()) {
      event.preventDefault()
      openParent()

      return
    }

    if (active === promptRef) {
      if (event.key === "Escape") promptRef?.blur()

      return
    }

    const key = scrollKey(event)

    if (key) {
      const scroller = input.timeline.scroller()

      if (!scroller || !isScrollKeyTarget(target ?? null, key)) return

      if (scrollKeyOwner(scroller, target ?? null, key) !== scroller) return
      input.timeline.view.markUserScroll(scroller)

      return
    }

    // Focusing on the ⌘V keydown makes the browser's paste land in the composer through its normal paste path.
    const paste = (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "v"

    if (event.key.length !== 1 || event.key === "Unidentified" || ((event.ctrlKey || event.metaKey) && !paste)) return

    if (state.blocked() || input.session.data.isChild() || !promptRef) return
    promptRef.focus()
    setCursorPosition(promptRef, prompt.cursor() ?? promptLength(prompt.current()))
  }

  onMount(() => makeEventListener(document, "keydown", handleKeyDown))

  const revert = createSessionRevert({
    session: input.session,
    setActiveMessage: input.timeline.actions.setActiveMessage,
  })

  const revertMessage: NonNullable<SessionUserActions["revert"]> = ({ messageID }) => revert.to(messageID)
  const fork = useSessionFork()
  const forkMessage: NonNullable<SessionUserActions["fork"]> = (target) => fork(target).then(() => undefined)

  const recalled = new Set<string>()

  // The free allowance stops a prompt after it was sent. Hand its text back so switching models and resending is one
  // step, unless the user has already started typing something else.
  onCleanup(
    location().event.on("session.step.failed", (event) => {
      const sessionID = input.session.identity.params.id

      if (!sessionID || event.data.sessionID !== sessionID || event.data.error.type !== "provider.free-limit") return

      if (recalled.has(event.data.assistantMessageID)) return
      recalled.add(event.data.assistantMessageID)

      if (
        !prompt.ready() ||
        !prompt.current().every((part) => part.type === "text" && part.content.length === 0) ||
        prompt.context.items().length > 0
      )
        return

      const messages = input.session.history.messages()
      const end = messages.findIndex((item) => item.id === event.data.assistantMessageID)

      for (let i = end - 1; i >= 0; i--) {
        const item = messages[i]

        if (!item || item.type === "shell" || item.type === "idle") return

        if (item.type === "user" && !data.session.input.has(sessionID, item.id)) {
          revert.recall(item)

          return
        }
      }
    }),
  )

  const notifyFailed = () => {
    showToast({ title: language.t("common.requestFailed") })
  }

  const pendingSteer: NonNullable<SessionUserActions["pending"]> = {
    status: (messageID) => {
      const sessionID = input.session.identity.params.id

      return sessionID ? data.session.pending.status(sessionID, messageID) : undefined
    },
    queue: ({ sessionID, messageID }) =>
      server.api.session.inbox
        .update({ sessionID, inboxID: messageID, delivery: "queue" })
        .then(() => undefined, notifyFailed),
    remove: ({ sessionID, messageID }) =>
      server.api.session.inbox.cancel({ sessionID, inboxID: messageID }).then(() => undefined, notifyFailed),
  }

  useComposerCommands()
  useSessionCommands({
    session: input.session,
    region: input.region,
    background: {
      blocking: () => state.background.blocking().length > 0,
      move: state.background.move,
    },
    navigateMessageByOffset: input.timeline.actions.navigateMessage,
    revert,
    focusInput: focus,
    model: () => {
      const selection = controls().model.selection
      const model = selection.current()

      return model ? { id: model.id, providerID: model.provider.id, variant: selection.variant.current() } : undefined
    },
  })
  command.register("palette", () => [
    {
      id: "command.palette",
      title: language.t("command.palette"),
      hidden: true,
      onSelect: () => command.trigger("file.open", "palette"),
    },
  ])

  const dock = {
    state,
    parentID: input.session.data.parentID,
    centered: input.screen.centered,
    onResponseSubmit: input.timeline.actions.resume,
    openParent,
    setPromptRef: (element: HTMLDivElement) => {
      promptRef = element
    },
    setDockRef: input.timeline.view.setDockRef,
  }

  const active = createMemo(
    on(
      () => (input.visible() ? input.session.identity.sessionID() : undefined),
      (sessionID) =>
        sessionID
          ? createSessionComposerController({
              sessionID,
              sessionKey: input.session.identity.sessionKey,
              controls,
              dock,
            })
          : undefined,
    ),
  )

  const focusPrompt = () => {
    if (!promptRef) return
    promptRef.focus()
    setCursorPosition(promptRef, prompt.cursor() ?? promptLength(prompt.current()))
  }

  return {
    active,
    focused: () => !!promptRef?.contains(document.activeElement),
    drop: {
      active: () => active()?.drop.active() ?? false,
      input: () => active()?.drop.input(),
    },
    quote: {
      source: () => prompt.capture().quoteSource,
      // A child session has no composer to quote into, and a shell command takes no quotes.
      available: () => !input.session.data.isChild() && prompt.capture().mode.current() !== "shell",
      add: (text: string, comment: boolean, source: QuoteSource) => {
        const item = { type: "quote" as const, text, commentID: uuid() }
        prompt.context.add(item)

        if (source.length) prompt.capture().quoteSource.add(contextItemKey(item), source)

        if (comment) {
          prompt.capture().quoteSource.pend(contextItemKey(item))

          return prompt.capture().quoteComment.set(contextItemKey(item))
        }

        focusPrompt()
      },
      focus: focusPrompt,
    },
    actions: {
      timeline: {
        get revert() {
          if (input.session.data.isChild()) return

          return revertMessage
        },
        get fork() {
          if (input.session.data.isChild()) return

          return forkMessage
        },
        get pending() {
          if (input.session.data.isChild()) return

          return pendingSteer
        },
        get chooseModel() {
          if (input.session.data.isChild()) return

          return () => command.trigger("model.choose")
        },
        openAttachment,
      } satisfies SessionUserActions,
    },
    requests: state,
  }
}

export type ActiveSessionRegionModel = ReturnType<typeof createActiveSessionRegion>

export function ActiveSessionComposerRegion(props: {
  session: SessionModel
  /** The routed session as plugins see it, for their composer pills. */
  view: Accessor<MountedSession>
  screen: SessionScreen
  model: SessionComposerController
  suggestionBoundary: () => HTMLElement | undefined
  onReveal: (target: string) => void
}) {
  const location = useWorkspaceLocation()
  const data = useData()
  const server = useServerSDK()
  const language = useLanguage()
  const openRoute = useOpenSessionRoute()

  // Only the server's LocationNotFoundError for the session's own Location replaces the composer.
  const missing = createMemo(() => {
    const ref = location().missing
    const info = props.session.data.info()

    if (!ref || !info || !sameDirectory(info.location.directory, ref.directory)) return

    return { directory: info.location.directory, sessionID: info.id, projectID: info.projectID }
  })

  // Subagents count while their session runs, or while their blocking call waits for its child session.
  const subagents = createMemo<SessionActivityItem[]>(() =>
    props.model.region.state.background.subagents().map((task) => ({
      ...task,
      agent: task.agent ?? (task.sessionID ? data.session.get(task.sessionID)?.agent : undefined),
      key: task.id,
      target: task.partID ?? task.id,
    })),
  )

  const shells = createMemo<SessionActivityItem[]>(() =>
    props.model.region.state.background
      .tasks()
      .flatMap((task) => (task.type === "shell" ? [{ ...task, key: task.id, target: task.id }] : [])),
  )

  const alignment = useComposerLaneAlignment()
  const todos = createMemo(() => sessionTodos(props.session.history.messages(), props.session.data.revertMessageID()))
  // Like the old dock: the plan shows while the turn runs and still has work left, so stale todos never linger.

  const todosVisible = () =>
    todoEnabled() && props.session.data.working() && todos().length > 0 && !todos().every(todoFinished)
  // Matches the server: the highest-priority document that sets `experimental` decides. Migrated V1 sessions keep their
  // old `todowrite` calls, so without this check their last plan would come back.

  const todoEnabled = () =>
    data.location.config
      .list({ directory: location().directory })
      ?.flatMap((entry) => (entry.type === "document" && entry.info.experimental ? [entry.info.experimental] : []))
      .at(-1)?.todo === true

  const open = (item: SessionActivityItem) => {
    const current = props.session.identity.params.id

    if (!current) return

    if (item.sessionID) return openRoute(current, item.sessionID)

    // Shells and starting subagent calls live in this timeline.
    props.onReveal(item.target)
  }

  const stop = (item: SessionActivityItem) => {
    const request = item.sessionID
      ? server.api.session.interrupt({ sessionID: item.sessionID })
      : server.api.shell.remove({
          id: item.target,
          location: { directory: data.shell.get(item.target)?.location.directory },
        })

    void request.catch((error) =>
      showToast({
        title: language.t("common.requestFailed"),
        description: errorMessage(error, language.t("common.requestFailed")),
      }),
    )
  }

  const providers = useProviders(() => props.session.data.info()?.location.directory)

  const modelLabels = createMemo(() =>
    composerModelLabels(
      providers.all(),
      providers.connected().map((provider) => provider.id),
    ),
  )

  const subagentModel = () => {
    const ref =
      props.session.data.info()?.model ??
      props.session.history.messages().findLast((message) => message.type === "assistant")?.model

    if (!ref) return
    const label = modelLabels().get(composerModelLabelKey(ref.providerID, ref.id))

    return {
      provider: label
        ? label.provider
        : composerProviderName(
            ref.providerID,
            providers.all(),
            providers.connected().map((provider) => provider.id),
          ),
      name: label?.model ?? ref.id,
      variant: ref.variant,
    }
  }

  const subagentStatus = () => {
    if (props.session.data.working()) return "running"

    return props.session.data.info()?.outcome
  }

  return (
    <SessionComposerRegion
      controller={props.model.region}
      subagent={
        <Show when={props.session.data.info()}>
          {(info) => (
            <SubagentBar
              agent={info().agent}
              model={subagentModel()}
              status={subagentStatus()}
              started={info().time.created}
              ended={subagentStatus() === "running" ? undefined : (info().time.idle ?? info().time.updated)}
              onBack={props.model.region.openParent}
            />
          )}
        </Show>
      }
      above={
        <Show when={!missing() && !props.session.data.isChild()}>
          <SessionComposerLane>
            <SessionActivityChips subagents={subagents()} shells={shells()} onOpen={open} onStop={stop} />
            <Show when={todosVisible()}>
              <SessionTodoPill todos={todos()} />
            </Show>
            <SessionPluginPills session={props.view()} screen={props.screen} alignment={alignment} />
          </SessionComposerLane>
          <SessionQueuePanel queue={props.model.queue} hidden={props.model.region.state.blocked()} />
        </Show>
      }
      composer={
        <Show
          when={missing()}
          keyed
          fallback={
            // The container for the composer's `cqw` caps: only the composer re-evaluates as a panel beside it
            // animates the chat's width.
            <div class="@container">
              <VoiceComposer session={props.session.data.info()}>
                <Composer
                  model={props.model.composer}
                  borderUnderlay
                  readOnly={props.model.queue.undoing()}
                  suggestionBoundary={props.suggestionBoundary}
                />
              </VoiceComposer>
            </div>
          }
        >
          {(current) => (
            <SessionLocationMissing
              sessionID={current.sessionID}
              projectID={current.projectID}
              directory={current.directory}
            />
          )}
        </Show>
      }
    />
  )
}
