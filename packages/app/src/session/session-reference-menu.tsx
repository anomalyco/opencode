import { Show } from "solid-js"
import { Portal } from "solid-js/web"
import { Menu } from "@opencode/ui/menu"
import { writeClipboard } from "@opencode/session-ui/copy"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useData } from "@/runtime/server/current"
import { showToast } from "@/shell/notifications/toast"

export type SessionReferenceMenuTarget = { sessionID: string; x: number; y: number }

export function SessionReferenceMenu(props: {
  target: SessionReferenceMenuTarget | undefined
  currentSessionID: string | undefined
  onOpenSession: (sessionID: string) => void
  onClose: () => void
}) {
  const language = useLanguage()
  const platform = usePlatform()
  const data = useData()

  const title = () => {
    const session = props.target ? data.session.get(props.target.sessionID) : undefined

    return session && !session.time.archived ? session.title || undefined : undefined
  }

  const copy = async (text: string, failure: { title: string; description: string }) => {
    try {
      const written = platform.writeClipboardText
        ? await platform.writeClipboardText(text).then(() => true)
        : await writeClipboard(text)

      if (!written) throw new Error(failure.description)
      showToast({ variant: "success", icon: "circle-check", title: language.t("common.copied"), description: text })
    } catch (err) {
      showToast({
        variant: "error",
        title: failure.title,
        description: err instanceof Error ? err.message : failure.description,
      })
    }
  }

  return (
    <Menu
      modal={false}
      placement="bottom-start"
      gutter={2}
      open={!!props.target}
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
    >
      {/* Portaled so a transformed ancestor never offsets the fixed trigger. */}
      <Portal>
        <Menu.Trigger
          as="span"
          aria-hidden="true"
          disabled
          class="pointer-events-none fixed size-px"
          style={{ left: `${props.target?.x ?? 0}px`, top: `${props.target?.y ?? 0}px` }}
        />
      </Portal>
      <Menu.Portal>
        <Menu.Content onCloseAutoFocus={(event) => event.preventDefault()}>
          <Show when={props.target?.sessionID}>
            {(sessionID) => (
              <>
                <Show when={sessionID() !== props.currentSessionID}>
                  <Menu.Item onSelect={() => props.onOpenSession(sessionID())}>
                    {language.t("session.reference.open")}
                  </Menu.Item>
                </Show>
                <Menu.Item
                  onSelect={() =>
                    void copy(sessionID(), {
                      title: language.t("toast.session.copyID.failed.title"),
                      description: language.t("toast.session.copyID.failed.description"),
                    })
                  }
                >
                  {language.t("command.session.copyID")}
                </Menu.Item>
                <Show when={title()}>
                  {(value) => (
                    <Menu.Item
                      onSelect={() =>
                        void copy(value(), {
                          title: language.t("session.reference.copyTitle.failed"),
                          description: language.t("common.requestFailed"),
                        })
                      }
                    >
                      {language.t("session.reference.copyTitle")}
                    </Menu.Item>
                  )}
                </Show>
              </>
            )}
          </Show>
        </Menu.Content>
      </Menu.Portal>
    </Menu>
  )
}
