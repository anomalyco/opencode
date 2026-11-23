# reference

## GET /api/reference

List references available in the requested location.

Returns: `{ location: Location.PublicRef; data: Reference.Info[] }`

## Types

- `Location.PublicRef`: `{ directory: string }`
- `Reference.GitSource`: `{ type: "git"; repository: string; branch?: string }`
- `Reference.Info`: `{ name: string; path: string; description?: string; hidden?: boolean; source: Reference.Source }`
- `Reference.LocalSource`: `{ type: "local"; path: string }`
- `Reference.Source`: `Reference.LocalSource | Reference.GitSource`
