import { Button } from "@opencode/ui/button"
import { useLanguage } from "@/runtime/i18n/language"

export type ConnectMethod = "link" | "password"

// Deliberately quiet, like the Console's API key switch: a pairing link is the way in, the password is the fallback.
export function ConnectMethodSwitch(props: {
  method: ConnectMethod
  disabled?: boolean
  onChange: (method: ConnectMethod) => void
}) {
  const language = useLanguage()
  const next = () => (props.method === "link" ? "password" : "link")

  return (
    <div
      data-component="server-connect-method"
      class="flex min-h-7 flex-wrap items-center justify-center gap-1 text-[13px]"
    >
      <span class="text-v2-text-text-faint">
        {language.t(props.method === "link" ? "server.connect.password.prompt" : "server.connect.link.prompt")}
      </span>
      <Button variant="ghost-muted" disabled={props.disabled} onClick={() => props.onChange(next())}>
        {language.t(props.method === "link" ? "server.connect.password.use" : "server.connect.link.use")}
      </Button>
    </div>
  )
}
