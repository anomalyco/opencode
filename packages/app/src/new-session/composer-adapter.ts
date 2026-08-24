import { base64Encode } from "@opencode-ai/util/encode"
import { getDirectory } from "@opencode-ai/util/path"
import type { SessionMessageUser } from "@opencode-ai/client/promise"
import { startTransition } from "solid-js"
import type { NewSessionComposerAdapter } from "@/composer/adapter"
import { useComposerState } from "@/composer/persistence"
import { createComposerControls, createComposerModelSelection } from "@/composer/selection"
import { createComposerProjectControls } from "./project/controller"
import { useLanguage } from "@/runtime/i18n/language"
import { useLocal } from "@/providers/models/selection"
import { useData, useServer } from "@/runtime/server/current"
import { type ServerSDK, useServerSDK } from "@/runtime/server/client"
import { useTabs } from "@/shell/tabs/tabs"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useSessionKey } from "@/session/session-layout"
import { showToast } from "@/shell/notifications/toast"
import { SessionRouteKey, SessionStateKey } from "@/runtime/server/scope"
import { clearSessionMessageHandoff, setSessionMessageHandoff } from "@/session/handoff"

export function createNewSessionComposerAdapter(props: {
  draftID: string
  worktree: () => string
  submitted: () => void
}) {
  const route = useSessionKey()
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
  const controls = createComposerControls({ sessionKey: route.sessionKey, model })

  const adapter: NewSessionComposerAdapter = {
    kind: "new-session",
    state,
    ready: prompt.ready,
    controls,
    working: () => false,
    submitted: props.submitted,
    async start(selection, submission) {
      const projectDirectory = location().directory
      const worktree = props.worktree()
      const sessionDirectory = await resolveSessionDirectory({
        projectDirectory,
        worktree,
        data,
        serverSDK,
        language,
      })
      if (!sessionDirectory) return

      const created = data.session.create({
        agent: selection.agent,
        model: {
          id: selection.model.modelID,
          providerID: selection.model.providerID,
          variant: selection.variant,
        },
        location: { directory: sessionDirectory },
      })
      const creation = created.request.then(
        () => ({ ok: true as const }),
        (error) => {
          showToast({
            title: language.t("prompt.toast.sessionCreateFailed.title"),
            description: errorMessage(language, error),
          })
          return { ok: false as const, error }
        },
      )
      const afterCreation = async <T,>(run: () => Promise<T>) => {
        const result = await creation
        if (!result.ok) throw result.error
        return run()
      }
      const sessionKey = SessionStateKey.from(
        serverSDK.scope,
        SessionRouteKey.fromRoute(base64Encode(sessionDirectory), created.id),
      )
      const cleanupReady = startTransition(() => {
        tabs.updateDraft(props.draftID, { worktree: undefined })
        local.session.promote(sessionDirectory, created.id, {
          agent: selection.agent,
          model: selection.model,
          variant: selection.variant ?? null,
        })
        tabs.promoteDraft(props.draftID, { server: server.key, sessionId: created.id })
        submission.retarget(
          prompt.capture(
            { dir: base64Encode(sessionDirectory), id: created.id },
            { server: server.key, scope: serverSDK.scope },
          ),
        )
      })

      return {
        cleanupReady,
        session: {
          id: created.id,
          directory: sessionDirectory,
          handoff: createMessageHandoff(sessionKey, created.id, serverSDK.event),
          api: {
            command: (input) => afterCreation(() => serverSDK.api.session.command(input)),
            shell: (input) => afterCreation(() => serverSDK.api.session.shell(input)),
            switchAgent: (input) => afterCreation(() => serverSDK.api.session.switchAgent(input)),
            switchModel: (input) => afterCreation(() => serverSDK.api.session.switchModel(input)),
          },
          data: {
            location: data.location,
            session: {
              setStatus: data.session.setStatus,
              prompt: (input) =>
                data.session.prompt({
                  ...input,
                  gate: Promise.all([input.gate, afterCreation(async () => undefined)]),
                }),
            },
          },
          current: () => data.session.get(created.id),
          admitted: (messageID) =>
            data.session.input.has(created.id, messageID) || !!data.session.message.get(created.id, messageID),
        },
      }
    },
  }

  return {
    adapter,
    project: createComposerProjectControls({ draftId: props.draftID }),
    model,
    ready: prompt.ready,
  }
}

function createMessageHandoff(key: string, sessionID: string, event: ServerSDK["event"]) {
  let unsubscribe: VoidFunction | undefined
  return {
    set(message: SessionMessageUser) {
      unsubscribe?.()
      setSessionMessageHandoff(key, message)
      unsubscribe = event.on("session.inbox.enqueued", (item) => {
        if (item.data.sessionID !== sessionID || item.data.inboxID !== message.id) return
        unsubscribe?.()
        unsubscribe = undefined
        clearSessionMessageHandoff(key, message.id)
      })
    },
    clear(messageID: string) {
      unsubscribe?.()
      unsubscribe = undefined
      clearSessionMessageHandoff(key, messageID)
    },
  }
}

async function resolveSessionDirectory(input: {
  projectDirectory: string
  worktree: string
  data: ReturnType<typeof useData>
  serverSDK: ReturnType<typeof useServerSDK>
  language: ReturnType<typeof useLanguage>
}) {
  if (input.worktree === "main") return input.projectDirectory
  if (input.worktree !== "create") return input.worktree

  return input.serverSDK.api.worktree
    .create({
      projectID: input.data.location.info({ directory: input.projectDirectory })?.project.id ?? "",
      strategy: "git",
      directory: getDirectory(
        input.data.location.info({ directory: input.projectDirectory })?.project.directory ?? input.projectDirectory,
      ),
    })
    .then(async (created) => {
      await input.serverSDK.api.location.get({ location: { directory: created.directory } })
      return created.directory
    })
    .catch((error) => {
      showToast({
        title: input.language.t("prompt.toast.worktreeCreateFailed.title"),
        description: errorMessage(input.language, error),
      })
    })
}

function errorMessage(language: ReturnType<typeof useLanguage>, error: unknown) {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message
  }
  if (error && typeof error === "object" && "data" in error) {
    const data = (error as { data?: { message?: string } }).data
    if (data?.message) return data.message
  }
  return language.t("common.requestFailed")
}
