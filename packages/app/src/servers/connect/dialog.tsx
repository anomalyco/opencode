import { Button } from "@opencode/ui/button"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode/ui/dialog"
import { Divider } from "@opencode/ui/divider"
import { Icon } from "@opencode/ui/icon"
import { TextInput } from "@opencode/ui/text-input"
import { useDialog } from "@opencode/ui/context/dialog"
import { useMutation } from "@tanstack/solid-query"
import {
  type Component,
  Show,
  Suspense,
  createEffect,
  createMemo,
  createSignal,
  lazy,
  onCleanup,
  onMount,
} from "solid-js"
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
import { usePlatform } from "@/runtime/platform/platform"
import { isMixedContent } from "./browser"
import { cameraHint, createCameraAvailability } from "./camera"
import { bareServerAddress, pairingLink, type Pairing } from "./pairing"
import { useRedeemPairing } from "./redeem"
import { ConnectMethodSwitch, type ConnectMethod } from "./method"
import "@/settings/settings.css"

const PairingScanner = lazy(() => import("./scanner").then((module) => ({ default: module.PairingScanner })))

type FormMode = "list" | "add" | "edit"

export const DialogServer: Component<{
  mode: "add" | "edit"
  server?: ServerConnection.Http
  onSave?: (server: ServerConnection.Http) => void
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const platform = usePlatform()
  const camera = createCameraAvailability()

  const form = createFormController({
    // Close first: onSave may open the next dialog, such as the folder picker an interrupted action continues with.
    onSelect: (server) => {
      dialog.close()
      props.onSave?.(server)
    },
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

  const error = () => (
    <Show when={form.state.error()}>
      <span id="dialog-server-error" class="settings-server-dialog-error" role="alert">
        {form.state.error()}
      </span>
    </Show>
  )

  const submitLabel = () => {
    if (form.state.busy()) return language.t("dialog.server.add.checking")

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
          when={!form.state.scanning()}
          fallback={
            <Suspense fallback={<p role="status">{language.t("server.connect.camera.starting")}</p>}>
              <PairingScanner
                onCancel={() => {
                  form.scan.stop()
                  void camera.refetch()
                }}
                redeem={form.scan.redeem}
                onScan={form.scan.complete}
              />
            </Suspense>
          }
        >
          <div class="flex w-full min-w-0 flex-col gap-6">
            <Show when={form.state.signedOut()}>
              <p class="settings-server-dialog-notice" role="status">
                <Icon name="lock" size="small" />
                <span>{language.t("dialog.server.signedOut")}</span>
              </p>
            </Show>
            <Show
              when={form.state.method() === "password"}
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
                    value={form.state.link()}
                    placeholder={language.t("server.connect.link.placeholder")}
                    invalid={!!form.state.error()}
                    disabled={form.state.busy()}
                    autofocus
                    aria-describedby={form.state.error() ? "dialog-server-error" : undefined}
                    onInput={(event) => form.change.link(event.currentTarget.value)}
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
                  value={form.state.value()}
                  placeholder={language.t("dialog.server.add.placeholder")}
                  invalid={!!form.state.error()}
                  disabled={form.state.busy()}
                  autofocus
                  aria-describedby={form.state.error() ? "dialog-server-error" : undefined}
                  onInput={(event) => form.change.value(event.currentTarget.value)}
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
                value={form.state.name()}
                placeholder={language.t("dialog.server.add.namePlaceholder")}
                disabled={form.state.busy()}
                onInput={(event) => form.change.name(event.currentTarget.value)}
                onKeyDown={keyDown}
              />
            </div>
            <Show when={form.state.method() === "password"}>
              <div class="flex w-full min-w-0 flex-col gap-2">
                <label for="dialog-server-password" class="settings-server-dialog-label">
                  {language.t("dialog.server.add.password")}
                </label>
                <TextInput
                  id="dialog-server-password"
                  type="password"
                  appearance="large"
                  class="!w-full self-stretch"
                  value={form.state.password()}
                  placeholder={language.t("dialog.server.add.passwordPlaceholder")}
                  disabled={form.state.busy()}
                  aria-describedby="dialog-server-password-hint"
                  onInput={(event) => form.change.password(event.currentTarget.value)}
                  onKeyDown={keyDown}
                />
                <span id="dialog-server-password-hint" class="settings-server-dialog-hint">
                  {language.t("server.connect.password.hint")}
                </span>
              </div>
            </Show>
            <Show when={form.state.method() === "link" && platform.platform === "web"}>
              <Show
                when={camera.available.latest || camera.available.loading}
                fallback={<span class="settings-server-dialog-hint">{language.t(cameraHint())}</span>}
              >
                <Button
                  variant="neutral"
                  size="large"
                  class="!w-full self-stretch"
                  disabled={form.state.busy() || !camera.available.latest}
                  onClick={form.scan.start}
                >
                  {language.t("server.connect.scan")}
                </Button>
              </Show>
            </Show>
            <ConnectMethodSwitch
              method={form.state.method()}
              disabled={form.state.busy()}
              onChange={form.change.method}
            />
          </div>
        </Show>
      </DialogBody>
      <Show when={!form.state.scanning()}>
        <DialogFooter>
          <Button variant="neutral" disabled={form.state.busy()} onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button variant="contrast" disabled={form.state.busy()} onClick={form.submit}>
            {submitLabel()}
          </Button>
        </DialogFooter>
      </Show>
    </Dialog>
  )
}

function createFormController(options: { onSelect?: (server: ServerConnection.Http) => void } = {}) {
  const platform = usePlatform()
  const server = useServers()
  const tabs = useTabs()
  const global = useGlobal()
  const language = useLanguage()
  const checkServerHealth = useCheckServerHealth()
  const redeem = useRedeemPairing()
  const healthPreview = createServerHealthPreview(checkServerHealth)

  const [store, setStore] = createStore<{
    mode: FormMode
    method: ConnectMethod
    originalUrl: string | undefined
    link: string
    values: ServerFormValues
    scanning: boolean
    error: string
    status: boolean | undefined
  }>({
    mode: "list",
    method: "link",
    originalUrl: undefined,
    link: "",
    values: { url: "", name: "", password: "" },
    scanning: false,
    error: "",
    status: undefined,
  })

  onCleanup(healthPreview.cancel)

  const reset = () => {
    healthPreview.cancel()
    setStore({
      mode: "list",
      method: "link",
      originalUrl: undefined,
      link: "",
      values: { url: "", name: "", password: "" },
      scanning: false,
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

  // A pairing token works on every address of its server. Signing in again to the edited server keeps its address
  // (e.g. localhost) even when the link names another one (e.g. 127.0.0.1 from opencode pair).
  const paired = async (pairing: Pairing) => {
    const original = store.mode === "edit" ? editing() : undefined

    if (!original || original.http.url === pairing.url) return pairing
    const http = { url: original.http.url, password: pairing.password }

    return (await checkServerHealth(http)).healthy ? http : pairing
  }

  // Where the form points: a scanned or pasted pairing link wins, else the address and password fields.
  const target = async (): Promise<ServerConnection.HttpBase | undefined> => {
    if (store.method === "link") {
      const redeemed = await redeem(store.link)

      if (redeemed && "error" in redeemed) return void setStore("error", redeemed.error)

      if (redeemed) return paired(redeemed.pairing)
      // A server address typed here belongs to the password form.
      const address = bareServerAddress(store.link)

      if (address) {
        setStore({ method: "password", link: "", values: { ...store.values, url: address } })
        preview()

        return
      }

      return void setStore("error", language.t("server.connect.link.invalid"))
    }

    // A pairing link pasted into the address field still pairs.
    const redeemed = await redeem(store.values.url)

    if (redeemed && "error" in redeemed) return void setStore("error", redeemed.error)

    if (redeemed) return paired(redeemed.pairing)
    const url = normalizeServerUrl(store.values.url)

    if (!url) return void reset()

    return { url, password: store.values.password || undefined }
  }

  const request = useMutation(() => ({
    mutationFn: async () => {
      const http = await target()

      if (!http) return
      const normalized = http.url
      const original = store.mode === "edit" ? editing() : undefined

      if (store.mode === "edit" && !original) return
      const name = store.values.name.trim() || undefined
      const password = http.password

      // Nothing changed: close, unless the server rejects these credentials, so saving checks them and the action that
      // asked for sign-in can continue.
      if (
        original?.type === "http" &&
        !global.servers.health[ServerConnection.key(original)]?.unauthorized &&
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
        setStore(
          "error",
          language.t(
            platform.platform === "web" && isMixedContent(location.href, normalized)
              ? "server.connect.mixedContent"
              : "dialog.server.add.error",
          ),
        )

        return
      }

      if (original?.type === "http") {
        if (normalized === original.http.url) add(connection)

        if (normalized !== original.http.url) replace(ServerConnection.key(original), connection)
        reset()
        options.onSelect?.(connection)

        return
      }

      reset()
      add(connection)
      options.onSelect?.(connection)
    },
  }))

  const preview = () => {
    // A pairing link is not a server address until it is redeemed, and redeeming spends it.
    if (store.method === "link" || pairingLink(store.values.url)) {
      healthPreview.cancel()
      setStore("status", undefined)

      return
    }

    void healthPreview.preview(store.values, (status) => setStore("status", status))
  }

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
      // A signed-out server needs a new pairing link; otherwise editing starts from its address.
      method: global.servers.health[ServerConnection.key(connection)]?.unauthorized ? "link" : "password",
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

  const pair = (link: string) => {
    healthPreview.cancel()
    setStore({ method: "link", link, scanning: false, error: "" })
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
      method: () => store.method,
      link: () => store.link,
      value: () => store.values.url,
      name: () => store.values.name,
      password: () => store.values.password,
      scanning: () => store.scanning,
      error: () => store.error,
      status: () => store.status,
      signedOut: () => {
        const original = editing()

        return !!original && !!global.servers.health[ServerConnection.key(original)]?.unauthorized
      },
    },
    change: {
      method: (method: ConnectMethod) => {
        if (request.isPending) return
        setStore({ method, error: "" })
        preview()
      },
      link: (value: string) => {
        if (request.isPending) return
        setStore({ link: value, error: "" })
      },
      value: (value: string) => change("url", value),
      name: (value: string) => change("name", value),
      password: (value: string) => change("password", value),
    },
    scan: {
      start: () => setStore("scanning", true),
      stop: () => setStore("scanning", false),
      complete: pair,
      redeem,
    },
    start: { add: startAdd, edit: startEdit },
    reset,
    submit,
  }
}
