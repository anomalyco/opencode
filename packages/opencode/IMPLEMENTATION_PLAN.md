title: Rotation plan
description: Steps for email checks and account switching

---

## Define config

Add `experimental.codex.rotation` with `first` (default) and `round-robin` in `src/config/config.ts`. Keep it relaxed and obvious in config docs or inline descriptions.

---

## Validate email

Require a non-empty email in OAuth results and fail the login if missing in `src/cli/cmd/auth.ts` and `src/plugin/codex.ts`. Also guard `Auth.setCodexAccount` to reject empty emails and avoid overwriting accounts with `unknown` values.

---

## Handle limits

Persist `rateLimit` metadata until `resetAt` passes, and only clear on expiry in `src/auth/index.ts`. Make `auth list` tolerant of missing `resetAt` when rendering status in `src/cli/cmd/auth.ts`.

---

## Add round robin

Extend `Auth.getNextAvailableCodexAccount` with a mode argument and store the next index after selection. Use config in `src/plugin/codex.ts` to choose `first` or `round-robin` when retrying after a 429.

---

## Verify

Manually login two accounts and confirm both emails render in `auth list`. Trigger a 429 and confirm automatic switch plus correct strategy by toggling config.
