import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { DividerV2 } from "@opencode-ai/ui/v2/divider-v2"
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

type Controller = ReturnType<typeof useServerManagementController>

export function isSshServer(server: ServerConnection.Any) {
  return server.type === "ssh"
}

export function useFilteredSshServers(filter: Accessor<string>) {
  const ssh = useSshServers()
  return createMemo(() => {
    const servers = ssh.data?.servers ?? []
    const query = filter().trim()
    if (!query) return servers.map((s) => ({ ...s }))
    return fuzzysort
      .go(query, servers, { keys: [(item) => item.config.name, (item) => item.config.host] })
      .map((x) => ({ ...x.obj }))
  })
}

export function SshServerSettings(props: {
  controller: Controller
  servers: ReturnType<typeof useFilteredSshServers>
}) {
  const platform = usePlatform()
  const language = useLanguage()
  const dialog = useDialog()
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

  const startServer = (id: string) => {
    request.mutate(() => api!.startServer(id))
  }

  return (
    <Show when={api}>
      <For each={props.servers()}>
        {(item) => {
          const key = ServerConnection.Key.make(item.config.id)
          const isRunning = () => item.runtime.kind === "ready"
          const isFailed = () => item.runtime.kind === "failed"
          const runtimeStatus = () => {
            switch (item.runtime.kind) {
              case "authenticating": return language.t("ssh.server.status.authenticating")
              case "installing": return language.t("ssh.server.status.installing")
              case "starting": return language.t("ssh.server.status.starting")
              case "failed": return language.t("ssh.server.status.failed")
              case "stopped": return language.t("ssh.server.status.stopped")
              case "ready": return undefined
            }
          }
          return (
            <div class="settings-v2-servers-row">
              <div class="settings-v2-servers-lead">
                <ServerHealthIndicator
                  health={
                    isRunning() ? { healthy: true }
                    : isFailed() ? { healthy: false }
                    : undefined
                  }
                />
                <div class="settings-v2-servers-copy">
                  <span class="flex min-w-0 items-center gap-1">
                    <span class="settings-v2-servers-name">{item.config.name}</span>
                    <span class="shrink-0 rounded-[3px] border border-v2-border-border-base px-1 py-0.5 text-[9px] leading-none text-v2-text-text-muted">
                      {language.t("ssh.server.label")}
                    </span>
                  </span>
                  <span class="settings-v2-servers-meta">
                    {item.config.host}
                    {item.config.port ? `:${item.config.port}` : ""}
                  </span>
                  <span class="settings-v2-servers-meta">
                    {runtimeStatus()}
                  </span>
                </div>
              </div>
              <div class="settings-v2-servers-actions">
                <Show when={props.controller.canDefault() && props.controller.defaultKey() === key}>
                  <Tag>{language.t("dialog.server.status.default")}</Tag>
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
                        <Show when={item.runtime.kind !== "ready" && item.runtime.kind !== "installing"}>
                          <MenuV2.Item onSelect={() => api && startServer(item.config.id)}>
                            {language.t("ssh.server.retryStart")}
                          </MenuV2.Item>
                        </Show>
                        <Show when={isFailed()}>
                          <MenuV2.Item
                            onSelect={() =>
                              dialog.push(() => (
                                <Dialog fit>
                                  <DialogHeader>
                                    <DialogTitle>{language.t("ssh.server.errorLog.title")}</DialogTitle>
                                  </DialogHeader>
                                  <DividerV2 />
                                  <DialogBody>
                                    <div class="font-mono text-xs whitespace-pre-wrap break-all p-3 rounded-md bg-surface-base max-h-80 overflow-y-auto select-text">
                                      {(item.runtime as { kind: "failed"; message: string }).message}
                                    </div>
                                  </DialogBody>
                                  <DialogFooter>
                                    <ButtonV2 variant="neutral" onClick={() => dialog.close()}>
                                      {language.t("common.close")}
                                    </ButtonV2>
                                  </DialogFooter>
                                </Dialog>
                              ))
                            }
                          >
                            {language.t("ssh.server.viewErrors")}
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
