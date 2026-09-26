# OS-Aware Idle Curator with Two-Stage Fact-Check Gate

## The idea (novel: no major agent CLI ships this)

An idle watchdog that wakes stale sessions with a **fully analyzed curator
verdict** — never a bare ping. Three properties make it unique:

1. **OS presence gating, not just app idle.** The watchdog fuses two clocks:
   agent-loop idle (`session.status → idle`, tool hooks) and OS input idle
   (Mutter `GetIdletime` → KDE `GetSessionIdleTime` → X11 `xprintidle` →
   `unknown`). Result is an activity matrix —
   `AWAY / FORGOTTEN_TAB / BACKGROUND / PRESENT` — instead of a boolean.
   A user typing in the target tab (`PRESENT`) is never interrupted; a tab
   forgotten for an hour gets deep analysis even while the user works next
   door. No timers fire blind.
2. **Nothing reaches chat unverified.** Stage 1 spawns a fresh curator
   (different model family when available) that returns a parseable
   `[wake:VERDICT]` contract. Stage 2 spawns a separate fact-check agent
   that validates every claim against tool outputs, repo files, or at most
   3 web lookups, returning `[factcheck:PASS/FAIL]`. A verdict without PASS
   is marked `UNVERIFIED`, never injected as fact. Self-review is treated
   as a malfunction — the checker is always a separate session.
3. **Every module hot-toggleable, zero sudo.** `enabled / curator_enabled /
   factcheck_enabled / presence_enabled` are re-read from JSON every tick
   (no restart), mapping 1:1 to future GUI switches. The Linux presence
   probe is per-user userspace (one D-Bus call or a 15 KB `XScreenSaver`
   binary, ~3 ms per minute tick). Disabling telemetry means zero exec —
   not a stub call. Safe defaults: HIBERNATE after N wakes, exponential
   backoff on ignored wakes, blind window so the woken agent's own
   verification tools never re-trigger the watchdog.

## Files

- `wake.js` — watchdog plugin (tick, backoff, eviction, stall-push on 3+
  consecutive tool errors, two-stage settle). Pure Node, fail-open: any
  exception is swallowed, observability is best-effort JSONL.
- `presence.sh` — portable idle probe, single-line JSON
  `{"os_idle_ms":N,"source":"...","session_type":"...","desktop":"..."}`,
  `-1` = unknown. Order: Mutter → ScreenSaver → `xprintidle` (X11 only).
- `xidle.c` — 13-line `XScreenSaverQueryInfo` fallback. Builds with
  `gcc -O2 -o xprintidle xidle.c -lX11 -lXext -lXss`, no packaging needed.
- `curator-agent.md` — curator soul: outside view, disagree-by-default,
  `CONTINUE / CORRECT / STOP / ABORT` + lifecycle vote, confidence bins.
- `factcheck.md` — validator soul: `PASS` only if every injected line is
  sourced; one unverified claim → `FAIL` with replacements.
- `wake.json.example` — all thresholds with validated ranges.

## Verified behavior (mock-client harness, real file, 2 s tick)

- Session with tool activity + 7 s quiet → exactly 1 wake. PASS.
- Session with zero tools → 0 wakes (by design: pure Q&A is invisible). PASS.
- Second fire inside cooldown → blocked. PASS.
- Live probe on X11: `185277 → 188327 ms` across 3 s sleep; `847 ms`
  right after user input. Counter tracks reality.

## Why upstream

Idle-time compute is currently wasted everywhere: either noisy reminders
or nothing. This turns idle into the highest-quality analysis window —
multilayer, sourced, and silent when the user is present. The per-module
toggles make it shippable as settings UI without architecture changes.
