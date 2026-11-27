# session/model

## POST /api/session/{sessionID}/model

Change the model the session uses from its next model call on.

Body:
- `model: Model.Ref`

Returns: nothing

## Types

- `Model.Ref`: `{ id: string; providerID: string; variant?: string }`
