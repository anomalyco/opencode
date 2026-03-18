import { createMemo, type Accessor } from "solid-js"
import type { Message, Part, UserMessage } from "@opencode-ai/sdk/v2"
import { showToast } from "@opencode-ai/ui/toast"
import type { Platform } from "@/context/platform"
import { createSessionScreenshot, saveScreenshot, screenshotName } from "@/pages/session/session-screenshot"

type Lang = {
  t: (key: string) => string
}

type Input = {
  sessionID: Accessor<string | undefined>
  title: Accessor<string | undefined>
  dir: Accessor<string | undefined>
  messages: Accessor<Message[]>
  parts: (id: string) => Part[]
  revert: Accessor<string | undefined>
  platform: Platform
  language: Lang
}

export function createSessionScreenshotAction(input: Input) {
  const users = createMemo(() => input.messages().filter((msg): msg is UserMessage => msg.role === "user"))
  const visible = createMemo(() => {
    const revert = input.revert()
    if (!revert) return users()
    return users().filter((msg) => msg.id < revert)
  })
  const ready = createMemo(() => input.platform.platform === "desktop" && !!input.sessionID() && visible().length > 0)

  const shot = async () => {
    const id = input.sessionID()
    if (!id || !ready()) return

    const blob = await createSessionScreenshot({
      sessionID: id,
      title: input.title(),
      dir: input.dir(),
      messages: input.messages(),
      parts: input.parts,
      revert: input.revert(),
    }).catch(() => undefined)

    if (!blob) {
      showToast({
        title: input.language.t("toast.session.screenshot.failed.title"),
        description: input.language.t("toast.session.screenshot.failed.description"),
        variant: "error",
      })
      return
    }

    const path = await saveScreenshot(blob, screenshotName(input.title()), input.platform).catch(() => undefined)
    if (path === undefined) return

    showToast({
      title: input.language.t("toast.session.screenshot.success.title"),
      description: path ?? input.language.t("toast.session.screenshot.success.description"),
      actions:
        path && input.platform.openPath
          ? [
              {
                label: input.language.t("common.open"),
                onClick: () => {
                  void input.platform.openPath!(path)
                },
              },
            ]
          : undefined,
      variant: "success",
    })
  }

  return { ready, shot }
}
