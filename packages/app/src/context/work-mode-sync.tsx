import { useParams } from "@solidjs/router"
import { createEffect, createMemo, type ParentProps } from "solid-js"
import { useLocal } from "@/context/local"
import { useSettings } from "@/context/settings"
import { WorkModeProvider } from "@opencode-ai/session-ui/context"

// Keeps the active agent in sync with the Work Mode setting.
//
// When Work Mode is ON, we default the active agent to `work` if the user is on
// a draft (no active session id in the route). Once a real session is running,
// the agent is owned by that session's metadata and we never override it. When
// Work Mode is OFF, we do nothing — the user can still pick `work` manually via
// the agent pill or by cycling with Tab.
//
// We also mount the WorkModeProvider here so that session-ui components
// (message-part.tsx) can read the work mode flag and swap tool labels without
// importing from the app package.
export function WorkModeSync(props: ParentProps) {
  const settings = useSettings()
  const local = useLocal()
  const params = useParams<{ id?: string }>()

  createEffect(() => {
    const workMode = settings.general.workMode()
    if (!workMode) return
    // Only nudge the draft state; once a real session ID is in the route the user
    // owns their selection.
    if (params.id) return

    const current = local.agent.current()?.name
    if (current === "work") return
    const candidates = local.agent.list().map((a) => a.name)
    if (!candidates.includes("work")) return
    local.agent.set("work")
  })

  const workMode = createMemo(() => settings.general.workMode())
  return <WorkModeProvider value={workMode}>{props.children}</WorkModeProvider>
}