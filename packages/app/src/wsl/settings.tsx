import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog, DialogFooter } from "@opencode-ai/ui/v2/dialog-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { useMutation } from "@tanstack/solid-query"
import fuzzysort from "fuzzysort"
import { type Accessor, For, Show, createMemo, createSignal } from "solid-js"
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

export function WslAddServerButton() {
  const platform = usePlatform()
  const dialog = useDialog()
  const language = useLanguage()
  const openAdd = () => {
    dialog.push(() => (
      <Dialog title={language.t("wsl.server.add")} size="large" fit class="settings-v2-wsl-dialog">
        <DialogAddWslServer />
      </Dialog>
    ))
  }
  return (
    <Show when={platform.wslServers}>
      <ButtonV2 variant="ghost-muted" icon="plus" onClick={openAdd}>
        {language.t("wsl.server.addShort")}
      </ButtonV2>
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
  const dialog = useDialog()

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

  const openAccess = (item: ReturnType<typeof props.servers>[number]) => {
    dialog.push(() => <DialogWslServerAccess item={item} />)
  }

  const copyAttachCommand = (item: ReturnType<typeof props.servers>[number]) => {
    if (item.runtime.kind !== "ready" || !item.runtime.password) return
    const port = new URL(item.runtime.url).port
    const username = item.runtime.username ?? "opencode"
    const command = `opencode attach http://<windows-host-ip>:${port} --username ${shellQuote(username)} --password ${shellQuote(item.runtime.password)}`
    navigator.clipboard
      .writeText(command)
      .then(() =>
        showToast({
          variant: "success",
          title: language.t("wsl.server.access.copied"),
        }),
      )
      .catch((error) =>
        showToast({
          variant: "error",
          title: language.t("wsl.server.access.copyFailed"),
          description: error instanceof Error ? error.message : String(error),
        }),
      )
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
                    <Show when={item.config.port}>{(port) => ` · ${language.t("wsl.server.access.portMeta", { port: port() })}`}</Show>
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
                        <MenuV2.Item onSelect={() => openAccess(item)}>
                          {language.t("wsl.server.configureAccess")}
                        </MenuV2.Item>
                        <Show when={item.runtime.kind === "ready"}>
                          <MenuV2.Item onSelect={() => copyAttachCommand(item)}>
                            {language.t("wsl.server.copyAttachCommand")}
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

function DialogWslServerAccess(props: { item: ReturnType<ReturnType<typeof useFilteredWslServers>>[number] }) {
  const dialog = useDialog()
  const language = useLanguage()
  const platform = usePlatform()
  const api = platform.wslServers!
  const [port, setPort] = createSignal(props.item.config.port?.toString() ?? "")
  const [password, setPassword] = createSignal(props.item.config.password ?? "")
  const [error, setError] = createSignal("")
  const [saving, setSaving] = createSignal(false)

  const save = () => {
    const trimmedPort = port().trim()
    const parsedPort = trimmedPort ? Number(trimmedPort) : null
    if (parsedPort !== null && (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535)) {
      setError(language.t("wsl.server.access.invalidPort"))
      return
    }
    setSaving(true)
    api
      .updateServer(props.item.config.id, {
        port: parsedPort,
        password: password().trim() || null,
      })
      .then(() => dialog.close())
      .catch((requestError) => {
        setError(requestError instanceof Error ? requestError.message : String(requestError))
      })
      .finally(() => setSaving(false))
  }

  return (
    <Dialog title={language.t("wsl.server.access.title")} fit class="settings-v2-server-dialog">
      <div class="flex w-full min-w-0 flex-1 flex-col px-4">
        <div class="flex w-full min-w-0 flex-col gap-5">
          <div class="text-13-regular text-text-weak">{language.t("wsl.server.access.description")}</div>
          <div class="flex w-full min-w-0 flex-col gap-2">
            <label class="settings-v2-server-dialog-label">{language.t("wsl.server.access.port")}</label>
            <TextInputV2
              type="text"
              inputMode="numeric"
              appearance="large"
              class="!w-full self-stretch"
              value={port()}
              placeholder={language.t("wsl.server.access.portPlaceholder")}
              disabled={saving()}
              onInput={(event) => {
                setError("")
                setPort(event.currentTarget.value)
              }}
            />
          </div>
          <div class="flex w-full min-w-0 flex-col gap-2">
            <label class="settings-v2-server-dialog-label">{language.t("wsl.server.access.password")}</label>
            <TextInputV2
              type="password"
              appearance="large"
              class="!w-full self-stretch"
              value={password()}
              placeholder={language.t("wsl.server.access.passwordPlaceholder")}
              disabled={saving()}
              onInput={(event) => {
                setError("")
                setPassword(event.currentTarget.value)
              }}
            />
          </div>
          <Show when={error()}>
            <span class="settings-v2-server-dialog-error">{error()}</span>
          </Show>
          <div class="text-12-regular text-text-weak">{language.t("wsl.server.access.restart")}</div>
        </div>
      </div>
      <DialogFooter>
        <ButtonV2 variant="neutral" disabled={saving()} onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </ButtonV2>
        <ButtonV2 variant="contrast" disabled={saving()} onClick={save}>
          {language.t("common.save")}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`
}
