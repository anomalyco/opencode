# Context desktop extension

Built-in renderer extension for the context-usage button, token and cost statistics,
system-prompt display, raw message inspection, and session export.

The extension contributes a header action and an initially closed panel. It decides
when to open or close that panel and uses the host's tab-closing policy to distinguish
user-opened panels from pinned defaults. On small screens, its panel appears in the
host's additional-panel menu.

Session history, provider metadata, and models come from the shared public client
data cache. Export reads all message pages through the public HTTP client. Shared
UI controls, Markdown, and file rendering come from `@opencode/ui` and
`@opencode/session-ui`. There are no imports from App, Desktop, Core, or Server.

Run `bun typecheck` and `bun test` from this package. App fixtures verify the context
panel, export, resizing, and interaction with other extension panels.
