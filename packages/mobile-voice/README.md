# Mobile Voice

Expo app for voice dictation and OpenCode session monitoring.

## Current monitoring behavior

- Foreground: app reads OpenCode SSE (`GET /event`) and updates monitor status live.
- Background/terminated: app relies on APNs notifications sent by `apn-relay`.
- The app registers its native APNs device token with relay route `POST /v1/device/register`.

## App requirements

- Use a development build or production build (not Expo Go).
- `expo-notifications` plugin is enabled with `enableBackgroundRemoteNotifications: true`.
- Notification permission must be granted.

## Server entry fields in app

When adding a server, provide:

- OpenCode URL
- APN relay URL
- Relay shared secret

Default APN relay URL: `https://apn.dev.opencode.ai`

The app uses these values to:

- send prompts to OpenCode
- register/unregister APNs token with relay
- receive background push updates for monitored sessions

## Local dev

```bash
npx expo start
```

Use your machine LAN IP / reachable host values for OpenCode and relay when testing on a physical device.
