# Invariant: `capacity-lru` - Capacity LRU Eviction

> Clauses: 4 | Unwanted: 3 | Witnesses: app-dock-security.test.ts:1053-1095

## Clauses
- 20 inactive views across two windows use global LRU *(measured: app-dock-security.test.ts:1053-1095)*
- Selecting A0 retains it while opening one more evicts older B0 *(measured: app-dock-security.test.ts:1053-1095)*
- Active views remain usable during eviction *(measured: app-dock-security.test.ts:1053-1095)*
- Recently selected tab remains usable after eviction *(measured: app-dock-security.test.ts:1053-1095)*

## Unwanted
- LRU eviction displaces an active view *(measured: app-dock-security.test.ts:1053-1095)*
- Recently selected tab becomes unusable after eviction *(measured: app-dock-security.test.ts:1053-1095)*
- Global LRU not honored across windows *(measured: app-dock-security.test.ts:1053-1095)*

