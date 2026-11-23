# media

## GET /api/experimental/media/{hash} (experimental)

Read a content-addressed media blob by SHA-256 hash with immutable Cache-Control, ETag, and 304 Not Modified support. Only blobs a stored message or inbox item still references are served.

Returns: application/octet-stream
