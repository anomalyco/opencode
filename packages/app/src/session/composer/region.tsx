import type { SessionUserActions } from "@opencode-ai/session-ui/message"
import { getFilename } from "@opencode-ai/util/path"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { isScrollKeyTarget, scrollKey, scrollKeyOwner } from "@opencode-ai/ui/scroll-view"
import { makeEventListener } from "@solid-primitives/event-listener"
import { useNavigate } from "@solidjs/router"
import { createEffect, on, onMount } from "solid-js"
import { Composer } from "@/composer/composer"
import { createComposerModel } from "@/composer/model"
import { useComposerState } from "@/composer/persistence"
import { createComposerControls } from "@/composer/selection"
import { setCursorPosition } from "@/composer/editor/dom"
import { promptLength } from "@/composer/history/entry"
import { useCommand } from "@/shell/commands/command"
import { useLanguage } from "@/runtime/i18n/language"
import { useLocal } from "@/providers/models/selection"
import { usePlatform } from "@/runtime/platform/platform"
import { useWorkspaceLocation } from "@/workspaces/location"
import { requireServerKey, sessionHref } from "@/shell/routes/session"
import { useComposerCommands } from "@/composer/commands"
import { useSessionCommands } from "../commands/use-session-commands"
import type { SessionModel } from "../model"
import type { SessionScreenLayout } from "../screen-layout"
import { restorePromptModel, syncPromptModel, syncSessionModel } from "../session-model-helpers"
import type { SessionTimelineInteraction } from "../timeline/interaction"
import { createSessionRevert } from "../revert"
import { SessionComposerRegion } from "./session-composer-region"
import { createSessionComposerRegionController } from "./session-composer-region-controller"
import { createActiveComposerAdapter } from "./adapter"
import { resolveSessionComposerSelection } from "./selection"
import { createSessionRequestModel } from "../requests/model"

export function createActiveSessionRegion(input: {
  session: SessionModel
  screen: SessionScreenLayout
  timeline: SessionTimelineInteraction
}) {
  const command = useCommand()
  const dialog = useDialog()
  const language = useLanguage()
  const local = useLocal()
  const location = useWorkspaceLocation()
  const navigate = useNavigate()
  const platform = usePlatform()
  const prompt = useComposerState()
  const state = createSessionRequestModel()
  const controls = createComposerControls({
    sessionKey: input.session.identity.sessionKey,
  })
  let promptRef: HTMLDivElement | undefined

  createEffect(
    on(
      () => [input.timeline.lastUserMessage(), input.session.data.info()] as const,
      () => {
        const message = input.timeline.lastUserMessage()
        const info = input.session.data.info()
        const selection = resolveSessionComposerSelection(info, message?.metadata)
        if (info && selection.agent && selection.model) {
          syncSessionModel(local, { sessionID: info.id, agent: selection.agent, model: selection.model })
        }
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
  const focus = () => {
    if (!input.session.data.isChild()) promptRef?.focus()
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
  const revert = createSessionRevert({
    session: input.session,
    setActiveMessage: input.timeline.actions.setActiveMessage,
  })
  useComposerCommands()
  useSessionCommands({
    session: input.session,
    background: {
      blocking: () => state.background.blocking().length > 0,
      move: state.background.move,
    },
    navigateMessageByOffset: input.timeline.actions.navigateMessage,
    revert,
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
      timeline: { revert: ({ messageID }) => revert.to(messageID), openAttachment } satisfies SessionUserActions,
    },
    region: {
      centered: input.screen.centered,
      openParent: () => {
        const id = input.session.data.parentID()
        if (id) navigate(sessionHref(requireServerKey(input.session.identity.params.serverKey), id))
      },
      prompt,
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
    submitted: () => input.timeline.actions.resume(),
    workspaceMoveEligible: () => true,
  }
}

export type ActiveSessionRegionModel = ReturnType<typeof createActiveSessionRegion>

export function ActiveSessionComposerRegion(props: {
  model: ActiveSessionRegionModel
  session: SessionModel
  accentSubmit: boolean
  onResponseSubmit: () => void
}) {
  const region = createSessionComposerRegionController({
    state: props.model.region.state,
    sessionKey: props.session.identity.sessionKey,
    sessionID: () => props.session.identity.params.id,
    prompt: props.model.region.prompt,
    centered: props.model.region.centered,
    onResponseSubmit: props.onResponseSubmit,
    openParent: props.model.region.openParent,
    setPromptRef: props.model.region.setPromptRef,
    setDockRef: props.model.region.setDockRef,
  })
  const adapter = createActiveComposerAdapter({
    session: props.session,
    controls: props.model.input.controls,
    submitted: props.model.submitted,
    setEditor: props.model.input.setPromptRef,
  })
  const composer = createComposerModel(adapter)
  return (
    <SessionComposerRegion
      controller={region}
      composer={<Composer model={composer} borderUnderlay accentSubmit={props.accentSubmit} />}
    />
  )
}
