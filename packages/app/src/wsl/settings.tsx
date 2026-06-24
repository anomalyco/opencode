import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog } from "@opencode-ai/ui/v2/dialog-v2"
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
import { DialogAddWslServer } from "./dialog-add-server"
import { useWslServers } from "./context"
import { wslOpencodeAction, wslRuntimeRetryable } from "./settings-model"

type Controller = ReturnType<typeof useServerManagementController>

export function isWslServer(server: ServerConnection.Any) {
  return server.type === "sidecar" && server.variant === "wsl"
}

export function AddServerMenu(props: { onAddServer: () => void }) {
  const platform = usePlatform()
  const dialog = useDialog()
  const language = useLanguage()
  const openAddWsl = () => {
    dialog.push(() => (
      <Dialog title={language.t("wsl.server.add")} size="large" fit class="settings-v2-wsl-dialog">
        <DialogAddWslServer />
      </Dialog>
    ))
  }
  return (
    <Show
      when={platform.wslServers}
      fallback={
        <ButtonV2 variant="ghost-muted" icon="plus" onClick={props.onAddServer}>
          {language.t("dialog.server.add.button")}
        </ButtonV2>
      }
    >
      <MenuV2 gutter={4} modal={false} placement="bottom-end">
        <MenuV2.Trigger as={ButtonV2} variant="ghost-muted" icon="plus">
          {language.t("dialog.server.add.button")}
        </MenuV2.Trigger>
        <MenuV2.Portal>
          <MenuV2.Content>
            <MenuV2.Item onSelect={props.onAddServer}>{language.t("dialog.server.add.button")}</MenuV2.Item>
            <MenuV2.Item onSelect={openAddWsl}>{language.t("wsl.server.add")}</MenuV2.Item>
          </MenuV2.Content>
        </MenuV2.Portal>
      </MenuV2>
    </Show>
  )
}

export function useFilteredWslServers(filter: Accessor<string>) {
  const wsl = useWslServers()
  return createMemo(() => {
    const servers = wsl.data?.servers ?? []
    const query = filter().trim()
    if (!query) return servers
    return fuzzysort
      .go(query, servers, { keys: [(item) => item.config.distro, (item) => item.config.id] })
      .map((x) => x.obj)
  })
}

export function WslServerSettings(props: {
  controller: Controller
  servers: ReturnType<typeof useFilteredWslServers>
}) {
  const platform = usePlatform()
  const language = useLanguage()
  const wsl = useWslServers()
  const api = platform.wslServers

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
          const check = () => wsl.data?.opencodeChecks[item.config.distro]
          const opencodeAction = () => wslOpencodeAction(check())
          const busy = () => wsl.data?.job?.kind === "install-opencode" && wsl.data.job.distro === item.config.distro
          return (
            <div class="settings-v2-servers-row">
              <div class="settings-v2-servers-lead">
                <ServerHealthIndicator health={props.controller.status()[key]} />
                <div class="settings-v2-servers-copy">
                  <span class="flex min-w-0 items-center gap-1">
                    <span class="settings-v2-servers-name">{item.config.distro}</span>
                    <span class="shrink-0 rounded-[3px] border border-v2-border-border-base px-1 py-0.5 text-[9px] leading-none text-v2-text-text-muted">
                      {language.t("wsl.server.label")}
                    </span>
                  </span>
                  <span class="settings-v2-servers-meta">
                    <Show when={check()?.version}>{(version) => `v${version()}`}</Show>
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
                      onClick={() => api && request.mutate(() => api.installOpencode(item.config.distro))}
                    >
                      {busy() ? language.t("wsl.server.updating") : label()}
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
                        <MenuV2.GroupLabel>{language.t("wsl.server.menu.label")}</MenuV2.GroupLabel>
                        <Show when={wslRuntimeRetryable(item.runtime)}>
                          <MenuV2.Item onSelect={() => api && request.mutate(() => api.startServer(key))}>
                            {language.t("wsl.server.retryStart")}
                          </MenuV2.Item>
                        </Show>
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
