# blob

## GET /api/experimental/blob/{id} (experimental)

Stream a stored blob's bytes, such as a generated video, with single byte Range, ETag and 304 Not Modified support. A blob is deleted a week after it was stored.

Parameters:
- `id: string` A stored blob, such as a generated video, which outlives the job that made it

Returns: application/octet-stream
