import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Show } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { serverName } from "@/runtime/server/registry"
import { useSettingsDialog } from "@/settings/command"
import type { HomeController } from "./model"

export function HomeConnect(props: { home: HomeController }) {
  const language = useLanguage()
  const dialog = useDialog()
  const settings = useSettingsDialog("servers")
  const server = props.home.server.focused
  let button: HTMLButtonElement | undefined
  const disconnected = () => {
    const conn = server()
    return (
      conn &&
      (props.home.server.health(conn)?.healthy === false || props.home.server.focusedContext()?.sdk.connection.error())
    )
  }
  const add = async () => {
    const { DialogServer } = await import("@/servers/connect/dialog")
    void dialog.show(() => (
      <DialogServer
        mode="add"
        onAdd={props.home.selection.focusServer}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (button?.isConnected) button.focus()
        }}
      />
    ))
  }

  return (
    <section aria-labelledby="home-connect-title" class="min-w-0 px-3 py-8 md:px-6 lg:py-12">
      <div class="mx-auto flex w-full max-w-[440px] flex-col items-start gap-6 lg:mt-12">
        <div class="flex size-12 items-center justify-center rounded-xl bg-v2-background-bg-layer-02 text-v2-icon-icon-base">
          <Icon name="server" size="large" />
        </div>
        <div class="flex min-w-0 flex-col gap-3">
          <h1 id="home-connect-title" class="text-20-medium text-v2-text-text-base">
            {language.t("home.connect.title")}
          </h1>
          <p class="text-14-regular leading-[var(--line-height-base)] text-v2-text-text-muted">
            {language.t("home.connect.description")}
          </p>
          <p class="text-[13px] leading-[var(--line-height-base)] text-v2-text-text-muted">
            {language.t("home.connect.instructions")}
          </p>
        </div>
        <div class="flex w-full flex-wrap items-center gap-2">
          <Button ref={button} variant="contrast" size="large" icon="plus" onClick={add}>
            {language.t("home.connect.add")}
          </Button>
          <Button variant="ghost-muted" size="large" onClick={settings}>
            {language.t("home.connect.manage")}
          </Button>
        </div>
        <Show when={disconnected()}>
          <div class="flex w-full min-w-0 flex-col gap-1 rounded-lg bg-v2-background-bg-layer-01 p-3 text-12-regular leading-[var(--line-height-base)]">
            <span class="text-v2-text-text-muted">{language.t("home.connect.unavailable")}</span>
            <bdi class="[overflow-wrap:anywhere] text-v2-text-text-base">{serverName(server())}</bdi>
          </div>
        </Show>
        <a
          href="https://opencode.ai/v2/docs/troubleshooting/#check-the-background-service"
          target="_blank"
          rel="noopener noreferrer"
          class="text-12-regular text-v2-text-text-muted underline underline-offset-4 hover:text-v2-text-text-base"
        >
          {language.t("home.connect.help")}
        </a>
      </div>
    </section>
  )
}
