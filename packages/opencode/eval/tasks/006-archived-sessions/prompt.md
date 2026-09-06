When a user archives a session, it should disappear from the home session list immediately. Currently, archived sessions remain visible in the home list until the page is refreshed or the index is remounted.

Fix this in `packages/app/src/context/global-sync/home-session-index.ts` by adding a `remove` method to the `createHomeSessionIndexCache` function that:
1. Maintains a `Set` of removed session IDs
2. Filters out removed sessions from the `sessions()` method
3. Updates the query data when the index is mounted

Also wire up the `remove` method in:
- `packages/app/src/pages/home/home-sessions-controller.tsx` — call `homeSessions().remove(session.id)` in the archive action
- `packages/app/src/pages/session/session-archive.ts` — call `serverSync().homeSessions.remove(sessionID)` after archiving

Write tests that verify:
- A session is removed from the loaded Home index when `remove` is called
- A session stays removed even when the index is not yet mounted


