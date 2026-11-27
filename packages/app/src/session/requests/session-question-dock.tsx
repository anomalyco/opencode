import type { FormInfo } from "@opencode/client/promise"
import { useSettings } from "@/settings/model"
import { SessionQuestionDockClassic } from "./session-question-dock-classic"

export function SessionQuestionDock(props: { request: FormInfo; onSubmit: () => void }) {
  const settings = useSettings()

  return <SessionQuestionDockClassic {...props} composer={settings.general.questionComposer()} />
}
