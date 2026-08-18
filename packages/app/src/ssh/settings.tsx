import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { useMutation } from "@tanstack/solid-query"
import fuzzysort from "fuzzysort"
import { type Accessor, For, Show, createMemo } from "solid-js"
import type { useServerManagementController } from "@/components/dialog-select-server"
import { ServerHealthIndicator } from "@/components/server/server-row"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { ServerConnection } from "@/context/server"
import { showToast } from "@/utils/toast"
import { useSshServers } from "./context"
import {
  sshOpencodeAction,
  sshRuntimeDisconnectable,
  sshRuntimeRetryable,
  sshRuntimeStatus,
  type SshAddText,
} from "./settings-model"

type Controller = ReturnType<typeof useServerManagementController>

export function isSshServer(server: ServerConnection.Any) {
  return server.type === "ssh"
}

export function translateSshText(language: ReturnType<typeof useLanguage>, value: SshAddText) {
  if (value.params) return language.t(value.key, value.params)
  return language.t(value.key)
}

export function useFilteredSshServers(filter: Accessor<string>) {
  const ssh = useSshServers()
  return createMemo(() => {
    const servers = ssh.data?.servers ?? []
    const query = filter().trim()
    if (!query) return servers
    return fuzzysort
      .go(query, servers, { keys: [(item) => item.config.host, (item) => item.config.id] })
      .map((x) => x.obj)
  })
}

export function SshServerSettings(props: {
  controller: Controller
  servers: ReturnType<typeof useFilteredSshServers>
}) {
  const platform = usePlatform()
  const language = useLanguage()
  const ssh = useSshServers()
  const api = platform.sshServers

  const request = useMutation(() => ({
    mutationFn: (action: () => Promise<unknown>) => action(),
    onError: (error) =>
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: error instanceof Error ? error.message : String(error),
      }),
  }))

  const remove = (key: ServerConnection.Key) => {
    request.mutate(() => props.controller.handleRemove(key))
  }

  return (
    <Show when={api}>
      <For each={props.servers()}>
        {(item) => {
          const key = ServerConnection.Key.make(item.config.id)
          const probe = () => ssh.data?.hostProbes[item.config.host]
          const opencodeAction = () => sshOpencodeAction(probe(), item.runtime)
          const busy = () => ssh.data?.job?.kind === "install-opencode" && ssh.data.job.host === item.config.host
          const status = () => sshRuntimeStatus(item.runtime)
          return (
            <div class="settings-v2-servers-row">
              <div class="settings-v2-servers-lead">
                <ServerHealthIndicator health={props.controller.status()[key]} />
                <div class="settings-v2-servers-copy">
                  <span class="flex min-w-0 items-center gap-1">
                    <span class="settings-v2-servers-name">{item.config.host}</span>
                    <span class="shrink-0 rounded-[3px] border border-v2-border-border-base px-1 py-0.5 text-[9px] leading-none text-v2-text-text-muted">
                      {language.t("ssh.server.label")}
                    </span>
                  </span>
                  <span class="settings-v2-servers-meta" title={status().message}>
                    <Show
                      when={status().message}
                      fallback={
                        <Show
                          when={status().text}
                          fallback={<Show when={probe()?.opencodeVersion}>{(version) => `v${version()}`}</Show>}
                        >
                          {(text) => translateSshText(language, text())}
                        </Show>
                      }
                    >
                      {(message) => message()}
                    </Show>
                  </span>
                </div>
              </div>
              <div class="settings-v2-servers-actions">
                <Show when={props.controller.canDefault() && props.controller.defaultKey() === key}>
                  <Tag>{language.t("dialog.server.status.default")}</Tag>
                </Show>
                <Show when={opencodeAction()}>
                  {(label) => (
                    <ButtonV2
                      size="small"
                      disabled={busy() || request.isPending}
                      onClick={() => api && request.mutate(() => api.installOpencode(item.config.host))}
                    >
                      {busy() ? language.t("ssh.server.updating") : translateSshText(language, label())}
                    </ButtonV2>
                  )}
                </Show>
                <MenuV2 gutter={4} modal={false} placement="bottom-end">
                  <MenuV2.Trigger
                    as={IconButtonV2}
                    variant="ghost-muted"
                    size="small"
                    icon={<IconV2 name="outline-dots" />}
                    aria-label={language.t("common.moreOptions")}
                  />
                  <MenuV2.Portal>
                    <MenuV2.Content>
                      <MenuV2.Group>
                        <MenuV2.GroupLabel>{language.t("ssh.server.menu.label")}</MenuV2.GroupLabel>
                        <Show when={sshRuntimeRetryable(item.runtime)}>
                          <MenuV2.Item onSelect={() => api && request.mutate(() => api.startServer(key))}>
                            {language.t("ssh.server.retryStart")}
                          </MenuV2.Item>
                        </Show>
                        <Show when={sshRuntimeDisconnectable(item.runtime)}>
                          <MenuV2.Item onSelect={() => api && request.mutate(() => api.stopServer(key))}>
                            {language.t("ssh.server.disconnect")}
                          </MenuV2.Item>
                        </Show>
                        <MenuV2.Item onSelect={() => api && request.mutate(() => api.openTerminal(item.config.host))}>
                          {language.t("ssh.server.openTerminal")}
                        </MenuV2.Item>
                        <Show when={props.controller.canDefault() && props.controller.defaultKey() !== key}>
                          <MenuV2.Item onSelect={() => props.controller.setDefault(key)}>
                            {language.t("dialog.server.menu.default")}
                          </MenuV2.Item>
                        </Show>
                        <Show when={props.controller.canDefault() && props.controller.defaultKey() === key}>
                          <MenuV2.Item onSelect={() => props.controller.setDefault(null)}>
                            {language.t("dialog.server.menu.defaultRemove")}
                          </MenuV2.Item>
                        </Show>
                        <MenuV2.Separator />
                        <MenuV2.Item onSelect={() => remove(key)}>
                          {language.t("dialog.server.menu.delete")}
                        </MenuV2.Item>
                      </MenuV2.Group>
                    </MenuV2.Content>
                  </MenuV2.Portal>
                </MenuV2>
              </div>
            </div>
          )
        }}
      </For>
    </Show>
  )
}
