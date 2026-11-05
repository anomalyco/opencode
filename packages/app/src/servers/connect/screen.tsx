import { lazy, Show, Suspense } from "solid-js"
import { Button } from "@opencode/ui/button"
import { TextInput } from "@opencode/ui/text-input"
import { Wordmark } from "@opencode/ui/wordmark"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { cameraHint, createCameraAvailability } from "./camera"
import { createServerConnectController } from "./controller"
import { ConnectMethodSwitch } from "./method"
import "./screen.css"

const PairingScanner = lazy(() => import("./scanner").then((module) => ({ default: module.PairingScanner })))

export function ConnectServerScreen(props: { url?: string } = {}) {
  const language = useLanguage()
  const platform = usePlatform()
  const camera = createCameraAvailability()
  // Read once: the screen leaves when the server it signs in to answers, so its address does not change while it shows.
  const form = createServerConnectController({ surface: "screen", target: { kind: "connect", url: props.url } })
  const view = form.view

  return (
    <main data-component="connect-server" aria-labelledby="server-connect-title">
      <div class="server-connect-content">
        <div class="server-connect-brand" role="img" aria-label="OpenCode">
          <Wordmark />
        </div>
        <header>
          <h1 id="server-connect-title">{language.t("server.connect.title")}</h1>
          <p>
            {language.t(
              view().draft.method === "link" ? "server.connect.description.pairing" : "server.connect.description",
            )}
          </p>
        </header>
        <Show
          when={!view().scanning}
          fallback={
            <Suspense fallback={<p role="status">{language.t("server.connect.camera.starting")}</p>}>
              <PairingScanner
                redeem={form.redeem}
                onCancel={() => {
                  form.dispatch({ type: "scan.cancelled" })
                  void camera.refetch()
                }}
                onScan={(link) => form.dispatch({ type: "scan.completed", link })}
              />
            </Suspense>
          }
        >
          <form
            onSubmit={(event) => {
              event.preventDefault()
              form.dispatch({ type: "submitted" })
            }}
          >
            <Show
              when={view().draft.method === "password"}
              fallback={
                <div class="server-connect-field">
                  <label for="server-connect-link">{language.t("server.connect.link")}</label>
                  <TextInput
                    id="server-connect-link"
                    name="link"
                    dir="ltr"
                    type="text"
                    inputMode="url"
                    autocapitalize="off"
                    spellcheck={false}
                    required
                    appearance="large"
                    placeholder={language.t("server.connect.link.placeholder")}
                    value={view().draft.link}
                    disabled={view().disabled}
                    aria-describedby={view().error ? "server-connect-error" : undefined}
                    onInput={(event) =>
                      form.dispatch({ type: "field.changed", field: "link", value: event.currentTarget.value })
                    }
                  />
                </div>
              }
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
                  placeholder={language.t("dialog.server.add.placeholder")}
                  value={view().draft.url}
                  disabled={view().disabled}
                  aria-describedby={view().error ? "server-connect-error" : undefined}
                  onInput={(event) =>
                    form.dispatch({ type: "field.changed", field: "url", value: event.currentTarget.value })
                  }
                />
              </div>
              <div class="server-connect-field">
                <label for="server-connect-password">{language.t("dialog.server.add.password")}</label>
                <TextInput
                  id="server-connect-password"
                  name="password"
                  type="password"
                  autocomplete="current-password"
                  appearance="large"
                  value={view().draft.password}
                  disabled={view().disabled}
                  aria-describedby="server-connect-password-hint"
                  onInput={(event) =>
                    form.dispatch({ type: "field.changed", field: "password", value: event.currentTarget.value })
                  }
                />
                <p id="server-connect-password-hint" class="server-connect-hint">
                  {language.t("server.connect.password.hint")}
                </p>
              </div>
            </Show>
            <Show when={view().error}>
              <p id="server-connect-error" class="server-connect-error" role="alert">
                {view().error}
              </p>
            </Show>
            <Button type="submit" variant="contrast" size="large" disabled={!view().canSubmit}>
              {language.t(view().busy ? "dialog.server.add.checking" : "server.connect.button")}
            </Button>
          </form>
          <Show when={view().draft.method === "link" && platform.platform === "web"}>
            <Show
              when={camera.available.latest || camera.available.loading}
              fallback={<p>{language.t(cameraHint())}</p>}
            >
              <Button
                variant="neutral"
                size="large"
                disabled={view().disabled || !camera.available.latest}
                onClick={() => form.dispatch({ type: "scan.started" })}
              >
                {language.t("server.connect.scan")}
              </Button>
            </Show>
          </Show>
          <ConnectMethodSwitch
            method={view().draft.method}
            disabled={view().disabled}
            onChange={(method) => form.dispatch({ type: "method.changed", method })}
          />
          <Show when={view().draft.method === "link"}>
            <footer>
              <p>{language.t("server.connect.pair.link")}</p>
              <code dir="ltr">opencode pair</code>
            </footer>
          </Show>
        </Show>
      </div>
    </main>
  )
}
