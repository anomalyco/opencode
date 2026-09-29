# Invariant: `event-envelope-sanitization` - Event Envelope Sanitization

> Clauses: 3 | Unwanted: 3 | Witnesses: app-dock-security.test.ts:603-616

## Clauses
- Renderer events omit storageKey *(measured: app-dock-security.test.ts:603-616)*
- Renderer events omit user data path (temp directory) *(measured: app-dock-security.test.ts:603-616)*
- Navigation error envelopes omit storageKey and temp path *(measured: app-dock-security.test.ts:603-616)*

## Unwanted
- Renderer events expose storageKey *(measured: app-dock-security.test.ts:603-616)*
- Renderer events expose user data path *(measured: app-dock-security.test.ts:603-616)*
- Navigation error envelopes expose storage internals *(measured: app-dock-security.test.ts:603-616)*

