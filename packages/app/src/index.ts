import { initBrowserOtel } from "./lib/telemetry/browser-otel"
import { initPosthog } from "./lib/telemetry/posthog"

/**
 * Package root (`@opencode-ai/app`): consumers that import this barrel get PostHog + browser OTLP init.
 * The web bundle loads `entry.tsx` from `index.html`, which calls the same. Idempotent guards apply.
 */
if (typeof window !== "undefined") {
  initPosthog()
  initBrowserOtel()
}

export { AppBaseProviders, AppInterface } from "./app"
export { useCommand } from "./context/command"
export { type DisplayBackend, type Platform, PlatformProvider } from "./context/platform"
export { ServerConnection } from "./context/server"
export { handleNotificationClick } from "./utils/notification-click"
