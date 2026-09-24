import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { ServerConnection } from "@/runtime/server/registry"
import { displayName, errorMessage } from "@/shell/layout/helpers"
import type { LocalProject } from "@/shell/state/layout"
import { showToast } from "@/shell/notifications/toast"

export function useRevealProject() {
  const language = useLanguage()
  const platform = usePlatform()
  const available = (conn: ServerConnection.Any) =>
    platform.platform === "desktop" && !!platform.revealPath && ServerConnection.local(conn)

  return {
    available,
    reveal(conn: ServerConnection.Any, project: LocalProject) {
      if (!platform.revealPath || !available(conn)) return
      void platform
        .revealPath(project.worktree)
        .then((revealed) => {
          if (revealed) return
          showToast({
            variant: "error",
            title: language.t("home.project.missing.title"),
            description: language.t("home.project.missing.description", { name: displayName(project) }),
          })
        })
        .catch((cause: unknown) =>
          showToast({
            title: language.t("common.requestFailed"),
            description: errorMessage(cause, language.t("common.requestFailed")),
          }),
        )
    },
  }
}
