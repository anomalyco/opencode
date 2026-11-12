import { Button } from "@opencode/ui/button"
import { Show, type ParentProps } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import type { ScannerError, ScannerView } from "./scanner-machine"
import "./scanner.css"

export function PairingScannerView(props: ParentProps<{ view: ScannerView; onCancel: () => void }>) {
  const language = useLanguage()

  const message = (error: ScannerError) => {
    if (error.type === "camera") return language.t("server.connect.camera.error")

    if (error.type === "invalid") return language.t("server.connect.scan.invalid")

    if (error.type === "decode") return language.t("server.connect.scan.failed")

    if (error.type === "timeout") return language.t("common.requestFailed")

    return error.message
  }

  return (
    <section class="server-connect-scanner" aria-label={language.t("server.connect.scan")}>
      <p>{language.t("server.connect.scan.description")}</p>
      <div class="server-connect-video">
        {props.children}
        <Show when={props.view.overlay}>
          {(overlay) => (
            <span role="status" data-busy={overlay() === "redeeming" ? "" : undefined}>
              {language.t(overlay() === "redeeming" ? "dialog.server.add.checking" : "server.connect.camera.starting")}
            </span>
          )}
        </Show>
      </div>
      <Show when={props.view.error}>
        {(error) => (
          <p class="server-connect-error" role="alert">
            {message(error())}
          </p>
        )}
      </Show>
      <Button variant="neutral" size="large" onClick={props.onCancel}>
        {language.t("common.cancel")}
      </Button>
    </section>
  )
}
