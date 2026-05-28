# OpenAI Responses WebSocket

Enabled by default on `local`, `dev`, and `beta`. On `latest` and `prod`, set `OPENCODE_EXPERIMENTAL_WEBSOCKETS=true`.

## Flow

1. A streamed `POST /responses` request arrives.
2. If it has no `session-id` or `x-session-affinity` header, use HTTP.
3. Title requests use HTTP.
4. If that session's socket is busy or already in fallback mode, use HTTP.
5. Otherwise, reuse its open socket or open a new one.
6. Send `response.create` and return WebSocket events as SSE.

## Lifetime

- Connect timeout: 15 seconds.
- Idle timeout: 5 minutes.
- After a completed response, keep the socket for reuse.
- Reuse a socket for up to 55 minutes, then replace it on the next request.

## Retries

- If WebSocket setup fails or it fails before its first event, replay over HTTP and keep that session on HTTP until idle-pruned.
- If the server returns `websocket_connection_limit_reached` before output, reconnect up to 5 times, then follow the same HTTP fallback.
- If a WebSocket fails after its first event, fail the stream. Do not replay partial output.
- Abort or cancel closes the socket.

## Next Steps

- `previous_response_id` continuation.
- Optional second WebSocket for concurrent requests in one session. Currently these use HTTP.
