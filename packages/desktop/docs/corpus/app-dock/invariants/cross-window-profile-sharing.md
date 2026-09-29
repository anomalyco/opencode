# Invariant: `cross-window-profile-sharing` - Cross-Window Profile Sharing

> Clauses: 3 | Unwanted: 3 | Witnesses: app-dock-security.test.ts:775-802

## Clauses
- Two BrowserWindows opening the same profile create both views *(measured: app-dock-security.test.ts:775-802)*
- Profile delete from window A destroys views in both windows A and B *(measured: app-dock-security.test.ts:775-802)*
- Profile delete detaches views from both windows *(measured: app-dock-security.test.ts:775-802)*

## Unwanted
- Shared profile does not create both views *(measured: app-dock-security.test.ts:775-802)*
- Profile delete from A leaves B's view alive *(measured: app-dock-security.test.ts:775-802)*
- Profile delete leaves view attached in either window *(measured: app-dock-security.test.ts:775-802)*

