# artifacts

## GET /api/experimental/artifacts/providers (experimental)

Return active artifact providers and default.

Returns: `{ location: Location.PublicRef; data: Artifact.Provider[] }`

## GET /api/experimental/artifacts (experimental)

List published artifacts, newest update first.

Parameters:
- `sessionID?: string`
- `provider?: string`

Returns: `{ location: Location.PublicRef; data: Artifact.Info[] }`

## POST /api/experimental/artifacts (experimental)

Publish a new artifact through the selected or default artifact provider.

Body:
- `title: string`
- `files: Record<string, string>`
- `entry?: string`
- `provider?: string`
- `sessionID?: string`

Returns: `{ location: Location.PublicRef; data: Artifact.Info }`

## GET /api/experimental/artifacts/{artifactID} (experimental)

Read an artifact's metadata and file contents.

Returns: `{ location: Location.PublicRef; data: Artifact.Content }`

## PATCH /api/experimental/artifacts/{artifactID} (experimental)

Replace an artifact's files at the same ID and URL.

Body:
- `title?: string`
- `files: Record<string, string>`
- `entry?: string`
- `sessionID?: string`

Returns: `{ location: Location.PublicRef; data: Artifact.Info }`

## DELETE /api/experimental/artifacts/{artifactID} (experimental)

Remove an artifact and its stored files.

Returns: nothing

## GET /api/experimental/artifacts/{artifactID}/view/* (experimental)

Serve HTML and static files from the local provider.

Returns: application/octet-stream

## Types

- `Artifact.Content`: `{ info: Artifact.Info; files: Record<string, string> }`
- `Artifact.Info`: `{ id: string; provider: string; sessionID?: string; title: string; entry: string; url: string; time: Artifact.Time }`
- `Artifact.Provider`: `{ id: string; name: string; capabilities: ("static" | "server-code" | "sqlite" | "durable-objects")[]; default: boolean }`
- `Artifact.Time`: `{ created: number; updated: number }`
- `Location.PublicRef`: `{ directory: string }`
