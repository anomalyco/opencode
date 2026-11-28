import { Icon } from "@opencode/ui/icon"
import { Tooltip } from "@opencode/ui/tooltip"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection, serverName } from "@/runtime/server/registry"

export function authServerName(server: ServerConnection.Any) {
  if (ServerConnection.builtin(server)) return undefined

  if (server.type === "http" && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(server.http.url).hostname))
    return undefined

  return serverName(server)
}

/** A Console sign-in through another server is stored on that server, so the dialog names it. */
export function RemoteServerLabel(props: { server: string; class?: string }) {
  const language = useLanguage()

  return (
    <Tooltip
      value={language.t("provider.connect.remote.description")}
      placement="bottom"
      contentClass="!max-w-64 !whitespace-normal"
      triggerTabIndex={0}
      class={`flex min-w-0 shrink-0 !cursor-default items-center gap-1.5 rounded-sm text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-muted ${props.class ?? ""}`}
    >
      <Icon name="server" class="shrink-0 text-v2-icon-icon-muted" />
      <span class="max-w-40 truncate">{language.t("provider.connect.remote.label", { server: props.server })}</span>
    </Tooltip>
  )
}
