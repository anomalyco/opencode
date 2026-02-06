export function wrapLayout<T>(layout: T): T {
  return layout
}

export function wrapRoutes<T>(routes: T): T {
  return routes
}

export { LoginApp } from "./login"
export { TwoFactorApp } from "./two-factor"
export { TwoFactorSetupApp } from "./two-factor-setup"
export { ManageTwoFactorDialog } from "./manage-2fa-dialog"
export { SessionIndicator } from "./session-indicator"
export { SessionExpiredOverlay } from "./session-expired-overlay"
export { SecurityBadge } from "./security-badge"
export { HttpWarningBanner } from "./http-warning-banner"
export { createSessionExpirationWarning } from "./session-expiration-warning"
export { AuthGate, AuthRedirect } from "./auth-gate"
export { createCsrfFetch } from "./csrf-fetch"
export { formatAuthInitError } from "./auth-error"
export {
  useCloneProgress,
  type CloneAuthType,
  type UseCloneProgressOptions,
  type UseCloneProgressReturn,
  type CloneProgressServer,
  type CloneProgressPlatform,
} from "./use-clone-progress"
export { injectSecurityBadgeStyles } from "./security-badge-style"
