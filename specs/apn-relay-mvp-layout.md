# APN Relay MVP Layout

This is the minimum setup to get reliable mobile background notifications working with OpenCode.

## Part 1: APN Relay spec and routes

### Goal

- Receive event posts from OpenCode.
- Look up device tokens by shared secret.
- Send APNs notifications to iOS devices.
- Keep the service small and easy to run in Docker.

### Stack

- Runtime: Bun
- Web framework: Hono
- Database: PlanetScale MySQL (via Drizzle ORM)
- Deployment artifact: Docker image (`packages/apn-relay`)

### Minimal data model

- `device_registration`
  - `id`
  - `secret_hash` (hash of shared secret)
  - `device_token` (APNs token)
  - `bundle_id`
  - `apns_env` (`sandbox` or `production`)
  - `created_at`
  - `updated_at`
- `delivery_log` (optional but recommended)
  - `id`
  - `secret_hash`
  - `event_type`
  - `session_id`
  - `status` (`sent` or `failed`)
  - `error`
  - `created_at`

### API routes

#### `GET /health`

- Response: `{ ok: true }`

#### `POST /v1/device/register`

- Purpose: upsert device token for a shared secret.
- Body:
  - `secret` (string)
  - `deviceToken` (string)
  - `bundleId` (string)
  - `apnsEnv` (`sandbox` or `production`)
- Response: `{ ok: true }`

#### `POST /v1/device/unregister`

- Purpose: remove token mapping for a shared secret.
- Body:
  - `secret` (string)
  - `deviceToken` (string)
- Response: `{ ok: true }`

#### `POST /v1/event`

- Purpose: receive event from OpenCode and push to all devices for that secret.
- Body:
  - `secret` (string)
  - `eventType` (`complete` or `permission` or `error`)
  - `sessionID` (string)
  - `title` (optional string)
  - `body` (optional string)
- Response:
  - `{ ok: true, sent: number, failed: number }`

### APNs behavior for MVP

- Use APNs auth key (`.p8`) with JWT auth.
- Default to user-visible alert pushes for reliability.
  - `apns-push-type: alert`
  - `apns-priority: 10`
- Payload includes `eventType` and `sessionID` in `data`.
- Keep advanced silent/background tuning out of scope for MVP.

### Env vars

- `PORT`
- `DATABASE_URL`
- `APNS_TEAM_ID`
- `APNS_KEY_ID`
- `APNS_PRIVATE_KEY`
- `APNS_DEFAULT_BUNDLE_ID` (fallback)

## Part 2: Mobile app setup (`packages/mobile-voice`)

### Goal

- Pair app with OpenCode server using QR data.
- Register APNs token in relay using shared secret.
- Keep existing foreground SSE behavior.
- Receive APNs when app is backgrounded or terminated.

### Pairing flow (simple)

1. User runs OpenCode serve with relay enabled.
2. OpenCode prints a QR code that includes:
   - `hosts` (array of server URLs)
   - `relayURL`
   - `relaySecret`
3. User scans QR in mobile app.
4. App saves `relaySecret` in secure storage and server profile metadata.

### Token registration flow

1. App gets APNs token (`Notifications.getDevicePushTokenAsync()`).
2. App calls `POST {relayURL}/v1/device/register` with secret and token.
3. App re-registers on token change and on app startup.

### Prompt and monitoring flow

1. App sends prompt to OpenCode (`POST /session/:id/prompt_async`).
2. If app stays foregrounded, existing SSE monitor still updates UI quickly.
3. If app goes backgrounded, APNs notification from relay carries state updates.

### Mobile changes

- Replace Expo push relay integration with APNs relay integration.
- Keep local notification behavior for handling incoming payload data.
- Store `relaySecret` with secure storage, not plain AsyncStorage.
- Remove session-specific monitor start/stop calls for MVP.

## Part 3: OpenCode serve setup and modifications (`packages/opencode`)

### Goal

- Watch all sessions for the current OpenCode server.
- Detect target events in OpenCode server.
- Forward those events to APN relay using shared secret.

### Serve config and terminal UX

- Add serve options:
  - `--relay-url`
  - `--relay-secret` (optional; generate random if missing)
- Default relay URL: `https://apn.dev.opencode.ai`
- If relay is configured, print QR payload in terminal:
  - `hosts` (local LAN and configured host, including Tailscale IP when present)
  - `relayURL`
  - `relaySecret`

### New experimental routes

- No required monitor routes for MVP.
- Optional debug route:
  - `POST /experimental/push/test`
  - Purpose: force-send a test event to relay to validate config.

### Event forwarding behavior

- Subscribe to existing OpenCode events.
- For all sessions under the running OpenCode server:
  - On `permission.asked` -> send `eventType=permission`
  - On `session.error` -> send `eventType=error`
  - On `session.status` idle (or `session.idle`) -> send `eventType=complete`
- Include `sessionID` in every relay request so the mobile app can label the event.
- Best effort posting only for MVP (log failures, no complex retry queue yet).

### Out of scope for this MVP

- Certificate-based trust between OpenCode and relay.
- Complex key rotation UX.
- Multi-tenant dashboard auth model.
- Guaranteed delivery semantics.
