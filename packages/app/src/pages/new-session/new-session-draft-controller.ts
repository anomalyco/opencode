import { useSearchParams } from "@solidjs/router"
import { createEffect, createSignal, onCleanup, untrack } from "solid-js"
import { usePromptInputV2Controller } from "@/components/prompt-input-v2"
import { useComments } from "@/context/comments"
import { useLocal } from "@/context/local"
import { usePrompt } from "@/context/prompt"
import { useServerSync } from "@/context/server-sync"
import { createPromptInputController, createPromptProjectControls } from "@/pages/session/composer"
import { createPromptModelSelection } from "@/pages/session/composer/prompt-model-selection"
import { useSessionKey } from "@/pages/session/session-layout"
import { useComposerCommands } from "@/pages/session/use-composer-commands"

export function createNewSessionDraftController(workspace: { worktree: () => string; resetWorktree: () => void }) {
  const prompt = usePrompt()
  const serverSync = useServerSync()
  const comments = useComments()
  const local = useLocal()
  const route = useSessionKey()
  const [searchParams, setSearchParams] = useSearchParams<{ draftId?: string; prompt?: string }>()
  const model = createPromptModelSelection({ agent: () => local.agent.current() })

  useComposerCommands({ model })

  const controls = createPromptInputController({
    sessionKey: route.sessionKey,
    sessionID: () => route.params.id,
    queryOptions: serverSync().queryOptions,
    model,
  })
  const projectControls = createPromptProjectControls()
  const [leaving, setLeaving] = createSignal(false)
  let leaveTimer: ReturnType<typeof setTimeout> | undefined

  // Let the wordmark play its exit animation before the submit flow navigates to the session.
  const leave = () => {
    setLeaving(true)
    if (leaveTimer !== undefined) clearTimeout(leaveTimer)
    leaveTimer = setTimeout(() => setLeaving(false), 2500)
    return new Promise<void>((resolve) => setTimeout(resolve, 200))
  }

  onCleanup(() => {
    if (leaveTimer !== undefined) clearTimeout(leaveTimer)
  })

  const input = usePromptInputV2Controller({
    get controls() {
      return controls()
    },
    get newSessionWorktree() {
      return workspace.worktree()
    },
    onNewSessionWorktreeReset: workspace.resetWorktree,
    onSubmit: () => {
      comments.clear()
      return leave()
    },
  })

  createEffect(() => {
    if (!prompt.ready()) return
    untrack(() => {
      const text = searchParams.prompt
      if (!text) return
      prompt.set([{ type: "text", content: text, start: 0, end: text.length }], text.length)
      setSearchParams({ ...searchParams, prompt: undefined })
    })
  })

  return {
    leaving,
    input,
    prompt: {
      ready: prompt.ready,
      readyPromise: () => prompt.ready.promise,
    },
    project: {
      controls: projectControls,
    },
  }
}

export type NewSessionDraftController = ReturnType<typeof createNewSessionDraftController>
