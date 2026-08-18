import { t } from "../i18n"

export function requireRendererRoot() {
  const root = document.getElementById("root")
  if (root instanceof HTMLElement) return root
  if (import.meta.env.DEV) throw new Error(t("desktop.error.dev.rootNotFound"))
  return root!
}
