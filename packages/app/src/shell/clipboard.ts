import type { Platform } from "@/runtime/platform/platform"
import type { useLanguage } from "@/runtime/i18n/language"
import { errorMessage } from "@/shell/layout/helpers"
import { showToast } from "@/shell/notifications/toast"

type ClipboardPlatform = Pick<Platform, "writeClipboardText">

/** Write text to the native clipboard, falling back to the web API outside the desktop shell. */
export function writeClipboardText(platform: ClipboardPlatform, text: string) {
  return platform.writeClipboardText?.(text) ?? navigator.clipboard.writeText(text)
}

/**
 * Copy a session ID with the toast feedback shared by the command palette and
 * the tab and session context menus.
 */
export async function copySessionID(input: {
  sessionID: string | undefined
  platform: ClipboardPlatform
  language: ReturnType<typeof useLanguage>
}) {
  const sessionID = input.sessionID
  if (!sessionID) return
  try {
    await writeClipboardText(input.platform, sessionID)
    showToast({
      variant: "success",
      icon: "circle-check",
      title: input.language.t("common.copied"),
      description: sessionID,
    })
  } catch (err) {
    showToast({
      variant: "error",
      title: input.language.t("toast.session.copyID.failed.title"),
      description: errorMessage(err, input.language.t("toast.session.copyID.failed.description")),
    })
  }
}
