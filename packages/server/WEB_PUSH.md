# PWA notifications

Web Push delivers response-ready and session-error notifications without keeping an OpenCode browser tab open. The OpenCode server sends an encrypted payload to the browser's push service, which wakes a service worker on the device. No Electron wrapper or separate OpenCode notification relay is required.

## Enable

1. Open the web app over HTTPS, or localhost for development, and connect to an updated OpenCode server.
2. On iPhone or iPad, add the app to the Home Screen and open that installed app. Web Push requires iOS/iPadOS 16.4 or newer.
3. Open **Settings → Notifications**, select the server, and choose **Enable push**. Grant the browser's notification permission when prompted.
4. Keep the OpenCode server running and connected to the internet. The PWA can close; the machine running the server cannot sleep or shut down and still send new notifications.

The response-ready and error switches determine which events are sent. Each browser installation subscribes separately to each server. Enabling push requests permission directly from the button press; it never creates a push subscription just because an agent finishes.

Background notifications can also appear while the app is open. Browser push subscriptions require visible notifications; this is not a silent background polling mechanism. The app avoids also emitting its ordinary local notification for the same subscribed server. Desktop notifications are unchanged.

## Security and privacy

- Subscription registration and removal use the server's existing API authentication. This follows the server's existing single-owner trust boundary, not a new multi-user account system.
- Changing the server password, or enabling or disabling server authentication, revokes existing push registrations on the next server startup. Register notifications again using the current credentials. The server's VAPID public key remains unchanged.
- VAPID private keys remain on the server. The browser receives only the public key. The push worker does not retain server credentials or fetch authenticated session data.
- Notification payloads contain the session title and a link to the session, encrypted for the subscription. They do not contain the response text, prompts, or tool output. Device notification previews may expose the title on a lock screen.
- Outbound delivery is restricted to supported browser push-service HTTPS endpoints, not arbitrary subscriber-provided URLs. Notification clicks are restricted to OpenCode session routes on the app's own origin.

## Limits and verification

Delivery depends on the browser push service, device connectivity, OS notification settings, and Focus/Do Not Disturb. A successful server request means the push service accepted the message, not that the device displayed it. This is a notification channel, not a durable task-completion log.

- Up to 100 subscriptions are retained per server. Expired subscriptions are removed when the provider returns HTTP 404 or 410.
- Delivery uses a 128-event in-memory queue, four concurrent requests per event, a 10-second request deadline, and a one-hour push-service TTL. A full queue drops new notifications rather than slowing session execution.
- Failed deliveries are not retried, and unsent notifications do not survive a server restart. Session results remain available normally in OpenCode.
- Session titles are limited to 200 characters in notification bodies. Permission prompts and sounds still require an open app.

To check a real installation, enable notifications, start a session on that server, close all OpenCode tabs before the response completes, and confirm the notification arrives. Clicking it should open the matching server and session. Repeat with two configured servers, then disable notifications for one and confirm the other remains subscribed.

Automated service-worker tests do not establish Apple Push Notification service or Firebase delivery on a physical device. Test the closed-PWA flow on each supported target browser before treating its end-to-end delivery as verified.

The notification worker is separate from the app's existing offline-cache worker. Enabling push must not replace the app's caching or update lifecycle.
