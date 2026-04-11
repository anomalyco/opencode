# mobile-voice Agent Guide

This file defines package-specific guidance for agents working in `packages/mobile-voice`.

## Scope And Precedence

- Follow root `AGENTS.md` first.
- This file overrides root guidance for this package when rules conflict.
- If additional local guides are added later, treat the closest guide as highest priority.

## Project Overview

- Expo + React Native app for voice dictation and OpenCode session monitoring.
- Uses native/device-heavy modules such as `whisper.rn`, `react-native-audio-api`, `expo-notifications`, and `expo-camera`.
- Development builds are required for native module changes.

## Commands

Run all commands from `packages/mobile-voice`.

- Install deps: `bun install`
- Start Metro: `bun run start`
- Start dev client server (recommended): `bunx expo start --dev-client --clear --host lan`
- iOS run: `bun run ios`
- Android run: `bun run android`
- Lint: `bun run lint`
- Typecheck: `bun run typecheck`
- Expo doctor: `bunx expo-doctor`
- Dependency compatibility check: `bunx expo install --check`
- Export bundle smoke test: `bunx expo export --platform ios --clear`

## Build / Verification Expectations

- For JS-only changes: run `bun run lint` and verify app behavior via dev client.
- For TS-heavy refactors: run `bun run typecheck` in addition to lint.
- For native dependency/config/plugin changes: rebuild dev client via EAS before validation.
- If notifications, camera, microphone, or audio-session behavior changes, verify on a physical iOS device.
- Do not claim a fix unless you validated in Metro logs and app runtime behavior.

## Single-Test Guidance

- This package currently has no dedicated unit test script.
- Use targeted validation commands instead:
  - `bun run lint`
  - `bun run typecheck`
  - `bunx expo export --platform ios --clear`
  - manual runtime test in dev client

## Architecture Priorities

- Keep screens focused on composition and orchestration. Once a screen owns multiple workflows, extract hooks/components before adding more local state.
- Prefer extracting pure helpers and config objects before introducing new stores or abstractions.
- Treat `src/app/index.tsx` as a composition root, not as the permanent home for onboarding, dictation, monitoring, pairing, persistence, and all UI details.
- Avoid mirrored `state + ref` pairs unless they are needed for imperative native APIs, race cancellation, or subscription callbacks.

## Code Style And Patterns

### Formatting / Structure

- Preserve existing style (`semi: false`, concise JSX, stable import grouping).
- Keep UI changes localized and behavior-preserving; avoid unrelated formatting churn.
- Prefer feature-adjacent hooks/components over growing a single screen file.

### React State / Effects

- Effects are for subscriptions, timers, persistence, network I/O, and native bridge setup/cleanup.
- Do not add `useEffect` just to derive render data from props or state. Derive during render instead.
- Prefer one source of truth. If a value can be computed from existing state, do not store it separately.
- Use `useMemo` only when computation is expensive or stable identity actually matters.
- Use `useCallback` only when stable function identity matters for dependencies, cleanup, or memoized children.
- When UI branches are driven by a small finite state, prefer config tables/objects over long nested ternaries.

### Types

- Avoid `any`; prefer local type aliases for component state and network payloads.
- Keep exported/shared boundaries typed explicitly.
- Parse persisted and network payloads as `unknown` first, then validate before use.
- Use discriminated unions for UI modes/status where practical.

### Naming

- Prefer short, readable names consistent with nearby code.
- Keep naming aligned with existing app state keys (`monitorStatus`, `activeSessionId`, etc.).

### Error Handling / Logging

- Fail gracefully in UI (alerts, disabled actions, fallback text).
- Avoid bare `catch {}` or `.catch(() => {})` for meaningful work. If failure is intentionally best-effort, leave a short comment or use a helper that makes that explicit.
- Log actionable diagnostics for runtime workflows such as server health checks, relay registration, and notification token lifecycle.
- Never log secrets or full APNs tokens.
- Keep hot-path logging behind `__DEV__` when possible.

### Network / Relay Integration

- Normalize and validate URLs before storing server configs.
- Use `AbortController` or request IDs for overlapping requests, streams, and polling.
- Keep relay registration idempotent.
- Guard duplicate scan/add flows to avoid repeated server entries.

### Notifications / APNs

- This package currently assumes APNs relay registration uses the `production` environment only. Do not add environment switching unless explicitly requested.
- On registration changes, ensure old token unregister flow remains intact.
- Treat permission failures as non-fatal and degrade to foreground monitoring when needed.

### Performance / RN

- Validate performance-sensitive changes in a dev client or release build, not only Metro dev mode.
- During recording and monitoring flows, keep JS-thread work light.
- Prefer Reanimated/native-thread-friendly animations for motion.
- For small menus a `ScrollView` is fine; if a list grows beyond a small bounded menu, move to `FlatList` or `FlashList`.

## Lint / Quality Bar

- Keep hooks lint warnings clean before finishing.
- Treat `any`, `no-console`, complexity, and max-lines warnings as refactor prompts, not noise to suppress.
- Do not disable React Hooks lint rules inline unless there is a documented native-interop reason.
- When introducing new persistence or network payloads, add or reuse a parser instead of scattering casts.

## Native-Module Safety

- If adding a native module, ensure it is in `package.json` with an SDK-compatible version.
- Rebuild the dev client after native module additions or changes.
- For optional native capability usage, prefer runtime fallback paths instead of hard crashes.

## Expo Native Config (EAS)

- Treat `packages/mobile-voice/app.json` as the source of truth for iOS native metadata in EAS cloud builds.
- Do not rely on manual edits in `ios/mobilevoice/Info.plist`, entitlements files, or `PrivacyInfo.xcprivacy`; for this package they are generated outputs.
- Keep generated native folders untracked in git (`/ios`, `/android`) to avoid mixed CNG/bare behavior during EAS builds.
- Put App Store compliance and permission metadata in app config using these fields:
  - `expo.ios.infoPlist` for Info.plist keys (usage strings, ATS, Bonjour, and related keys).
  - `expo.ios.config.usesNonExemptEncryption` for export-compliance encryption declaration.
  - `expo.ios.entitlements` for iOS entitlements.
  - `expo.ios.privacyManifests` for Apple privacy manifest declarations.
- Keep `app.json` entries explicit and review-friendly:
  - Permission descriptions should be complete, product-specific sentences.
  - Compliance keys should be set intentionally rather than relying on implicit defaults.
  - Preserve existing JSON style in this package (concise arrays and stable key grouping).
- After native config changes, verify resolved config with `bunx expo config --type prebuild --json` and check the resulting `ios` fields.

Example shape:

```json
{
  "expo": {
    "ios": {
      "infoPlist": {
        "NSCameraUsageDescription": "...",
        "NSMicrophoneUsageDescription": "..."
      },
      "config": {
        "usesNonExemptEncryption": false
      },
      "entitlements": {
        "com.apple.developer.kernel.extended-virtual-addressing": true
      },
      "privacyManifests": {
        "NSPrivacyAccessedAPITypes": []
      }
    }
  }
}
```

## Common Pitfalls

- Black screen + "No script URL provided" often means a stale dev client binary.
- `expo-doctor` duplicate module warnings may appear in Bun workspaces; prioritize runtime verification.
- `expo lint` may auto-generate `eslint.config.js`; do not commit accidental generated config unless requested.

## Before Finishing

- Run `bun run lint`.
- If behavior could break startup, run `bunx expo export --platform ios --clear`.
- Confirm no accidental config side effects were introduced.
- Summarize what was verified on-device vs only in tooling.


- Dev build (internal/dev client):
  - bunx eas build --profile development --platform ios
- Production build + auto-submit:
  - bunx eas build --profile production --platform ios --auto-submit
