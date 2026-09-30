import { Show, createMemo, type ComponentProps } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Tooltip } from "@opencode/ui/tooltip"
import { useLanguage } from "@/runtime/i18n/language"
import { useLayout } from "@/shell/state/layout"
import { useSessionLayout } from "@/session/session-layout"
import { SESSION_WIDGETS_TAB } from "@/session/helpers"
import { useWidgetsQuery } from "@/runtime/server/widgets"

// Opens the widgets panel and shows how many widgets are configured. Mirrors the
// context-usage button so it sits naturally beside it in the composer.
export function SessionWidgetsToggle(props: { placement?: ComponentProps<typeof Tooltip>["placement"] }) {
  const language = useLanguage()
  const layout = useLayout()
  const { params, tabs, view } = useSessionLayout()

  const query = useWidgetsQuery({ key: "session-widgets-count" })

  const count = createMemo(() => (query.isPending || query.isError ? 0 : (query.data?.data ?? []).length))
  const active = createMemo(() => view().reviewPanel.opened() && tabs().active() === SESSION_WIDGETS_TAB)

  const toggle = () => {
    if (!params.id) return
    const sessionView = view()
    if (active()) {
      tabs().close(SESSION_WIDGETS_TAB)
      const hasOther = tabs()
        .all()
        .some((tab) => tab !== "context" && tab !== "review" && tab !== SESSION_WIDGETS_TAB)
      if (sessionView.reviewPanel.source() === "context-button" && !hasOther) sessionView.reviewPanel.close()
      return
    }
    sessionView.reviewPanel.open()
    if (layout.fileTree.opened() && layout.fileTree.tab() !== "all") layout.fileTree.setTab("all")
    void tabs()
      .open(SESSION_WIDGETS_TAB)
      .then(() => tabs().setActive(SESSION_WIDGETS_TAB))
  }

  return (
    <Show when={params.id}>
      <Tooltip value={language.t("session.widgets.toggle")} placement={props.placement ?? "top"} shift={-8}>
        <IconButton
          type="button"
          variant="ghost-muted"
          size="large"
          icon={
            <div class="relative flex items-center justify-center">
              <Icon name="widget" />
              <Show when={count() > 0}>
                <span class="absolute -right-1.5 -top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-v2-background-bg-layer-04 px-0.5 text-9-regular text-v2-text-text-base">
                  {count()}
                </span>
              </Show>
            </div>
          }
          state={active() ? "pressed" : undefined}
          onClick={toggle}
          aria-label={language.t("session.widgets.toggle")}
        />
      </Tooltip>
    </Show>
  )
}
