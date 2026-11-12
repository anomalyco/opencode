import { Button } from "@opencode/ui/button"
import { useLanguage } from "@/runtime/i18n/language"

export type ConnectMethod = "link" | "password" | "relay"

// Three side-by-side methods. The relay path is a first-class option now so self-hosted
// multi-device setups can discover servers without manually assembling proxy URLs.
export function ConnectMethodSwitch(props: {
  method: ConnectMethod
  disabled?: boolean
  onChange: (method: ConnectMethod) => void
}) {
  const language = useLanguage()

  return (
    <div
      data-component="server-connect-method"
      class="flex w-full flex-col gap-2"
    >
      <div class="grid w-full grid-cols-3 gap-2">
        <Button
          variant={props.method === "link" ? "contrast" : "outline"}
          disabled={props.disabled}
          onClick={() => props.onChange("link")}
        >
          {language.t("server.connect.method.link")}
        </Button>
        <Button
          variant={props.method === "password" ? "contrast" : "outline"}
          disabled={props.disabled}
          onClick={() => props.onChange("password")}
        >
          {language.t("server.connect.method.password")}
        </Button>
        <Button
          variant={props.method === "relay" ? "contrast" : "outline"}
          disabled={props.disabled}
          onClick={() => props.onChange("relay")}
        >
          {language.t("server.connect.method.relay")}
        </Button>
      </div>
    </div>
  )
}
