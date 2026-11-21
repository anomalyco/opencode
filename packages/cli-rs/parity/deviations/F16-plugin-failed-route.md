# F16: the route of a plugin that failed says so

## TypeScript

A route that no plugin registers shows `plugin-route-missing.tsx`: "Unknown plugin route: <id>/<name>" in the warning
color, and a "go home" button. A plugin whose setup throws registers no route, so its route shows the same screen.

## Rust

A route that no plugin registers shows the same screen. When the plugin that owns the route is listed failed, for
example after its view overran the call limit while the route showed, the screen says "Plugin <id> failed. Run
/plugins for details." instead, with the same "go home" button (`crates/tui/src/features/route_missing.rs`).

## Reason

A plugin fails at run time, under containment, while its route is on screen, and the host then
shows its route again. "Unknown plugin route" named a route that exists and hid why it went. The plugins
list has the error.
