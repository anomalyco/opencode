# session/fork

## POST /api/session/{sessionID}/fork

Create a child session with this session's history before a message. Omit before to copy the full history.

Body:
- `before?: string`

Returns: `{ data: Session.Info }`

## Types

- `Session.Info`: `{ id, parentID, fork, projectID, agent, model, cost, tokens, outcome, time, title, subpath, metadata, permissions, revert, location }`
