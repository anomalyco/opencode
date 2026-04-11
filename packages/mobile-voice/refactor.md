# Mobile Voice Refactor Plan

## Goals

- Reduce the surface area of `src/app/index.tsx` without changing product behavior.
- Make device, network, and monitoring flows easier to reason about.
- Move toward React Native / Expo best practices for state, effects, and file structure.
- Use the new lint warnings as refactor prompts, not as permanent background noise.

## Current Pain Points

- `DictationScreen` currently owns onboarding, permissions, Whisper/model lifecycle, dictation, pairing, server/session sync, relay registration, notification handling, and most UI rendering.
- The screen mixes render-time derived state, imperative refs, polling, persistence, and native cleanup in one place.
- There are many nested conditionals and long derived blocks that are hard to scan.
- Best-effort async cleanup and silent catches make failures harder to understand.

## Target Shape

- `src/app/index.tsx`
  - compose hooks and presentational sections
  - keep only screen-level orchestration
- `src/features/onboarding/`
  - onboarding step config
  - onboarding UI component
- `src/features/dictation/`
  - `use-whisper-dictation`
  - transcript helpers
- `src/features/servers/`
  - server/session refresh and pairing helpers
  - persisted server state helpers
- `src/features/monitoring/`
  - foreground SSE monitoring
  - notification payload handling
  - relay registration helpers
- `src/lib/`
  - parser/validation helpers
  - logger helper for dev-only diagnostics

## Refactor Order

### Phase 1: Extract pure helpers first

- Move onboarding step text/style selection into a config object or array.
- Move server/session payload parsing into dedicated helpers.
- Keep existing behavior and props the same.

### Phase 2: Extract onboarding UI

- Create an `OnboardingFlow` component that receives explicit state and handlers.
- Keep onboarding persistence in the screen until the UI extraction is stable.

### Phase 3: Extract dictation logic

- Move Whisper loading, recording, bulk/realtime transcription, and waveform state into a `useWhisperDictation` hook.
- Expose a small interface: recording state, transcript, actions, and model status.

### Phase 4: Extract server/session management

- Move server restore/save, pairing, health refresh, and active server/session selection into a dedicated hook.
- Centralize server parsing and dedupe logic.

### Phase 5: Extract monitoring and notifications

- Move SSE monitoring, push payload handling, and relay registration into a `useMonitoring` hook.
- Keep side effects close to the feature that owns them.

### Phase 6: Lint burn-down

- Replace `any` with explicit parsed shapes.
- Reduce nested ternaries in favor of config tables.
- Replace ad hoc `console.log` calls with a logger helper or `__DEV__`-gated diagnostics.
- Audit bare `.catch(() => {})` and convert non-trivial cases to explicit best-effort helpers or real error handling.

## Guardrails During Refactor

- Keep one behavior-preserving slice per PR.
- Do not introduce more derived state in `useEffect`.
- Prefer explicit hook inputs/outputs over hidden cross-hook coupling.
- Only use refs for imperative APIs, subscriptions, and race control.
- Re-run lint after each slice.
- Validate app behavior in the dev client for microphone, notifications, pairing, and monitoring flows.

## Exit Criteria

- `src/app/index.tsx` is mostly screen composition and stays under roughly 800-1200 lines.
- Feature logic lives in focused hooks/components with clearer ownership.
- New payload parsing does not rely on `any`.
- Lint warnings trend down instead of growing.
