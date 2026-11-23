# permission

## GET /api/permission/request

Retrieve pending permission requests for a location.

Returns: `{ location: Location.PublicRef; data: Permission.Request[] }`

## GET /api/permission/saved

Retrieve saved permissions, optionally filtered by project.

Parameters:
- `projectID?: string` Project whose saved permissions to list. Defaults to the project of the requested location.

Returns: `{ data: PermissionSaved.Info[] }`

## Types

- `Location.PublicRef`: `{ directory: string }`
- `Permission.Request`: `{ id: string; sessionID: string; action: string; resources: string[]; save?: string[]; metadata?: Record<string, unknown>; source?: Permission.Source; message?: string }`
- `Permission.Source`: `{ type: "tool"; messageID: string; id: string }`
- `PermissionSaved.Info`: `{ id: string; projectID: string; action: string; resource: string; time: { created, updated } }`
