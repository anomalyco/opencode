# rpc

## POST /api/rpc/{rpcID}/{method}

Dispatch a method to the currently registered RPC at the requested location.

Body:
- `input?: unknown`

Returns: `Rpc.Output`

## Types

- `Rpc.Output`: `{ output?: unknown }`
