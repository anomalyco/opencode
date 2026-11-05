import { Predicate } from "effect"
import { base64Encode } from "@opencode/util/encode"
import { Session } from "@opencode/schema/session"
import { createMemo, createSignal, onCleanup, startTransition } from "solid-js"
import type { ComposerSession, NewSessionComposerAdapter } from "@/composer/adapter"
import { useComposerState } from "@/composer/persistence"
import { createComposerControls, createComposerModelSelection } from "@/composer/selection"
import { createComposerProjectControls } from "./project/controller"
import { useLanguage } from "@/runtime/i18n/language"
import { useLocal } from "@/providers/models/selection"
import { useData, useServer } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { useTabs } from "@/shell/tabs/tabs"
import { useWorkspaceLocation } from "@/workspaces/location"
import { createWorktree } from "@/workspaces/create"
import { showToast } from "@/shell/notifications/toast"
import type { DraftMcpControls } from "./mcp"
import {
  createNewSessionStartState,
  transitionNewSessionStart,
  viewNewSessionStart,
  type NewSessionStartEffect,
  type NewSessionStartEvent,
  type NewSessionStartTransition,
} from "./machine"

// Lives in the draft's tab memory, so an attempt outlives the draft screen that the pending tab replaces.
export function createNewSessionStartStore() {
  const [state, setState] = createSignal(createNewSessionStartState())
  const runners = new Map<number, (effect: NewSessionStartEffect) => Promise<void>>()

  const run = (result: NewSessionStartTransition) => {
    result.effects.forEach((effect) => void runners.get(effect.attempt)?.(effect))

    // Only one attempt is active at a time, and one that has settled runs no further effects.
    if (result.state.type !== "worktree" && result.state.type !== "mcp" && result.state.type !== "session")
      runners.clear()
  }

  const dispatch = (event: NewSessionStartEvent) => {
    const result = transitionNewSessionStart(state(), event)
    setState(result.state)
    run(result)
  }

  onCleanup(() => dispatch({ type: "dispose" }))

  return {
    view: createMemo(() => viewNewSessionStart(state())),
    dispatch,
    // Opens the attempt's runner, which shows the pending tab, only when the machine accepts the start.
    start(
      event: Extract<NewSessionStartEvent, { type: "start" }>,
      open: (attempt: number) => (effect: NewSessionStartEffect) => Promise<void>,
    ) {
      const result = transitionNewSessionStart(state(), event)

      if (result.state === state() || result.state.type === "disposed") return false
      setState(result.state)
      runners.set(result.state.attempt, open(result.state.attempt))
      run(result)

      return true
    },
  }
}

export type NewSessionStartStore = ReturnType<typeof createNewSessionStartStore>

type Started = Awaited<ReturnType<NewSessionComposerAdapter["start"]>>

export function createNewSessionComposerAdapter(props: {
  draftID: string
  worktree: () => string
  branch: () => string | undefined
  submitted: () => void
  mcp: DraftMcpControls
  start: NewSessionStartStore
}) {
  const prompt = useComposerState()
  const state = prompt.capture()
  const local = useLocal()
  const data = useData()
  const server = useServer()
  const serverSDK = useServerSDK()
  const tabs = useTabs()
  const location = useWorkspaceLocation()
  const language = useLanguage()
  const model = createComposerModelSelection({ agent: () => local.agent.current() })
  const controls = createComposerControls({ model })

  const adapter: NewSessionComposerAdapter = {
    kind: "new-session",
    state,
    ready: prompt.ready,
    controls,
    working: () => false,
    submitted: props.submitted,
    start(selection, submission, message) {
      const currentDirectory = location().directory

      const projectDirectory =
        data.location.info({ directory: currentDirectory })?.project.canonical ?? currentDirectory

      const worktree = props.worktree()
      const directory = worktree === "main" ? projectDirectory : worktree
      const sessionID = Session.ID.create()
      const settled = Promise.withResolvers<Started>()

      const accepted = props.start.start(
        {
          type: "start",
          sessionID,
          workspace:
            worktree === "create"
              ? { type: "new", projectDirectory, branch: props.branch() }
              : { type: "existing", directory },
          mcp: props.mcp.capture(),
          toggling: worktree !== "create" && props.mcp.toggling(directory),
        },
        (attempt) => {
          const pending = tabs.prepareSession(
            props.draftID,
            { server: server.key, sessionId: sessionID },
            { message, selection, view: props.start.view },
          )

          return async (effect) => {
            await pending.ready

            if (effect.type === "worktree.create") {
              props.start.dispatch(
                await createWorktree({
                  api: serverSDK.api,
                  data,
                  directory: effect.projectDirectory,
                  project: data.location.info({ directory: effect.projectDirectory })?.project,
                  branch: effect.branch,
                }).then(
                  (directory) => ({ type: "worktree.created", attempt, directory }) as const,
                  (error) => ({ type: "worktree.failed", attempt, message: errorMessage(language, error) }) as const,
                ),
              )

              return
            }

            if (effect.type === "mcp.prepare") {
              const prepared = await props.mcp.prepare(effect.directory, effect.mcp)
              props.start.dispatch({ type: prepared ? "mcp.prepared" : "mcp.failed", attempt })

              return
            }

            if (effect.type === "session.create") {
              props.start.dispatch(
                await data.session
                  .create({
                    id: effect.sessionID,
                    agent: selection.agent,
                    model: {
                      id: selection.model.modelID,
                      providerID: selection.model.providerID,
                      variant: selection.variant,
                    },
                    location: { directory: effect.directory },
                  })
                  .request.then(
                    () => ({ type: "session.created", attempt }) as const,
                    (error) => ({ type: "session.failed", attempt, message: errorMessage(language, error) }) as const,
                  ),
              )

              return
            }

            if (effect.type === "session.promote") {
              const cleanupReady = startTransition(() => {
                local.session.promote(effect.directory, effect.sessionID, {
                  agent: selection.agent,
                  model: selection.model,
                  variant: selection.variant ?? null,
                  choices: model.remembered(),
                })
                submission.retarget(
                  prompt.capture(
                    { dir: base64Encode(effect.directory), id: effect.sessionID },
                    { server: server.key, scope: serverSDK.scope },
                  ),
                  { preserveDraft: true },
                )
              })

              settled.resolve({
                cleanupReady,
                complete: () => pending.complete(submission.target()),
                session: createdSession(effect.sessionID, effect.directory),
              })

              return
            }

            if (effect.type === "toast") {
              showToast({ title: language.t(effect.title), description: effect.message })

              return
            }

            if (effect.type === "tab.rollback") {
              if (effect.worktree) {
                data.project.invalidate()
                await data.project.sync().catch(() => undefined)
              }

              await pending.rollback(effect.worktree?.directory)

              if (effect.worktree) props.mcp.remember(effect.worktree.directory, effect.worktree.mcp)
            }

            settled.resolve(undefined)
          }
        },
      )

      if (!accepted) return Promise.resolve(undefined)

      return settled.promise
    },
  }

  const createdSession = (id: Session.ID, directory: string): ComposerSession => ({
    id,
    directory,
    handoff: server.ctx.handoff.forSession(id),
    api: serverSDK.api.session,
    data,
    current: () => data.session.get(id),
    admitted: (messageID) => data.session.input.has(id, messageID) || !!data.session.message.get(id, messageID),
  })

  return {
    adapter,
    project: createComposerProjectControls({ draftId: props.draftID, worktree: props.worktree }),
    model,
    ready: prompt.ready,
  }
}

function errorMessage(language: ReturnType<typeof useLanguage>, cause: unknown) {
  if (Predicate.hasProperty(cause, "message") && Predicate.isString(cause.message)) return cause.message

  if (
    Predicate.hasProperty(cause, "data") &&
    Predicate.hasProperty(cause.data, "message") &&
    Predicate.isString(cause.data.message) &&
    cause.data.message
  )
    return cause.data.message

  return language.t("common.requestFailed")
}
