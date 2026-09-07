import { For, Show } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import type { ServerCollectionController } from "@/servers/registry/controller"
import { ServerHealthIndicator } from "@/servers/registry/row"
import { ServerConnection } from "@/runtime/server/registry"
import { useSshServers } from "./context"
import { SshMenu } from "./menu"
import { Badge } from "@opencode-ai/ui/badge"
import { sshName } from "./name"
import { isSshConnecting } from "./status"

export function SshServerSettings(props: { filter: string; domain: ServerCollectionController }) {
  const ssh = useSshServers()
  const language = useLanguage()
  return (
    <For
      each={ssh.data?.servers.filter(
        (item) =>
          item.saved && `${item.config.name} ${item.config.target}`.toLowerCase().includes(props.filter.toLowerCase()),
      )}
    >
      {(item) => {
        const key = ServerConnection.Key.make(`ssh:${item.config.id}`)
        const health = () => props.domain.collection.health()[key]
        const indicator = () => {
          if (item.stage === "ready") return health() ?? { healthy: true }
          if (item.stage === "incompatible") return { healthy: false, incompatible: true }
          if (item.stage === "failed") return { healthy: false }
          return undefined
        }
        return (
          <div class="settings-servers-row">
            <div class="settings-servers-lead">
              <ServerHealthIndicator health={indicator()} connecting={isSshConnecting(item.stage)} />
              <div class="settings-servers-copy">
                <span class="flex min-w-0 items-center gap-1">
                  <bdi class="settings-servers-name truncate" dir={item.config.name ? "auto" : "ltr"}>
                    {sshName(item.config)}
                  </bdi>
                  <span class="shrink-0 rounded-[3px] border border-v2-border-border-base px-1 py-0.5 text-[9px] leading-none text-v2-text-text-muted">
                    {language.t("ssh.label")}
                  </span>
                </span>
                <Show when={health()?.version}>
                  {(version) => <span class="settings-servers-meta">v{version()}</span>}
                </Show>
              </div>
            </div>
            <div class="settings-servers-actions">
              <Show when={props.domain.defaults.available() && props.domain.defaults.key() === key}>
                <Badge>{language.t("dialog.server.status.default")}</Badge>
              </Show>
              <SshMenu id={item.config.id} domain={props.domain} />
            </div>
          </div>
        )
      }}
    </For>
  )
}
