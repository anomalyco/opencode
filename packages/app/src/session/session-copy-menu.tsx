import { Show } from "solid-js"
import type { SessionInfo } from "@opencode/client/promise"
import { Menu } from "@opencode/ui/menu"
import { writeClipboard } from "@opencode/session-ui/copy"
import { isFallbackTitle } from "@opencode/util/session-title-fallback"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { showToast } from "@/shell/notifications/toast"

export function SessionCopyMenu(props: { session: SessionInfo | undefined }) {
  const language = useLanguage()
  const platform = usePlatform()

  const copy = async (text: string, failure: { title: string; description: string }) => {
    try {
      const written = platform.writeClipboardText
        ? await platform.writeClipboardText(text).then(() => true)
        : await writeClipboard(text)

      if (!written) throw new Error(failure.description)
    } catch (err) {
      showToast({
        variant: "error",
        title: failure.title,
        description: err instanceof Error ? err.message : failure.description,
      })
    }
  }

  return (
    <Show when={props.session}>
      {(session) => (
        <Menu.Sub gutter={4} overflowPadding={16} overlap>
          <Menu.SubTrigger class="[&_[data-slot=menu-v2-item-chevron]]:text-v2-icon-icon-muted">
            <span>{language.t("session.copy")}</span>
          </Menu.SubTrigger>
          <Menu.Portal>
            <Menu.SubContent class="min-w-[164px]">
              <Menu.Item
                onSelect={() =>
                  void copy(session().id, {
                    title: language.t("toast.session.copyID.failed.title"),
                    description: language.t("toast.session.copyID.failed.description"),
                  })
                }
              >
                {language.t("session.copy.id")}
              </Menu.Item>
              <Show when={!isFallbackTitle(session().title) && session().title}>
                {(title) => (
                  <Menu.Item
                    onSelect={() =>
                      void copy(title(), {
                        title: language.t("session.reference.copyTitle.failed"),
                        description: language.t("common.requestFailed"),
                      })
                    }
                  >
                    {language.t("session.copy.title")}
                  </Menu.Item>
                )}
              </Show>
              <Menu.Item
                onSelect={() =>
                  void copy(session().projectID, {
                    title: language.t("toast.project.copyID.failed.title"),
                    description: language.t("toast.project.copyID.failed.description"),
                  })
                }
              >
                {language.t("session.copy.projectID")}
              </Menu.Item>
            </Menu.SubContent>
          </Menu.Portal>
        </Menu.Sub>
      )}
    </Show>
  )
}
