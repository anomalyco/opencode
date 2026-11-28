# blob

## GET /api/experimental/blob (experimental)

List stored blobs, newest first: one session's, or every blob. Needs experimental.blob_catalog in the server's base config.

Parameters:
- `sessionID?: string` Only blobs made in this session.

Returns: `{ data: Blob.Info[] }`

## POST /api/experimental/blob (experimental)

Store the raw request body as a new blob. Its type is read from its first bytes, falling back to the request's content-type; an image's or video's size and a video's length are read from its headers. Needs experimental.blob_catalog in the server's base config.

Parameters:
- `name?: string` A display name, such as the file name.
- `sessionID?: string` The session the blob belongs with. A label only: deleting the session keeps the blob.

Returns: `{ data: Blob.Info }`

## GET /api/experimental/blob/{blobID} (experimental)

Read a stored blob's info. Its bytes are at /content.

Parameters:
- `blobID: string` A stored blob, such as a generated video or an uploaded image

Returns: `{ data: Blob.Info }`

## PATCH /api/experimental/blob/{blobID} (experimental)

Change a blob's name or metadata. Its bytes, and what was read from them, never change. Needs experimental.blob_catalog in the server's base config.

Parameters:
- `blobID: string` A stored blob, such as a generated video or an uploaded image

Body:
- `name?: string`
- `metadata?: Record<string, unknown>` Replaces the blob's metadata. At most 4 KB as JSON.

Returns: `{ data: Blob.Info }`

## DELETE /api/experimental/blob/{blobID} (experimental)

Delete a blob and its bytes. Needs experimental.blob_catalog in the server's base config.

Parameters:
- `blobID: string` A stored blob, such as a generated video or an uploaded image

Returns: nothing

## GET /api/experimental/blob/{blobID}/content (experimental)

Stream a stored blob's bytes, such as a generated video, with single byte Range, ETag and 304 Not Modified support.

Parameters:
- `blobID: string` A stored blob, such as a generated video or an uploaded image

Returns: application/octet-stream

## Types

- `Blob.Info`: `{ id: string; sessionID?: string; mime: string; bytes: number; name?: string; metadata?: Record<string, unknown>; width?: number; height?: number; durationMs?: number; time: { created, updated } }`
