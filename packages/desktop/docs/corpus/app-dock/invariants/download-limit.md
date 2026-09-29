# Invariant: `download-limit` - Download Limit

> Clauses: 3 | Unwanted: 3 | Witnesses: app-dock-security.test.ts:1097-1160

## Clauses
- Nine real same-profile slow downloads admit eight progressing *(measured: app-dock-security.test.ts:1097-1160)*
- Ninth download is cancelled safely with failure event *(measured: app-dock-security.test.ts:1097-1160)*
- Download events expose no filesystem path *(measured: app-dock-security.test.ts:1097-1160)*

## Unwanted
- More than eight progressing downloads admitted *(measured: app-dock-security.test.ts:1097-1160)*
- Ninth download is not cancelled *(measured: app-dock-security.test.ts:1097-1160)*
- Download events expose filesystem path *(measured: app-dock-security.test.ts:1097-1160)*

