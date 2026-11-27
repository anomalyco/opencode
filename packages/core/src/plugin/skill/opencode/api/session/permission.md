# session/permission

## GET /api/session/{sessionID}/permission

Retrieve pending permission requests owned by a session.

Returns: `{ data: Permission.Request[] }`

## GET /api/session/{sessionID}/permission/{requestID}

Retrieve a pending permission request owned by a session.

Returns: `{ data: Permission.Request }`

## Types

- `Permission.Request`: `{ id: string; sessionID: string; action: string; resources: string[]; save?: string[]; metadata?: Record<string, unknown>; source?: Permission.Source; message?: string }`
- `Permission.Source`: `{ type: "tool"; messageID: string; id: string }`
