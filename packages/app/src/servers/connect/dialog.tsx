import { Button } from "@opencode/ui/button"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode/ui/dialog"
import { Divider } from "@opencode/ui/divider"
import { Icon } from "@opencode/ui/icon"
import { TextInput } from "@opencode/ui/text-input"
import { useDialog } from "@opencode/ui/context/dialog"
import { type Component, Show, Suspense, createMemo, lazy, untrack } from "solid-js"
import { useGlobal } from "@/runtime/server/runtime"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useTabs } from "@/shell/tabs/tabs"
import { isServerUnauthorized } from "@/runtime/server/health-machine"
import { createServerConnectController } from "./controller"
import type { ServerConnectField, ServerOriginal } from "./machine"
import { ConnectMethodSwitch } from "./method"
import "@/settings/settings.css"

const PairingScanner = lazy(() => import("./scanner").then((module) => ({ default: module.PairingScanner })))

export const DialogServer: Component<{
  mode: "add" | "edit"
  server?: ServerConnection.Http
  onSave?: (server: ServerConnection.Http) => void
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const servers = useServers()
  const global = useGlobal()
  const tabs = useTabs()
  const edited = props.mode === "edit" ? props.server : undefined

  const originalOf = (server: ServerConnection.Http): ServerOriginal => ({
    url: server.http.url,
    displayName: server.displayName,
    password: server.http.password,
    unauthorized: isServerUnauthorized(global.servers.health[ServerConnection.key(server)]),
  })

  const original = createMemo(() => {
    const server = servers.list.find(
      (item): item is ServerConnection.Http => item.type === "http" && item.http.url === edited?.http.url,
    )

    return server && originalOf(server)
  })

  const form = createServerConnectController({
    surface: "dialog",
    target: edited ? { kind: "edit", original: untrack(original) ?? originalOf(edited) } : { kind: "add" },
    original,
    removeTabs: (key) => tabs.removeServer(key),
    closing: () => dialog.closing,
    // Close first: onSave may open the next dialog, such as the folder picker an interrupted action continues with.
    onClose: (saved) => {
      dialog.close()

      if (saved) props.onSave?.(saved)
    },
  })

  const view = form.view
  const submit = () => form.dispatch({ type: "submitted" })
  const change = (field: ServerConnectField, value: string) => form.dispatch({ type: "field.changed", field, value })

  const keyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || event.isComposing) return
    event.preventDefault()
    submit()
  }

  const title = () =>
    props.mode === "add" ? language.t("dialog.server.add.title") : language.t("dialog.server.edit.title")

  const error = () => (
    <Show when={view().error}>
      <span id="dialog-server-error" class="settings-server-dialog-error" role="alert">
        {view().error}
      </span>
    </Show>
  )

  const submitLabel = () => {
    if (view().busy) return language.t("dialog.server.add.checking")

    if (props.mode === "add") return language.t("dialog.server.add.button")

    return language.t("common.save")
  }

  return (
    <Dialog fit class="settings-server-dialog">
      <DialogHeader hideClose={true}>
        <DialogTitle>{title()}</DialogTitle>
      </DialogHeader>
      <Divider />
      <DialogBody class="flex w-full min-w-0 flex-1 flex-col px-4 pt-4 pb-2">
        <Show
          when={!view().scanning}
          fallback={
            <Suspense fallback={<p role="status">{language.t("server.connect.camera.starting")}</p>}>
              <PairingScanner
                onCancel={() => form.dispatch({ type: "scan.cancelled" })}
                redeem={form.redeem}
                onScan={(link) => form.dispatch({ type: "scan.completed", link })}
              />
            </Suspense>
          }
        >
          <div class="flex w-full min-w-0 flex-col gap-6">
            <Show when={view().signedOut}>
              <p class="settings-server-dialog-notice" role="status">
                <Icon name="lock" size="small" />
                <span>{language.t("dialog.server.signedOut")}</span>
              </p>
            </Show>
            <Show
              when={view().draft.method === "password"}
              fallback={
                <div class="flex w-full min-w-0 flex-col gap-2">
                  <label for="dialog-server-link" class="settings-server-dialog-label">
                    {language.t("server.connect.link")}
                  </label>
                  <TextInput
                    id="dialog-server-link"
                    type="text"
                    appearance="large"
                    class="!w-full self-stretch"
                    dir="ltr"
                    spellcheck={false}
                    autocapitalize="off"
                    value={view().draft.link}
                    placeholder={language.t("server.connect.link.placeholder")}
                    invalid={!!view().error}
                    disabled={view().disabled}
                    autofocus
                    aria-describedby={view().error ? "dialog-server-error" : undefined}
                    onInput={(event) => change("link", event.currentTarget.value)}
                    onKeyDown={keyDown}
                  />
                  {error()}
                </div>
              }
            >
              <div class="flex w-full min-w-0 flex-col gap-2">
                <label for="dialog-server-url" class="settings-server-dialog-label">
                  {language.t("dialog.server.add.url")}
                </label>
                <TextInput
                  id="dialog-server-url"
                  type="text"
                  appearance="large"
                  class="!w-full self-stretch"
                  value={view().draft.url}
                  placeholder={language.t("dialog.server.add.placeholder")}
                  invalid={!!view().error}
                  disabled={view().disabled}
                  autofocus
                  aria-describedby={view().error ? "dialog-server-error" : undefined}
                  onInput={(event) => change("url", event.currentTarget.value)}
                  onKeyDown={keyDown}
                />
                {error()}
              </div>
            </Show>
            <div class="flex w-full min-w-0 flex-col gap-2">
              <label for="dialog-server-name" class="settings-server-dialog-label">
                {language.t("dialog.server.add.name")}
              </label>
              <TextInput
                id="dialog-server-name"
                type="text"
                appearance="large"
                class="!w-full self-stretch"
                value={view().draft.name}
                placeholder={language.t("dialog.server.add.namePlaceholder")}
                disabled={view().disabled}
                onInput={(event) => change("name", event.currentTarget.value)}
                onKeyDown={keyDown}
              />
            </div>
            <Show when={view().draft.method === "password"}>
              <div class="flex w-full min-w-0 flex-col gap-2">
                <label for="dialog-server-password" class="settings-server-dialog-label">
                  {language.t("dialog.server.add.password")}
                </label>
                <TextInput
                  id="dialog-server-password"
                  type="password"
                  appearance="large"
                  class="!w-full self-stretch"
                  value={view().draft.password}
                  placeholder={language.t("dialog.server.add.passwordPlaceholder")}
                  disabled={view().disabled}
                  aria-describedby="dialog-server-password-hint"
                  onInput={(event) => change("password", event.currentTarget.value)}
                  onKeyDown={keyDown}
                />
                <span id="dialog-server-password-hint" class="settings-server-dialog-hint">
                  {language.t("server.connect.password.hint")}
                </span>
              </div>
            </Show>
            <Show when={view().showScan}>
              <Button
                variant="neutral"
                size="large"
                class="!w-full self-stretch"
                disabled={!view().canScan}
                onClick={() => form.dispatch({ type: "scan.started" })}
              >
                {language.t("server.connect.scan")}
              </Button>
            </Show>
            <Show when={view().cameraHint}>{(hint) => <span class="settings-server-dialog-hint">{hint()}</span>}</Show>
            <ConnectMethodSwitch
              method={view().draft.method}
              disabled={view().disabled}
              onChange={(method) => form.dispatch({ type: "method.changed", method })}
            />
          </div>
        </Show>
      </DialogBody>
      <Show when={!view().scanning}>
        <DialogFooter>
          <Button variant="neutral" disabled={view().disabled} onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button variant="contrast" disabled={view().disabled} onClick={submit}>
            {submitLabel()}
          </Button>
        </DialogFooter>
      </Show>
    </Dialog>
  )
}
