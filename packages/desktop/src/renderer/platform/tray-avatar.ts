import type { TrayAvatar } from "../../shared/tray-avatar"

export function trayAvatar(
  project: { name: string; source?: string; variant: string },
  style: Pick<CSSStyleDeclaration, "getPropertyValue">,
): TrayAvatar | undefined {
  const background = style.getPropertyValue(`--v2-avatar-bg-${project.variant}`).trim()
  if (!background) return
  return {
    name: project.name,
    source: project.source,
    background,
    border: style.getPropertyValue(`--v2-avatar-border-${project.variant}`).trim(),
    foreground: style.getPropertyValue("--v2-avatar-fg").trim(),
    highlight: style.getPropertyValue("--v2-alpha-light-16").trim(),
    accent: style.getPropertyValue("--v2-background-bg-accent").trim(),
  }
}
