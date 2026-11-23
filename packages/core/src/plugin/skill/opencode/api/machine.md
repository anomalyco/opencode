# machine

## GET /api/experimental/machine (experimental)

List known machines and whether each is paired and online. Behind the machines flag.

Returns: `{ data: Machine.Info[] }`

## Types

- `Machine.Info`: `{ id: string; online: boolean; paired: boolean; os?: string; arch?: string; connection?: { kind, path, rtt } }`
