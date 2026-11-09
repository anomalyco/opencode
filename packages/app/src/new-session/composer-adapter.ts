import { Predicate } from "effect"
import { base64Encode } from "@opencode/util/encode"
import { Session } from "@opencode/schema/session"
import { createMemo, createSignal, onCleanup, startTransition, untrack } from "solid-js"
import type { ComposerSession, NewSessionComposerAdapter } from "@/composer/adapter"
import { useComposerState } from "@/composer/persistence"
import { createComposerControls, createComposerModelSelection } from "@/composer/selection"
import { createComposerProjectControls } from "./project/controller"
import { useLanguage } from "@/runtime/i18n/language"
import { useLocal } from "@/providers/models/selection"
import { useData, useServer } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { useTabs } from "@/shell/tabs/tabs"
import { createWorktree } from "@/workspaces/create"
import { showToast } from "@/shell/notifications/toast"
import type { DraftMcpControls } from "./mcp"
import {
  createNewSessionStartState,
  isNewSessionStartActive,
  transitionNewSessionStart,
  viewNewSessionStart,
  type NewSessionStartEffect,
  type NewSessionStartEvent,
  type NewSessionStartTransition,
} from "./machine"

// The phase each request runs in, which its timer ends.
const PHASES = { "worktree.create": "worktree", "mcp.prepare": "mcp", "session.create": "session" } as const

// Lives in the draft's tab memory, so an attempt outlives the draft screen that the pending tab replaces.
export function createNewSessionStartStore() {
  const [state, setState] = createSignal(createNewSessionStartState())
  // Only one attempt is active at a time, and one that has settled runs no further effects.
  let runner: { attempt: number; run: (effect: NewSessionStartEffect) => Promise<void> } | undefined

  const commit = (result: NewSessionStartTransition) => {
    setState(result.state)
    const current = runner

    if (!isNewSessionStartActive(result.state)) runner = undefined
    result.effects.forEach((effect) => {
      if (current?.attempt !== effect.attempt) return
      void Promise.try(() => current.run(effect)).catch((cause: unknown) => console.error("[new-session]", cause))
    })
  }

  const dispatch = (event: NewSessionStartEvent) => {
    const result = transitionNewSessionStart(untrack(state), event)

    if (result.state !== untrack(state)) commit(result)
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
      const result = transitionNewSessionStart(untrack(state), event)

      if (!isNewSessionStartActive(result.state)) return false
      runner = { attempt: result.state.attempt, run: open(result.state.attempt) }
      commit(result)

      return true
    },
  }
}

export type NewSessionStartStore = ReturnType<typeof createNewSessionStartStore>

type Started = Awaited<ReturnType<NewSessionComposerAdapter["start"]>>

export function createNewSessionComposerAdapter(props: {
  draftID: string
  worktree: () => string
  root: () => string
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
      const projectDirectory = props.root()
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

          // Aborted when the attempt ends: MCP preparation stops between steps and a late Session create is undone.
          const ended = new AbortController()
          let timer: ReturnType<typeof setTimeout> | undefined

          const end = () => {
            clearTimeout(timer)
            ended.abort()
          }

          return async (effect) => {
            // Settles before awaiting the tab, so a disposed attempt starts no request.
            if (effect.type === "attempt.abort") {
              end()
              settled.resolve(undefined)

              return
            }

            if (effect.type === "tab.rollback" || effect.type === "session.promote") end()

            if (
              effect.type === "worktree.create" ||
              effect.type === "mcp.prepare" ||
              effect.type === "session.create"
            ) {
              const phase = PHASES[effect.type]

              clearTimeout(timer)
              timer = setTimeout(() => props.start.dispatch({ type: "timed-out", attempt, phase }), effect.timeoutMs)
            }

            await pending.ready

            // The worktree request is not aborted: cutting it off can stop the project's setup script midway. A
            // worktree it creates after the attempt ended stays, and shows up in the worktree list.
            if (effect.type === "worktree.create") {
              if (ended.signal.aborted) return
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
              if (ended.signal.aborted) return
              props.start.dispatch(
                await props.mcp.prepare(effect.directory, effect.mcp, ended.signal).then(
                  (prepared) => ({ type: prepared ? "mcp.prepared" : "mcp.failed", attempt }) as const,
                  (error) => ({ type: "mcp.failed", attempt, message: errorMessage(language, error) }) as const,
                ),
              )

              return
            }

            if (effect.type === "session.create") {
              if (ended.signal.aborted) return
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
                    () => {
                      // The attempt ended first, so the prompt was never sent and the Session is still empty.
                      if (ended.signal.aborted) void data.session.remove(effect.sessionID).catch(() => undefined)

                      return { type: "session.created", attempt } as const
                    },
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
                  variant: selection.variant,
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

            if (effect.type === "toast" || effect.type === "toast.timed-out") {
              showToast({
                variant: effect.title === "session.summary.mcp.prepareFailed" ? "error" : undefined,
                title: language.t(effect.title),
                description: effect.type === "toast" ? effect.message : language.t("session.new.timedOut"),
              })

              return
            }

            if (effect.worktree) {
              data.project.invalidate()
              await data.project.sync().catch(() => undefined)
            }

            await pending.rollback(effect.worktree?.directory)

            if (effect.worktree) props.mcp.remember(effect.worktree.directory, effect.worktree.mcp)
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
