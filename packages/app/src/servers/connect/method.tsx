import { Button } from "@opencode/ui/button"
import { useLanguage } from "@/runtime/i18n/language"

export type ConnectMethod = "link" | "password"

// Deliberately quiet, like the Console's API key switch: a pairing link is the way in, the password is the fallback.
export function ConnectMethodSwitch(props: {
  method: ConnectMethod
  /** The credentials form signs in to the server's own accounts, so the switch offers an account, not a password. */
  localAuth?: boolean
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
        {language.t(
          props.method === "link"
            ? props.localAuth
              ? "server.connect.local.use"
              : "server.connect.password.use"
            : "server.connect.link.use",
        )}
      </Button>
    </div>
  )
}

// The server's registration stays open, so the account form offers creating one next to signing in.
export function LocalAccountSwitch(props: { create: boolean; disabled?: boolean; onChange: (create: boolean) => void }) {
  const language = useLanguage()

  return (
    <div
      data-component="server-connect-account"
      class="flex min-h-7 flex-wrap items-center justify-center gap-1 text-[13px]"
    >
      <span class="text-v2-text-text-faint">
        {language.t(props.create ? "server.connect.local.signin.prompt" : "server.connect.local.create.prompt")}
      </span>
      <Button variant="ghost-muted" disabled={props.disabled} onClick={() => props.onChange(!props.create)}>
        {language.t(props.create ? "server.connect.local.signin.use" : "server.connect.local.create.use")}
      </Button>
    </div>
  )
}
