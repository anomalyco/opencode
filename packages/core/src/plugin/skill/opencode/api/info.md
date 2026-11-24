# info

## GET /api/info

Return the server identity, connection URLs, paths, and readiness status.

Returns: `ServerInfo`

## Types

- `ServerInfo`: `{ version: string; pid: number; hostname?: string; urls: string[]; paths: { tmp }; capabilities?: { persistentPty } }`
