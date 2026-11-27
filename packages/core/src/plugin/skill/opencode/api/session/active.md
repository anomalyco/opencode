# session/active

## GET /api/session/active

List the sessions whose agent is running right now in this server process. Sessions missing from the result are idle.

Returns: `{ data: Record<string, unknown> }`
