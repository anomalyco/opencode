# Live Activity Implementation Plan

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│  iPhone Lock Screen / Dynamic Island                        │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Live Activity (expo-widgets)                       │    │
│  │  "Installing dependencies..."  ● Working            │    │
│  └─────────────────────────────────────────────────────┘    │
│         ▲ local update (foreground)    ▲ APNs push (bg)     │
│         │                              │                    │
│  ┌──────┴─────┐                        │                    │
│  │ SSE stream │                        │                    │
│  │ /event     │                        │                    │
│  └──────┬─────┘                        │                    │
└─────────┼──────────────────────────────┼────────────────────┘
          │                              │
          ▼                              │
┌──────────────────┐            ┌────────┴─────────┐
│  OpenCode Server │──event──>  │   APN Relay      │
│  (push-relay.ts) │            │  /v1/activity/*   │
│  GlobalBus       │            │  apns.ts          │
└──────────────────┘            └──────────────────┘
```

**Foreground**: App receives SSE events, updates the Live Activity locally via `instance.update()`.
**Background**: OpenCode server fires events to the relay, relay sends `liveactivity` APNs pushes with `content-state`, iOS updates the widget.
**Push-to-start**: Relay sends a `start` push to begin a Live Activity even when the app hasn't initiated one.

## Content-State Shape

```typescript
type SessionActivityProps = {
  status: "working" | "retry" | "permission" | "complete" | "error"
  sessionTitle: string // e.g. "Fix auth bug"
  lastMessage: string // truncated ~120 chars, e.g. "Installing dependencies..."
  retryInfo: string | null // e.g. "Retry 2/5 in 8s" when status is "retry"
}
```

This is intentionally lean -- it keeps APNs payload size well under the 4KB limit.

## Dynamic Island / Lock Screen Layout

| Slot                     | Content                                        |
| ------------------------ | ---------------------------------------------- |
| **Banner** (Lock Screen) | Session title, status badge, last message text |
| **Compact leading**      | App icon or "OC" text                          |
| **Compact trailing**     | Status word ("Working", "Done", "Needs input") |
| **Minimal**              | Small status dot/icon                          |
| **Expanded leading**     | Session title + status                         |
| **Expanded trailing**    | Time elapsed or ETA                            |
| **Expanded bottom**      | Last message text, retry info if applicable    |

---

## Phase 1: Core Live Activity (App-Initiated, Local + Push Updates)

This phase delivers the end-to-end working feature.

### 1a. Install and configure expo-widgets

**Package**: `mobile-voice`

- Add `expo-widgets` and `@expo/ui` to dependencies
- Add the plugin to `app.json`:
  ```json
  [
    "expo-widgets",
    {
      "enablePushNotifications": true,
      "widgets": [
        {
          "name": "SessionActivity",
          "displayName": "OpenCode Session",
          "description": "Live session monitoring on Lock Screen and Dynamic Island"
        }
      ]
    }
  ]
  ```
- Add `NSSupportsLiveActivities: true` and `NSSupportsLiveActivitiesFrequentUpdates: true` to `expo.ios.infoPlist` in `app.json`
- Requires a new EAS dev build after this step

### 1b. Create the Live Activity component

**New file**: `src/widgets/session-activity.tsx`

- Define `SessionActivityProps` type
- Build the `LiveActivityLayout` using `@expo/ui/swift-ui` primitives (`Text`, `VStack`, `HStack`)
- Export via `createLiveActivity('SessionActivity', SessionActivity)`
- Adapt layout per slot (banner, compact, minimal, expanded)
- Use `LiveActivityEnvironment.colorScheme` to handle dark/light

### 1c. Create a Live Activity management hook

**New file**: `src/hooks/use-live-activity.ts`

Responsibilities:

- `startActivity(sessionTitle, sessionId)` -- calls `SessionActivity.start(props, deepLinkURL)`, stores the instance, gets the push token
- `updateActivity(props)` -- calls `instance.update(props)` for foreground SSE-driven updates
- `endActivity(finalStatus)` -- calls `instance.end('default', finalProps)`
- Manages the per-activity push token lifecycle
- Exposes `activityPushToken: string | null` for relay registration
- Handles edge cases: activity already running (end previous before starting new), activities disabled by user, iOS version checks

### 1d. Integrate into useMonitoring

**File**: `src/hooks/use-monitoring.ts`

- Import and use `useLiveActivity`
- **On `beginMonitoring(job)`**: call `startActivity(sessionTitle, job.sessionID)`
- **In the SSE event handler** (foreground): map classified events to `updateActivity()` calls:
  - `session.status` busy -> `{ status: "working", lastMessage: <latest text> }`
  - `session.status` retry -> `{ status: "retry", retryInfo: "Retry N in Xs" }`
  - `permission.asked` -> `{ status: "permission", lastMessage: "Needs your decision" }`
  - `session.status` idle (complete) -> `endActivity("complete")`
  - `session.error` -> `endActivity("error")`
- **On stop monitoring**: end the activity if still running
- **On app background**: stop SSE (already happens), rely on APNs pushes for updates
- **On app foreground**: reconnect SSE, sync local activity state with `syncSessionState()`

### 1e. Register activity push tokens with the relay

**File**: `src/lib/relay-client.ts`

- New function: `registerActivityToken(input)` -- calls new relay endpoint `POST /v1/activity/register`
  ```typescript
  registerActivityToken(input: {
    relayBaseURL: string
    secret: string
    activityToken: string
    sessionID: string
    bundleId?: string
  }): Promise<void>
  ```
- New function: `unregisterActivityToken(input)` -- cleanup
  ```typescript
  unregisterActivityToken(input: {
    relayBaseURL: string
    secret: string
    sessionID: string
  }): Promise<void>
  ```

**File**: `src/hooks/use-live-activity.ts` or `use-monitoring.ts`

- When `activityPushToken` becomes available after `startActivity()`, send it to the relay alongside the `sessionID`
- On activity end, unregister the token

### 1f. Extend the APN relay for Live Activity pushes

**Package**: `apn-relay`

New endpoint: `POST /v1/activity/register`

```typescript
{
  secret: string,
  sessionID: string,
  activityToken: string,    // the per-activity push token
  bundleId?: string
}
```

New endpoint: `POST /v1/activity/unregister`

```typescript
{
  secret: string,
  sessionID: string
}
```

New DB table: `activity_registration`

```sql
id TEXT PRIMARY KEY,
secret_hash TEXT NOT NULL,
session_id TEXT NOT NULL,
activity_token TEXT NOT NULL,
bundle_id TEXT NOT NULL,
apns_env TEXT NOT NULL DEFAULT 'production',
created_at INTEGER NOT NULL,
updated_at INTEGER NOT NULL,
UNIQUE(secret_hash, session_id)
```

Modified: `POST /v1/event` handler

- After sending the regular alert push (existing behavior), also check `activity_registration` for matching `(secret_hash, session_id)`
- If a registration exists, send a second push with:
  - `apns-push-type: liveactivity`
  - `apns-topic: {bundleId}.push-type.liveactivity`
  - Payload with `content-state` containing the `SessionActivityProps` fields
  - `event: "update"` for progress, `event: "end"` for complete/error

New function in `apns.ts`: `sendLiveActivityUpdate(input)`

- Separate from the existing `send()` function
- Uses `liveactivity` push type headers
- Constructs `content-state` payload format

### 1g. Extend the OpenCode server push-relay for richer events

**File**: `packages/opencode/src/server/push-relay.ts`

- Extend `Type` union: `"complete" | "permission" | "error" | "progress"`
- Add cases to `map()` function:
  - `session.status` with `type: "busy"` -> `{ type: "progress", sessionID }`
  - `session.status` with `type: "retry"` -> `{ type: "progress", sessionID }` (with retry metadata)
  - `message.updated` where the message has tool-use or assistant text -> `{ type: "progress", sessionID }` (throttled)
- Add to `notify()` / `post()`: include a `contentState` object in the relay payload for progress events
- Add throttling: don't send more than ~1 progress push per 10-15 seconds to stay within APNs budget
- Extend `evt` payload sent to relay:
  ```typescript
  {
    secret, serverID, eventType, sessionID, title, body,
    // New field for Live Activity updates:
    contentState?: {
      status: "working" | "retry" | "permission" | "complete" | "error",
      sessionTitle: string,
      lastMessage: string,
      retryInfo: string | null
    }
  }
  ```

---

## Phase 2: Push-to-Start

This lets the server start a Live Activity on the phone when a session begins, even if the user didn't initiate it from the app.

### 2a. Register push-to-start token from the app

**File**: `src/hooks/use-live-activity.ts`

- On app launch, call `addPushToStartTokenListener()` from `expo-widgets`
- Send the push-to-start token to the relay at registration time (extend existing `/v1/device/register` or new field)
- This token is app-wide (not per-activity), so it lives alongside the device push token

### 2b. Extend relay for push-to-start

**Package**: `apn-relay`

- Add `push_to_start_token` column to `device_registration` table (nullable)
- Extend `/v1/device/register` to accept `pushToStartToken` field
- New logic in `/v1/event`: if `eventType` is the first event for a session and no `activity_registration` exists yet, send a push-to-start payload:
  ```json
  {
    "aps": {
      "timestamp": 1712345678,
      "event": "start",
      "content-state": {
        "status": "working",
        "sessionTitle": "Fix auth bug",
        "lastMessage": "Starting...",
        "retryInfo": null
      },
      "attributes-type": "SessionActivityAttributes",
      "attributes": {
        "sessionId": "abc123"
      },
      "alert": {
        "title": "Session Started",
        "body": "OpenCode is working on: Fix auth bug"
      }
    }
  }
  ```

### 2c. Server-side: emit session start events

**File**: `packages/opencode/src/server/push-relay.ts`

- Add a `"start"` event type
- Map `session.status` with `type: "busy"` (first time for a session) to `{ type: "start", sessionID }`
- Include session metadata (title, directory) in the payload so the relay can populate the `attributes` field for push-to-start

---

## Phase 3: Polish and Edge Cases

- **Deep linking**: When user taps the Live Activity, open the app and navigate to that session (`mobilevoice://session/{id}`)
- **Multiple activities**: Handle the case where the user starts multiple sessions from different servers. iOS supports multiple concurrent Live Activities.
- **Activity expiry**: iOS ends Live Activities after 8 hours. Handle the timeout gracefully (end with a "timed out" status).
- **Token rotation**: Activity push tokens can rotate. The `addPushTokenListener` handles this -- forward new tokens to the relay.
- **Cleanup**: When the relay receives an APNs error like `InvalidToken` for an activity token, delete the `activity_registration` row.
- **Stale activities**: On app foreground, check `SessionActivity.getInstances()` to clean up any orphaned activities.

---

## Changes Per Package Summary

| Package          | Files Changed                                                      | Files Added                                                          |
| ---------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------- |
| **mobile-voice** | `app.json`, `package.json`, `use-monitoring.ts`, `relay-client.ts` | `src/widgets/session-activity.tsx`, `src/hooks/use-live-activity.ts` |
| **apn-relay**    | `src/index.ts`, `src/apns.ts`, `src/schema.sql.ts`                 | (none)                                                               |
| **opencode**     | `src/server/push-relay.ts`                                         | (none)                                                               |

## Build Requirements

- New EAS dev build required after Phase 1a (native widget extension target)
- Relay deployment after Phase 1f
- OpenCode server rebuild after Phase 1g

## Key Technical References

- `expo-widgets` docs: https://docs.expo.dev/versions/latest/sdk/widgets/
- `expo-widgets` alpha blog post: https://expo.dev/blog/home-screen-widgets-and-live-activities-in-expo
- Apple ActivityKit push notifications: https://developer.apple.com/documentation/activitykit/starting-and-updating-live-activities-with-activitykit-push-notifications
- Existing APN relay: `packages/apn-relay/src/`
- Existing push-relay (server-side): `packages/opencode/src/server/push-relay.ts`
- Existing monitoring hook: `packages/mobile-voice/src/hooks/use-monitoring.ts`
- Existing relay client: `packages/mobile-voice/src/lib/relay-client.ts`

## Limitations / Risks

- **expo-widgets is alpha** (March 2026) -- APIs may break
- **Images not yet supported** in `@expo/ui` widget components (on Expo's roadmap)
- **Live Activities have an 8-hour max duration** enforced by iOS
- **APNs budget**: iOS throttles frequent updates; keep progress pushes to ~1 per 10-15 seconds
- **NSSupportsLiveActivitiesFrequentUpdates** needed in Info.plist for higher update frequency
- **Dev builds required** -- adding the widget extension is a native change, OTA won't cover it
