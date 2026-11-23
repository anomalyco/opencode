# machine

## GET /api/experimental/machine (experimental)

List known machines and whether each is paired and online. Behind the machines flag.

Returns: `{ data: Machine.Info[] }`

## POST /api/experimental/machine (experimental)

Add a machine by name if it does not exist, then create a single-use join string carrying the given reach addresses. Behind the machines flag.

Body:
- `name: string`
- `reach: Machine.Reach[]`
- `replace?: boolean`

Returns: `{ data: Machine.Invite }`

## DELETE /api/experimental/machine/{name} (experimental)

Forget a machine by name, closing any live link and revoking its key. Behind the machines flag.

Returns: nothing

## Types

- `Machine.Info`: `{ id: string; online: boolean; paired: boolean; os?: string; arch?: string; connection?: { kind, path, rtt } }`
- `Machine.Invite`: `{ name: string; join: string; expires: number; reach: (Machine.Reach | { type })[] }`
- `Machine.Reach`: `{ type: "url"; url: string }`
