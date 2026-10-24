# Web Push notifications

OpenCode can notify a paired phone or desktop browser through Web Push while the app is
closed or suspended. The OpenCode server encrypts each notification and sends it directly
to the browser vendor's push service. There is no OpenCode-hosted notification relay or
paid infrastructure.

## Requirements

- The OpenCode server must stay awake and online. The phone, not the server, may sleep.
- Push requires a secure context: HTTPS, or `http://localhost` on the same machine.
- iOS/iPadOS 16.4 or later, and the app must be installed on the Home Screen. Safari tabs
  cannot receive Web Push.
- Android Chrome, Edge, and other Chromium browsers work from the installed PWA or a normal
  tab once notification permission is granted.
- Outbound HTTPS access to the browser push services (`fcm.googleapis.com`,
  `web.push.apple.com`, `*.push.services.mozilla.com`, `*.notify.windows.com`).

Remote pairing through `opencode pair --remote` provides the HTTPS origin. If the web app and
the server have different origins (for example `beta.opencode.ai` connecting to a tunnel),
the app origin must already be allowed by the server's CORS setting. OpenCode's own domains
are allowed by default; add another origin with `opencode service set cors <origin>`. The OpenTunnel
hostname is persisted with the OpenTunnel identity, so the origin stays stable across
server restarts while remote access remains enabled. Disabling and re-enabling remote
access creates a new route; register again from the new origin.

## Enable

1. Start the server and pair the device (`opencode pair --remote`, then open the link).
2. On iPhone or iPad, add the web app to the Home Screen and open it from that icon.
3. Open **Settings → Notifications**.
4. Choose the server, press **Enable push**, and allow notifications.
   Chrome and Edge may also ask when the first in-app notification is shown. iOS never
   requests permission from page code; on iPhone and iPad the **Enable push** button is
   the prompt, and it only works after the Home Screen installation.
5. Use the Agent, Permissions, Questions, and Errors switches to choose which events send
   a push. The same switches control in-app alerts; sounds remain a separate setting.

Each browser installation keeps its own subscription. A user can enable several phones or
browsers and disable any one of them without affecting the others.

## Manual verification

1. Enable push on the device and confirm the settings row says push is enabled.
2. Close every OpenCode browser tab or app window on that device.
3. Start a session from another client and let it finish, or ask the agent to request
   permission or ask a question.
4. Confirm the notification arrives. Tapping it should open the matching server and
   session.
5. Disable push and repeat; no notification should arrive.
6. On iOS, repeat after rebooting the phone to confirm the Home Screen PWA remains
   registered.

Automated tests cover subscription lifecycle, authorization, payload encryption, the
service worker, and a browser-level push injection. They do not prove live APNs or FCM
delivery on a physical device; verify that manually on each target.

## Security and privacy

- Registration and removal use the server's existing password or paired session token.
  Push does not add a second account system.
- The server accepts subscriptions only for supported HTTPS push-service hosts, rejects
  redirects, and never fetches arbitrary subscriber URLs. This prevents the endpoint from
  becoming an SSRF primitive.
- Subscription click targets must match the registering page's origin and the app's
  `/server/<key>/session/` route.
- Payloads contain a localized event title, the session route, a session tag, and the
  event kind. They deliberately omit prompts, source code, session titles, errors, and
  tool output. Session IDs are not secrets, but the route reveals that a session exists.
- Payloads are encrypted end-to-end for the browser subscription (RFC 8291,
  `aes128gcm`). The push service cannot read them. Lock-screen previews show only the
  event title.
- VAPID private keys stay in the local database. The browser receives only the public key.
- Changing the server password revokes every stored push subscription on the next server
  start, matching session revocation.
- Subscriptions are removed when a push service returns HTTP 404 or 410, and expire after
  60 days without a refresh.

## Limits

- Up to 100 subscriptions per server.
- A bounded 128-event in-memory queue; when it is full, new notifications are dropped
  rather than slowing sessions.
- Four concurrent deliveries per event, a 10-second request deadline, a one-hour push TTL,
  and a 4 KB encrypted payload budget.
- Failed deliveries are not retried, and unsent notifications do not survive a server
  restart. Session results remain in the normal session history.
- A permission notification is delayed by one second so an immediate auto-approval or
  in-app reply does not buzz the device. The session tag replaces an older notification
  for the same session instead of stacking them.
- Notifications are best-effort. OS Focus modes, battery optimization, and browser push
  service outages can suppress or delay delivery.

## Key rotation

Deleting the `web-push:v1:key` row from the local key-value table and restarting the server
rotates the VAPID key. Every browser subscription then becomes invalid; devices must press
**Disable push** and **Enable push** again. There is no online rotation endpoint because
rotation requires every device to re-register.
