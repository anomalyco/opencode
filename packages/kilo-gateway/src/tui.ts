/**
 * Kilo Gateway TUI Integration
 *
 * This module provides TUI-specific functionality for kilo-gateway.
 * It requires OpenCode TUI dependencies to be injected at runtime.
 *
 * Import from "@kilocode/kilo-gateway/tui" for TUI features.
 */

// ============================================================================
// TUI Dependency Injection
// ============================================================================
export { initializeTUIDependencies, getTUIDependencies, areTUIDependenciesInitialized } from "./tui/context.js"
export type { TUIDependencies } from "./tui/types.js"

// ============================================================================
// TUI Helpers
// ============================================================================
export { formatProfileInfo, getOrganizationOptions, getDefaultOrganizationSelection } from "./tui/helpers.js"

// ============================================================================
// NOTE: TUI Components Moved to OpenCode
// ============================================================================
// All TUI components with JSX have been moved to packages/opencode/src/kilocode/
// to ensure correct JSX transpilation with @opentui/solid.
//
// Components moved:
// - registerKiloCommands -> @/kilocode/kilo-commands
// - DialogKiloTeamSelect -> @/kilocode/components/dialog-kilo-team-select
// - DialogKiloOrganization -> @/kilocode/components/dialog-kilo-organization
// - DialogKiloProfile -> @/kilocode/components/dialog-kilo-profile
// - KiloAutoMethod -> @/kilocode/components/dialog-kilo-auto-method
// - KiloNews -> @/kilocode/components/kilo-news
// - NotificationBanner -> @/kilocode/components/notification-banner
// - DialogKiloNotifications -> @/kilocode/components/dialog-kilo-notifications
