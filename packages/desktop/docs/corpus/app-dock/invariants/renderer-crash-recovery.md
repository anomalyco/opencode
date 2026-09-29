# Invariant: `renderer-crash-recovery` - Renderer Crash Recovery

> Clauses: 4 | Unwanted: 4 | Witnesses: app-dock-security.test.ts:982-1051

## Clauses
- Real selected renderer crash emits tab-crashed with old identity and reason crashed/killed *(measured: app-dock-security.test.ts:982-1051)*
- IPC recovery creates same tabID/URL/profile with newer generation *(measured: app-dock-security.test.ts:982-1051)*
- Recovered selected tab is usable and preserves other tabs *(measured: app-dock-security.test.ts:982-1051)*
- Old crashed generation events are ignored after recovery *(measured: app-dock-security.test.ts:982-1051)*

## Unwanted
- Crash does not emit tab-crashed with old identity *(measured: app-dock-security.test.ts:982-1051)*
- Recovery does not create newer generation *(measured: app-dock-security.test.ts:982-1051)*
- Recovery does not preserve other tabs *(measured: app-dock-security.test.ts:982-1051)*
- Old generation events emitted after recovery *(measured: app-dock-security.test.ts:982-1051)*

