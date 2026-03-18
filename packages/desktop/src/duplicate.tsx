import { useCommand, useLanguage, usePrompt, useSDK } from "@opencode-ai/app"
import { base64Encode } from "@opencode-ai/util/encode"
import { showToast } from "@opencode-ai/ui/toast"
import { useNavigate, useParams } from "@solidjs/router"

export function Duplicate() {
  const command = useCommand()
  const params = useParams()
  const navigate = useNavigate()
  const language = useLanguage()
  const prompt = usePrompt()
  const sdk = useSDK()

  command.register("desktop.session.duplicate", () => [
    {
      id: "desktop.session.duplicate",
      title: language.t("command.session.duplicate"),
      description: language.t("command.session.duplicate.description"),
      slash: "duplicate",
      disabled: !params.id,
      onSelect: () => {
        const sessionID = params.id
        if (!sessionID) return

        const value = prompt.current()
        const cursor = prompt.cursor()
        const dir = base64Encode(sdk.directory)
        sdk.client.session
          .fork({ sessionID })
          .then((result: { data?: { id: string } | null }) => {
            if (!result.data) {
              showToast({ title: language.t("common.requestFailed") })
              return
            }

            navigate(`/${dir}/session/${result.data.id}`)
            requestAnimationFrame(() => {
              prompt.set(value, cursor)
            })
          })
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err)
            showToast({
              title: language.t("common.requestFailed"),
              description: message,
            })
          })
      },
    },
  ])

  return null
}
