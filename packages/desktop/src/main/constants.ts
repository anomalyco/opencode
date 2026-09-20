type Channel = "dev" | "beta" | "prod"
const raw = import.meta.env.OPENCODE_CHANNEL
export const CHANNEL: Channel = raw === "dev" || raw === "beta" || raw === "prod" ? raw : "dev"

// VeniceCode publishes no update feed, and an ad-hoc signed build cannot install
// an update on macOS anyway. Flip this back on once releases are signed with a
// Developer ID and electron-builder has a `publish` target again.
export const UPDATER_ENABLED = false
