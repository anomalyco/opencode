import { Button } from "@opencode/ui/button"
import { useLanguage } from "@/runtime/i18n/language"

export type ConnectMethod = "link" | "password"

// Deliberately quiet, like the Console's API key switch: a pairing link is the way in, the password is the fallback.
export function ConnectMethodSwitch(props: {
  method: ConnectMethod
  disabled?: boolean
  align?: "start" | "center"
  class?: string
  onChange: (method: ConnectMethod) => void
}) {
  const language = useLanguage()
  const next = () => (props.method === "link" ? "password" : "link")

  return (
    <div
      data-component="server-connect-method"
      class={`flex min-h-7 flex-wrap items-center gap-1 text-[13px] ${props.class ?? ""}`}
      classList={{ "justify-center": props.align !== "start", "justify-start": props.align === "start" }}
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
