# Invariant: `profile-isolation` - Profile Isolation and Deletion

> Clauses: 4 | Unwanted: 3 | Witnesses: app-dock-security.test.ts:632-685

## Clauses
- Profile delete cancels and removes in-progress downloads *(measured: app-dock-security.test.ts:632-685)*
- Profile delete tombstones the old profile partition *(measured: app-dock-security.test.ts:632-685)*
- Fresh profile after delete has empty localStorage *(measured: app-dock-security.test.ts:632-685)*
- Delete profile blocks further open on that profile ID *(measured: app-dock-security.test.ts:632-685)*

## Unwanted
- Profile delete leaves downloads running *(measured: app-dock-security.test.ts:632-685)*
- Profile delete does not tombstone partition *(measured: app-dock-security.test.ts:632-685)*
- Fresh profile inherits deleted profile storage *(measured: app-dock-security.test.ts:632-685)*

