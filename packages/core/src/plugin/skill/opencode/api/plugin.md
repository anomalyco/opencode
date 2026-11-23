# plugin

## GET /api/plugin

Retrieve enabled server plugins and their current status.

Returns: `{ location: Location.PublicRef; data: Plugin.Info[] }`

## GET /api/plugin/gui

Read an active plugin's prebuilt CommonJS `./gui-experimental` bundle. Desktop app windows run its default export; the desktop app's main process runs its `main` export. Fails with not found when no active plugin has the id or the plugin exports no `./gui-experimental`.

Parameters:
- `id: string`

Returns: `{ location: Location.PublicRef; data: Plugin.GuiBundle }`

## Types

- `Location.PublicRef`: `{ directory: string }`
- `Plugin.Features`: `{ server?: true; tui?: true; rpc?: true; gui?: true }`
- `Plugin.GuiBundle`: `{ code: string; revision: string; options: Record<string, unknown> }`
- `Plugin.Info`: `{ id?: string; source: Plugin.Source; features: Plugin.Features; state: Plugin.State }`
- `Plugin.Source`: `{ type: "builtin" } | { type: "package"; target: string; version?: string; outdated?: true; updating?: true } | { type: "local"; path: string } | { type: "sdk" }`
- `Plugin.State`: `{ status: "active" } | { status: "failed"; error: string; ref?: string }`
