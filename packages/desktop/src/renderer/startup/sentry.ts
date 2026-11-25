import pkg from "../../../package.json"

// Errors reach Sentry only when someone clicks Report on the crash page, so no integration may capture on its own.
const UNREPORTED_INTEGRATIONS = new Set(["Breadcrumbs", "GlobalHandlers", "BrowserApiErrors"])

export function desktopVersion() {
  return import.meta.env.OPENCODE_VERSION ?? pkg.version
}

export async function initializeSentry(version: string) {
  if (!import.meta.env.VITE_SENTRY_DSN) return
  const { init } = await import("@sentry/solid")
  init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT ?? import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE ?? `desktop@${version}`,
    initialScope: {
      tags: {
        platform: "desktop",
      },
    },
    integrations: (integrations) =>
      integrations.filter((integration) => !UNREPORTED_INTEGRATIONS.has(integration.name)),
  })
}
