# model

## GET /api/model

Retrieve the current snapshot of available models of the requested types, chat by default, ordered by release date within each type. The snapshot may precede initial plugin settlement.

Parameters:
- `types?: Model.Type | Model.Type[]` Only list models of these types. Defaults to chat, the only type offered for sessions.

Returns: `{ location: Location.PublicRef; data: Model.Info[] }`

## GET /api/model/default

Retrieve the model used when a session has no explicit model selection.

Returns: `{ location: Location.PublicRef; data: Model.Info }`

## Types

- `Location.PublicRef`: `{ directory: string }`
- `Model.Info`: `{ id, modelID, providerID, canonical, type, family, name, compatibility, package, settings, headers, body, capabilities, variants, experimental, time, cost, status, enabled, limit }`
- `Model.Type`: `"chat" | "decision" | "image" | "video" | "realtime" | "embedding" | "transcription" | string`
