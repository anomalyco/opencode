# Mobile Android PWA Fork Plan

## Purpose

This fork exists to make `opencode web` reliable as a personal mobile client behind a public HTTPS domain.

Primary target environment:

- OpenCode server runs in WSL
- public access goes through Caddy on Windows
- mobile client is Chrome on Android, often installed as a PWA/home-screen app
- the same fork should still work well on desktop web

This plan is intentionally fork-first. It does not try to stay minimal for upstream acceptance. It optimizes for a polished personal setup.

## Core problems to solve

### Problem 1: notifications are page-bound today

Current web notifications are created directly in the page with `new Notification(...)`.

Relevant code:

- `packages/app/src/entry.tsx`
- `packages/app/src/context/notification.tsx`

Implication:

- if the page is suspended, frozen, background-throttled, or disconnected, the notification logic never runs
- Android PWA behavior is therefore unreliable even when browser permissions are granted

### Problem 2: session state can go stale after background/sleep/resume

Current live state depends on the page-owned SSE connection and client-side resync behavior.

Relevant code:

- `packages/app/src/context/global-sdk.tsx`
- `packages/app/src/context/global-sync.tsx`
- `packages/app/src/context/global-sync/bootstrap.ts`
- `packages/app/src/context/global-sync/event-reducer.ts`
- `packages/opencode/src/server/routes/instance/event.ts`

Implication:

- when Android backgrounds the PWA, JS and network activity may pause
- on resume, the UI can temporarily or persistently show stale state
- the current reconnect path is not strong enough for a mobile-first workflow

## Product goals

### Must-have goals

1. Receive a real push notification on Android when a session turn completes.
2. Receive a real push notification on Android when a session errors.
3. Tap on a notification and open the exact target session.
4. Resume from background without manually killing and reopening the app.
5. Force the active screen back to truth after sleep/resume/network changes.
6. Keep desktop web behavior good and predictable.

### Nice-to-have goals

1. Per-device push settings.
2. Separate toggles for completion vs error notifications.
3. Test notification button.
4. Notification deduplication.
5. Optional suppression of push while the same session is actively visible on desktop.

### Explicit non-goals

1. Full offline-first editing.
2. Aggressive API caching in the service worker.
3. Building a generic consumer push platform for all users.
4. Immediate upstreamability.

## High-level design

The fix should split the problem into two independent systems:

1. **Background notification delivery**
   - owned by service worker + Web Push
   - works when the page is not running

2. **Foreground truth recovery**
   - owned by page lifecycle handlers + stronger resync logic
   - works when the user returns to the app

This is the key architectural change.

The current design expects the page to both detect completion and show the notification. The fork should move completion/error notification delivery to the server side.

## Target user flow

### Completion flow

1. User sends a prompt from mobile.
2. User backgrounds the PWA.
3. Server finishes the turn and emits `session.idle`.
4. Server-side push dispatcher sends a Web Push message.
5. Android receives the push through the service worker.
6. User taps the notification.
7. App opens directly into the target session.
8. On open, the page performs a forced resync and renders fresh state.

### Resume flow without a notification tap

1. User backgrounds the PWA while a turn is running.
2. User later returns to the PWA manually.
3. `visibilitychange`, `pageshow`, `focus`, and `online` handlers fire.
4. Client triggers a resume recovery pipeline.
5. Global state is refreshed.
6. Active project/session state is force-synced.
7. UI becomes truthful without manual restart.

## Proposed implementation areas

## A. Resume and reconnect hardening

This should be implemented first, before push.

### Current weak points

1. Reconnect behavior is concentrated in `packages/app/src/context/global-sdk.tsx`.
2. `server.connected` currently results in a refresh path that is not strong enough for mobile resume.
3. Global bootstrap is not treated as a full resume-recovery operation.

### Changes

1. Increase client heartbeat timeout.
   - Current timeout is `15_000` in `packages/app/src/context/global-sdk.tsx`.
   - Raise to `30_000` or `45_000`.
   - Keep enough margin over server heartbeat cadence.

2. Stop using over-aggressive reconnect on visibility return.
   - Do not immediately tear down the stream on every resume.
   - Allow a brief grace window for the existing stream to prove liveness.

3. Add a dedicated `resumeRecovery()` path.
   - Trigger from:
     - `visibilitychange` when visible
     - `pageshow`
     - `focus`
     - `online`
   - This path should be debounced/coalesced.

4. Make resume recovery stronger than current refresh.
   - Force global bootstrap refresh.
   - Force directory/project refresh.
   - Force active session refresh.
   - Force active message list refresh.
   - Force pending permission/question/todo refresh for active session.

5. Strengthen `server.connected` handling.
   - In `packages/app/src/context/global-sync/event-reducer.ts`, treat `server.connected` as a full-state recovery trigger, not only a lightweight refresh.

### Suggested implementation details

Add a recovery coordinator in the app layer that:

- tracks last recovery timestamp
- deduplicates overlapping triggers
- classifies recovery causes (`visibility`, `online`, `server-connected`, `notification-open`)
- exposes a single async `recover({ reason, force })`

This should live close to:

- `packages/app/src/context/global-sync.tsx`
- or a new helper under `packages/app/src/context/global-sync/`

### Acceptance criteria

1. Background for 1-5 minutes, return to app, active session self-heals.
2. No forced app kill needed.
3. No obvious duplicate reload storms.
4. Desktop behavior remains smooth.

## B. Service worker and Web Push

This is the critical piece for reliable Android notifications.

### Design principle

Do not rely on in-page `Notification` for mobile background delivery.

Keep existing in-page notifications as an optional foreground/desktop path, but add real push as the main path for Android.

### Files to add or change

Likely areas:

- `packages/app/src/entry.tsx`
- `packages/app/public/site.webmanifest`
- new `packages/app/public/sw.js` or generated worker source
- optional helper files under `packages/app/src/utils/` or `packages/app/src/context/`

### Service worker responsibilities

1. Handle `push` events.
2. Show notifications with title/body/icon/tag/data.
3. Handle `notificationclick`.
4. Open or focus an existing client window.
5. Route to the exact session deep link.
6. Optionally notify open clients via `postMessage` after click/open.

### Deep link payload

Every push payload should contain enough information to open the exact session:

- `directory`
- `sessionID`
- `href`
- `kind` (`turn-complete` or `error`)
- optional `title`

Preferred link format:

- `/<base64-directory>/session/<sessionID>`

This should match current route conventions already used by the app.

### Manifest updates

`site.webmanifest` should be verified/updated for:

- stable app name
- icons for Android install surface
- `display: standalone`
- `start_url`
- `scope`
- theme/background color consistency

### Acceptance criteria

1. Android receives notifications while app is backgrounded.
2. Android receives notifications while app is not open in foreground.
3. Notification tap reopens the PWA to the right session.

## C. Push subscription management

The app needs a real subscription lifecycle, not just one-off registration.

### Client features

1. Register service worker.
2. Fetch public VAPID key from server.
3. Subscribe with `PushManager.subscribe()`.
4. Send subscription to server.
5. Display current push status in settings.
6. Allow unsubscribe.
7. Allow test notification.

### Server API surface

Recommend a dedicated push API, probably under the global server layer rather than per-session routes.

Suggested endpoints:

1. `GET /push/public-key`
   - returns VAPID public key

2. `GET /push/subscriptions`
   - lists subscriptions for the current server/account context

3. `POST /push/subscriptions`
   - upserts a subscription

4. `DELETE /push/subscriptions/:id`
   - removes one subscription

5. `POST /push/test`
   - sends a test push to the current device or selected subscription

### Suggested route placement

Add a new route module under:

- `packages/opencode/src/server/routes/global.ts`
- or a new dedicated route file under `packages/opencode/src/server/routes/`

Do not couple push subscription registration to session routes.

## D. Server-side notification dispatcher

This is the server-side engine that turns internal events into pushes.

### Sources of truth for events

Relevant event definitions already exist:

- `packages/opencode/src/session/status.ts`
  - `session.idle`
  - `session.status`

- `packages/opencode/src/session/session.ts`
  - `session.error`

### Recommended trigger strategy

Send pushes for:

1. `session.idle`
   - only for root sessions by default
   - ignore child sessions unless explicitly enabled later

2. `session.error`
   - send always for root sessions
   - optional future config for child sessions

### Dispatcher placement

Create a new server-side module group, for example:

- `packages/opencode/src/push/index.ts`
- `packages/opencode/src/push/schema.ts`
- `packages/opencode/src/push/store.ts`
- `packages/opencode/src/push/service.ts`
- `packages/opencode/src/push/dispatcher.ts`

### Dispatcher behavior

1. Subscribe to bus/global events.
2. Resolve session metadata.
3. Build a notification payload.
4. Look up matching subscriptions.
5. Send Web Push through a library such as `web-push`.
6. Detect dead subscriptions and mark/remove them.
7. Rate-limit or deduplicate where needed.

### Payload recommendations

#### Turn complete

- title: `Response ready`
- body: session title if available, else session ID
- tag: `session:<sessionID>:turn-complete`
- data:
  - `href`
  - `sessionID`
  - `directory`
  - `kind`

#### Error

- title: `Session error`
- body: session title or error summary
- tag: `session:<sessionID>:error`
- `requireInteraction` can remain false for mobile

## E. Data model

### Required table

Create a `push_subscription` table.

Suggested fields:

- `id` text primary key
- `endpoint` text unique not null
- `p256dh` text not null
- `auth` text not null
- `server_origin` text not null
- `device_label` text nullable
- `user_agent` text nullable
- `created_at` integer not null
- `updated_at` integer not null
- `last_success_at` integer nullable
- `last_failure_at` integer nullable
- `failure_count` integer not null default 0
- `enabled` integer/bool not null default true
- `notify_turn_complete` integer/bool not null default true
- `notify_error` integer/bool not null default true

### Optional table

If later needed for observability, add `push_delivery_log`, but this is optional for phase 1.

### Why keep it simple

This fork is personal. Subscription storage should be durable and explicit, but not over-modeled.

## F. Settings UX

The app needs a small but real settings surface for push.

### Additions to settings

1. Push support status:
   - service worker available or not
   - notification permission state
   - push subscription active or not

2. Toggles:
   - turn complete notifications
   - error notifications

3. Actions:
   - enable push on this device
   - disable push on this device
   - send test notification

4. Device label:
   - optional editable label like `Pixel 8` or `Android Chrome`

### UX rule

The settings screen should explain why push is better than page-bound notifications on mobile.

## G. Keep desktop notifications sane

Do not remove current web notification behavior immediately.

Recommended policy:

1. Keep page notifications for desktop web when page is backgrounded.
2. Add push for devices that subscribed.
3. Later optionally suppress duplicate notifications if the same user has both desktop page notifications and push enabled.

For first implementation, duplicates are acceptable if they are rare and understandable.

## H. Caddy and reverse proxy requirements

This fork alone is not enough. Reverse proxy behavior must support SSE and service workers correctly.

### SSE requirements

For the SSE endpoint:

- disable buffering
- do not cache
- avoid compression on the event stream
- preserve long-lived connection behavior

For Caddy, the main point is to use `reverse_proxy` settings that flush immediately.

### Service worker requirements

1. `sw.js` must be served from app root scope.
2. Service worker file should not be aggressively cached during development.
3. Manifest and icons should be served correctly over HTTPS.

### Domain requirements

Push on Android requires:

- public HTTPS origin
- valid certificate
- stable origin matching the installed PWA

`opencode.tim-ur.ru` is the correct place to standardize on.

## I. Auth considerations

### Short-term plan

Keep current auth model if it does not block:

- service worker registration
- push subscription API calls
- notification click navigation

### Likely future issue

If the app currently relies on proxy-level basic auth in a way that creates browser credential loops on mobile, push/open flows may feel brittle.

If that happens, phase 2 should introduce a better app-owned auth/session model.

### Important constraint

Do not mix auth migration into phase 1 unless it is a hard blocker. Push + resume recovery should land first.

## J. Suggested implementation phases

## Phase 0: fork hygiene

Goal:

- establish fork-specific working notes and conventions

Tasks:

1. Add this plan document.
2. Verify fork default branch is `dev`.
3. Decide branch naming for personal work.

Suggested branch naming:

- `timur/mobile-resume-recovery`
- `timur/mobile-web-push`
- `timur/mobile-settings-polish`

## Phase 1: resume recovery hardening

Goal:

- make the web app self-heal after background/sleep/resume even before push exists

Tasks:

1. Adjust heartbeat timing in `global-sdk.tsx`.
2. Add a proper recovery coordinator.
3. Trigger forced global + active-session resync on lifecycle return.
4. Improve `server.connected` handling.

Deliverable:

- mobile app recovers from background without manual restart most of the time

## Phase 2: service worker skeleton

Goal:

- service worker registration and notification click routing

Tasks:

1. Add `sw.js`.
2. Register it in the client.
3. Add a local test path for service-worker notifications.
4. Ensure click routing focuses existing client or opens a new one.

Deliverable:

- installable PWA with a working service worker lifecycle

## Phase 3: subscription API and storage

Goal:

- persist push subscriptions and manage them from settings

Tasks:

1. Add storage schema.
2. Add push routes.
3. Add client subscription logic.
4. Add settings UI.

Deliverable:

- one device can subscribe and receive a test push

## Phase 4: server event -> push dispatch

Goal:

- deliver real completion and error pushes

Tasks:

1. Add dispatcher service.
2. Subscribe to `session.idle` and `session.error`.
3. Resolve root-session only filtering.
4. Send push payloads.
5. Handle invalid subscriptions.

Deliverable:

- end-to-end push from real session completion/error

## Phase 5: polish and dedup

Goal:

- make the experience pleasant enough for daily use

Tasks:

1. Better notification text.
2. Better settings copy.
3. Dedup logic.
4. Better resume telemetry/logging.
5. Optional device labels.

Deliverable:

- stable personal daily-driver mobile client

## K. Testing strategy

### Manual test matrix

#### Android

1. Open in Chrome tab.
2. Install to home screen.
3. Run a session and background the app.
4. Confirm turn-complete push arrives.
5. Confirm error push arrives.
6. Tap push and verify correct deep link.
7. Return without tapping push and verify self-heal.

#### Desktop web

1. Keep tab open in background.
2. Verify no obvious regressions in SSE behavior.
3. Verify current notification path still works.

#### Network transitions

1. Wi-Fi off -> on.
2. Mobile data switch.
3. Domain still reachable after reconnect.

### Automated testing

At minimum add tests for:

1. Resume recovery dedup/coalescing logic.
2. Notification click deep-link handling.
3. Push payload building.
4. Subscription store upsert/remove behavior.
5. Root-session filtering.

Potential locations:

- `packages/app/src/...*.test.ts`
- `packages/opencode/src/push/...*.test.ts`

Playwright coverage can be added later, but do not block the first implementation on full mobile automation.

## L. Risks and tradeoffs

### Risk 1: service worker complexity

Mitigation:

- keep worker scope narrow
- do not attempt offline API caching
- use it primarily for push and click routing

### Risk 2: auth loops on mobile

Mitigation:

- keep auth unchanged at first
- explicitly test notification click reopen path early

### Risk 3: duplicate notifications

Mitigation:

- accept temporary duplicates in early phase
- later add suppression/dedup by `tag` and client visibility heuristics

### Risk 4: stale state despite push

Mitigation:

- push does not replace recovery
- always keep forced resync on resume/open

## M. Recommended implementation order for the next coding session

The next session should not start with push. It should start with resume recovery hardening.

### Session 1

Focus:

- `packages/app/src/context/global-sdk.tsx`
- `packages/app/src/context/global-sync.tsx`
- `packages/app/src/context/global-sync/event-reducer.ts`

Deliverable:

- stronger resume recovery with forced resync

### Session 2

Focus:

- service worker registration
- manifest cleanup
- notification click routing

Deliverable:

- service worker in place and testable

### Session 3

Focus:

- push subscription API + storage
- settings UI

Deliverable:

- device subscription and test push

### Session 4

Focus:

- event dispatcher for real pushes

Deliverable:

- real turn-complete and error pushes

## N. First concrete file-level attack plan

### Resume recovery

1. `packages/app/src/context/global-sdk.tsx`
   - raise timeout
   - improve reconnect heuristics
   - avoid over-eager abort on `visibilitychange`

2. `packages/app/src/context/global-sync.tsx`
   - add explicit recovery entrypoint
   - call full bootstrap refresh on resume

3. `packages/app/src/context/global-sync/event-reducer.ts`
   - upgrade `server.connected` behavior

4. `packages/app/src/context/sync.tsx`
   - ensure active session sync can be forced cleanly

### Push foundations

1. `packages/app/public/site.webmanifest`
2. `packages/app/public/sw.js`
3. `packages/app/src/entry.tsx`
4. `packages/app/src/context/settings.tsx`
5. settings UI files under `packages/app/src/...`

### Server push

1. new `packages/opencode/src/push/`
2. route wiring under `packages/opencode/src/server/routes/`
3. event subscription using existing bus/global event infrastructure

## O. Success definition for this fork

This fork is successful when all of the following are true:

1. Android push arrives while the PWA is backgrounded.
2. Error push arrives too.
3. Tapping the notification opens the correct session.
4. Returning to the app after sleep/background no longer requires manual kill/reopen.
5. The setup remains stable behind WSL + Caddy + public domain.

## P. Suggested prompt for the next session

Use this as the first prompt in the next coding session inside this repo:

```text
Read specs/mobile-android-pwa-fork-plan.md and implement Phase 1 only: resume recovery hardening for mobile web/PWA. Start by inspecting packages/app/src/context/global-sdk.tsx, packages/app/src/context/global-sync.tsx, packages/app/src/context/global-sync/event-reducer.ts, and any active-session sync paths. Make the smallest robust changes that add a real resume-recovery pipeline with forced resync and less aggressive SSE teardown on visibility return. Run the relevant package tests if available.
```
