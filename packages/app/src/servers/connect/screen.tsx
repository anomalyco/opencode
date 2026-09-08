import { createMemo, createResource, lazy, Show, Suspense } from "solid-js"
import { createStore } from "solid-js/store"
import { useMutation } from "@tanstack/solid-query"
import { Button } from "@opencode-ai/ui/button"
import { TextInput } from "@opencode-ai/ui/text-input"
import { Wordmark } from "@opencode-ai/ui/wordmark"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useCheckServerHealth } from "@/runtime/server/health"
import { useServers } from "@/runtime/server/registry"
import { serverAddress } from "./pairing"
import { isMixedContent } from "./browser"
import "./screen.css"

const PairingScanner = lazy(() => import("./scanner").then((module) => ({ default: module.PairingScanner })))

export function ConnectServerScreen() {
  const language = useLanguage()
  const platform = usePlatform()
  const servers = useServers()
  const check = useCheckServerHealth()
  const cameraSupported =
    platform.platform === "web" && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia
  const [camera, cameraActions] = createResource(
    async () => {
      if (!cameraSupported || !navigator.mediaDevices.enumerateDevices) return false
      const denied = await navigator.permissions?.query({ name: "camera" }).then(
        (permission) => permission.state === "denied",
        () => false,
      )
      if (denied) return false
      return navigator.mediaDevices.enumerateDevices().then(
        (devices) => devices.some((device) => device.kind === "videoinput"),
        () => false,
      )
    },
    { initialValue: false },
  )
  const [state, setState] = createStore({ url: "", password: "", urls: [] as string[], error: "", scanning: false })
  const mixedContent = createMemo(() => platform.platform === "web" && isMixedContent(location.href, state.url))
  const request = useMutation(() => ({
    mutationFn: async () => {
      const url = serverAddress(state.url)
      if (!url) {
        setState("error", language.t("server.connect.address.invalid"))
        return
      }
      const http = { url, password: state.password || undefined }
      const result = await check(http)
      if (!result.healthy) {
        setState("error", language.t("server.connect.failed"))
        return
      }
      servers.add({ type: "http", http })
    },
    onError: () => setState("error", language.t("server.connect.failed")),
  }))

  return (
    <main data-component="connect-server" aria-labelledby="server-connect-title">
      <div class="server-connect-content">
        <div class="server-connect-brand" role="img" aria-label="OpenCode">
          <Wordmark />
        </div>
        <header>
          <h1 id="server-connect-title">{language.t("server.connect.title")}</h1>
          <p>{language.t("server.connect.description")}</p>
        </header>
        <Show
          when={!state.scanning}
          fallback={
            <Suspense fallback={<p role="status">{language.t("server.connect.camera.starting")}</p>}>
              <PairingScanner
                onCancel={() => {
                  setState("scanning", false)
                  void cameraActions.refetch()
                }}
                onScan={(pairing) => {
                  setState({
                    url: pairing.urls[0],
                    urls: pairing.urls,
                    password: pairing.password,
                    error: "",
                    scanning: false,
                  })
                  request.mutate()
                }}
              />
            </Suspense>
          }
        >
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (request.isPending) return
              setState("error", "")
              request.mutate()
            }}
          >
            <div class="server-connect-field">
              <label for="server-connect-url">{language.t("dialog.server.add.url")}</label>
              <TextInput
                id="server-connect-url"
                name="server"
                dir="ltr"
                type="text"
                inputMode="url"
                autocomplete="url"
                autocapitalize="off"
                spellcheck={false}
                required
                appearance="large"
                list="server-connect-addresses"
                placeholder={language.t("dialog.server.add.placeholder")}
                value={state.url}
                disabled={request.isPending}
                aria-describedby={mixedContent() ? "server-connect-mixed-content" : undefined}
                onInput={(event) => setState({ url: event.currentTarget.value, error: "" })}
              />
              <datalist id="server-connect-addresses">
                {state.urls.map((url) => (
                  <option value={url} />
                ))}
              </datalist>
              <Show when={mixedContent()}>
                <p id="server-connect-mixed-content" class="server-connect-warning" role="status">
                  {language.t("server.connect.mixedContent")}
                </p>
              </Show>
            </div>
            <div class="server-connect-field">
              <label for="server-connect-password">{language.t("dialog.server.add.password")}</label>
              <TextInput
                id="server-connect-password"
                name="password"
                type="password"
                autocomplete="current-password"
                appearance="large"
                value={state.password}
                disabled={request.isPending}
                onInput={(event) => setState({ password: event.currentTarget.value, error: "" })}
              />
            </div>
            <Show when={state.error}>
              <p class="server-connect-error" role="alert">
                {state.error}
              </p>
            </Show>
            <Button type="submit" variant="contrast" size="large" disabled={request.isPending || !state.url.trim()}>
              {language.t(request.isPending ? "dialog.server.add.checking" : "server.connect.button")}
            </Button>
          </form>
          <Show when={platform.platform === "web"}>
            <Button
              variant="neutral"
              size="large"
              disabled={request.isPending || !camera.latest}
              aria-describedby={!camera.latest && !camera.loading ? "server-connect-camera-unavailable" : undefined}
              onClick={() => setState("scanning", true)}
            >
              {language.t("server.connect.scan")}
            </Button>
            <Show when={!camera.latest && !camera.loading}>
              <p id="server-connect-camera-unavailable">
                {language.t(
                  window.isSecureContext ? "server.connect.camera.unavailable" : "server.connect.camera.insecure",
                )}
              </p>
            </Show>
          </Show>
          <footer>
            <p>{language.t("server.connect.pair.description")}</p>
            <code dir="ltr">opencode pair</code>
          </footer>
        </Show>
      </div>
    </main>
  )
}
