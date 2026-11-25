# permission

## GET /api/permission/request

Retrieve pending permission requests for a location.

Returns: `{ location: Location.PublicRef; data: Permission.Request[] }`

## Types

- `Location.PublicRef`: `{ directory: string }`
- `Permission.Request`: `{ id: string; sessionID: string; action: string; resources: string[]; save?: string[]; metadata?: Record<string, unknown>; source?: Permission.Source; message?: string; required?: boolean }`
- `Permission.Source`: `{ type: "tool"; messageID: string; id: string }`
