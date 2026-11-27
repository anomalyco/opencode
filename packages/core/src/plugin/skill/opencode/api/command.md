# command

## GET /api/command

Retrieve currently registered commands.

Returns: `{ location: Location.PublicRef; data: Command.Info[] }`

## Types

- `Command.Info`: `{ name: string; description?: string }`
- `Location.PublicRef`: `{ directory: string }`
