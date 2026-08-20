import * as Sentry from "@sentry/solid"
import pkg from "../../../package.json"

export function desktopVersion() {
  return import.meta.env.OPENCODE_VERSION ?? pkg.version
}

export function initializeSentry(version: string) {
  if (!import.meta.env.VITE_SENTRY_DSN) return
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT ?? import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE ?? `desktop@${version}`,
    initialScope: {
      tags: {
        platform: "desktop",
      },
    },
    integrations: (integrations) =>
      integrations.filter(
        (integration) =>
          integration.name !== "Breadcrumbs" &&
          !(
            import.meta.env.OPENCODE_CHANNEL === "prod" &&
            (integration.name === "GlobalHandlers" || integration.name === "BrowserApiErrors")
          ),
      ),
  })
}
