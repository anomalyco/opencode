import { Button } from "@opencode-ai/ui/button"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/dialog"
import { Divider } from "@opencode-ai/ui/divider"
import { TextInput } from "@opencode-ai/ui/text-input"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useMutation } from "@tanstack/solid-query"
import { type Component, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import {
  createServerHealthPreview,
  replaceServerConnection,
  type ServerFormValues,
} from "@/servers/registry/management"
import { useGlobal } from "@/runtime/server/runtime"
import { useLanguage } from "@/runtime/i18n/language"
import { normalizeServerUrl, ServerConnection, useServers } from "@/runtime/server/registry"
import { useTabs } from "@/shell/tabs/tabs"
import { useCheckServerHealth } from "@/runtime/server/health"
import "@/settings/settings.css"

type FormMode = "list" | "add" | "edit"

export const DialogServer: Component<{
  mode: "add" | "edit"
  server?: ServerConnection.Http
  onAdd?: (server: ServerConnection.Http) => void
  onCloseAutoFocus?: (event: Event) => void
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const form = createFormController({
    onSelect: () => dialog.close(),
    onAdd: (server) => props.onAdd?.(server),
  })
  const [opened, setOpened] = createSignal(false)

  onMount(() => {
    if (props.mode === "add") form.start.add()
    if (props.mode === "edit" && props.server) form.start.edit(props.server)
    setOpened(true)
  })

  onCleanup(() => {
    form.reset()
  })

  createEffect(() => {
    if (!opened()) return
    if (form.state.open()) return
    dialog.close()
  })

  const keyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || event.isComposing) return
    event.preventDefault()
    form.submit()
  }

  const title = () =>
    props.mode === "add" ? language.t("dialog.server.add.title") : language.t("dialog.server.edit.title")

  const submitLabel = () => {
    if (form.state.busy()) return language.t("dialog.server.add.checking")
    if (props.mode === "add") return language.t("dialog.server.add.button")
    return language.t("common.save")
  }

  return (
    <Dialog fit class="settings-server-dialog" onCloseAutoFocus={props.onCloseAutoFocus}>
      <DialogHeader hideClose={true}>
        <DialogTitle>{title()}</DialogTitle>
      </DialogHeader>
      <Divider />
      <DialogBody class="flex w-full min-w-0 flex-1 flex-col px-4 pt-4 pb-2">
        <div class="flex w-full min-w-0 flex-col gap-6">
          <div class="flex w-full min-w-0 flex-col gap-2">
            <label class="settings-server-dialog-label">{language.t("dialog.server.add.url")}</label>
            <TextInput
              type="text"
              appearance="large"
              class="!w-full self-stretch"
              value={form.state.value()}
              placeholder={language.t("dialog.server.add.placeholder")}
              invalid={!!form.state.error()}
              disabled={form.state.busy()}
              autofocus
              onInput={(event) => form.change.value(event.currentTarget.value)}
              onKeyDown={keyDown}
            />
            <Show when={form.state.error()}>
              <span class="settings-server-dialog-error">{form.state.error()}</span>
            </Show>
          </div>
          <div class="flex w-full min-w-0 flex-col gap-2">
            <label class="settings-server-dialog-label">{language.t("dialog.server.add.name")}</label>
            <TextInput
              type="text"
              appearance="large"
              class="!w-full self-stretch"
              value={form.state.name()}
              placeholder={language.t("dialog.server.add.namePlaceholder")}
              disabled={form.state.busy()}
              onInput={(event) => form.change.name(event.currentTarget.value)}
              onKeyDown={keyDown}
            />
          </div>
          <div class="flex w-full min-w-0 flex-col gap-2">
            <label class="settings-server-dialog-label">{language.t("dialog.server.add.password")}</label>
            <TextInput
              type="password"
              appearance="large"
              class="!w-full self-stretch"
              value={form.state.password()}
              placeholder={language.t("dialog.server.add.passwordPlaceholder")}
              disabled={form.state.busy()}
              onInput={(event) => form.change.password(event.currentTarget.value)}
              onKeyDown={keyDown}
            />
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="neutral" disabled={form.state.busy()} onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </Button>
        <Button variant="contrast" disabled={form.state.busy()} onClick={form.submit}>
          {submitLabel()}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

function createFormController(
  options: { onSelect?: () => void; onAdd?: (server: ServerConnection.Http) => void } = {},
) {
  const server = useServers()
  const tabs = useTabs()
  const global = useGlobal()
  const language = useLanguage()
  const checkServerHealth = useCheckServerHealth()
  const healthPreview = createServerHealthPreview(checkServerHealth)
  const [store, setStore] = createStore({
    mode: "list" as FormMode,
    originalUrl: undefined as string | undefined,
    values: { url: "", name: "", password: "" },
    error: "",
    status: undefined as boolean | undefined,
  })

  onCleanup(healthPreview.cancel)

  const reset = () => {
    healthPreview.cancel()
    setStore({
      mode: "list",
      originalUrl: undefined,
      values: { url: "", name: "", password: "" },
      error: "",
      status: undefined,
    })
  }
  const allServers = () => {
    return server.list
  }
  const editing = createMemo(() =>
    allServers().find((item) => item.type === "http" && item.http.url === store.originalUrl),
  )
  const add = (connection: ServerConnection.Http) => server.add(connection)
  const replace = (originalKey: ServerConnection.Key, next: ServerConnection.Http) =>
    replaceServerConnection(originalKey, next, {
      removeTabs: (key) => tabs.removeServer(key),
      add,
      remove: (key) => server.remove(key),
    })

  const request = useMutation(() => ({
    mutationFn: async () => {
      const normalized = normalizeServerUrl(store.values.url)
      if (!normalized) {
        reset()
        return
      }

      const original = store.mode === "edit" ? editing() : undefined
      if (store.mode === "edit" && !original) return
      const name = store.values.name.trim() || undefined
      const password = store.values.password || undefined
      if (
        original?.type === "http" &&
        normalized === original.http.url &&
        name === original.displayName &&
        password === original.http.password
      ) {
        reset()
        return
      }

      const connection: ServerConnection.Http = {
        type: "http",
        displayName: name,
        http: {
          url: normalized,
          password,
        },
      }
      const result = await checkServerHealth(connection.http)
      if (!result.healthy) {
        setStore("error", language.t("dialog.server.add.error"))
        return
      }
      if (original?.type === "http") {
        if (normalized === original.http.url) add(connection)
        if (normalized !== original.http.url) replace(ServerConnection.key(original), connection)
        reset()
        return
      }

      reset()
      const added = add(connection)
      if (added) options.onAdd?.(added)
      options.onSelect?.()
    },
  }))

  const preview = () => void healthPreview.preview(store.values, (status) => setStore("status", status))
  const change = (field: keyof ServerFormValues, value: string) => {
    if (request.isPending) return
    setStore("values", field, value)
    setStore("error", "")
    if (field !== "name") preview()
  }
  const startAdd = () => {
    reset()
    setStore("mode", "add")
  }
  const startEdit = (connection: ServerConnection.Http) => {
    reset()
    setStore({
      mode: "edit",
      originalUrl: connection.http.url,
      values: {
        url: connection.http.url,
        name: connection.displayName ?? "",
        password: connection.http.password ?? "",
      },
      error: "",
      status: global.servers.health[ServerConnection.key(connection)]?.healthy,
    })
  }
  const submit = () => {
    if (store.mode === "list" || request.isPending) return
    setStore("error", "")
    request.mutate()
  }

  createEffect(() => {
    if (store.mode !== "edit") return
    if (editing()) return
    reset()
  })

  return {
    state: {
      mode: () => store.mode,
      open: () => store.mode !== "list",
      adding: () => store.mode === "add",
      busy: () => request.isPending,
      value: () => store.values.url,
      name: () => store.values.name,
      password: () => store.values.password,
      error: () => store.error,
      status: () => store.status,
    },
    change: {
      value: (value: string) => change("url", value),
      name: (value: string) => change("name", value),
      password: (value: string) => change("password", value),
    },
    start: { add: startAdd, edit: startEdit },
    reset,
    submit,
  }
}
