import { useCommand, useLanguage, usePrompt, useSDK } from "@opencode-ai/app"
import { showToast } from "@opencode-ai/ui/toast"
import { useNavigate, useParams } from "@solidjs/router"
import { duplicateCommand } from "./duplicate-command"

export function Duplicate() {
  const command = useCommand()
  const params = useParams()
  const navigate = useNavigate()
  const language = useLanguage()
  const prompt = usePrompt()
  const sdk = useSDK()

  command.register("desktop.session.duplicate", () => [
    duplicateCommand({
      id: params.id,
      t: language.t,
      prompt,
      sdk,
      navigate,
      toast: showToast,
      frame: requestAnimationFrame,
    }),
  ])

  return null
}
