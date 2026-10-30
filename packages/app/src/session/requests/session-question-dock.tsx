import { Show } from "solid-js"
import type { FormInfo } from "@opencode/client/promise"
import { useSettings } from "@/settings/model"
import { SessionQuestionDockClassic } from "./session-question-dock-classic"
import { SessionQuestionDockExperimental } from "./session-question-dock-experimental"

export function SessionQuestionDock(props: { request: FormInfo; onSubmit: () => void }) {
  const settings = useSettings()

  return (
    <Show when={settings.general.newQuestionUI()} fallback={<SessionQuestionDockClassic {...props} />}>
      <SessionQuestionDockExperimental {...props} />
    </Show>
  )
}
