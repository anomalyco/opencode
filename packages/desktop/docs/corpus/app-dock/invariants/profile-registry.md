# Invariant: `profile-registry` - Profile Registry

> Clauses: 7 | Unwanted: 7 | Witnesses: app-dock-profile-registry.test.ts

## Clauses
- Profile ID must match ^[a-z0-9][a-z0-9-]{0,31}$ *(measured: app-dock-profile-registry.test.ts)*
- Manifest validation rejects invalid profiles, tabs, bookmarks, history *(measured: app-dock-profile-registry.test.ts)*
- Registry load fails closed on corrupt data *(measured: app-dock-profile-registry.test.ts)*
- ensureActive creates new profile with UUID storageKey *(measured: app-dock-profile-registry.test.ts)*
- markDeleting transitions active→deleting, returns storageKey *(measured: app-dock-profile-registry.test.ts)*
- markDeleted transitions deleting→deleted, rewrites manifest and removes tabs *(measured: app-dock-profile-registry.test.ts)*
- replaceManifest enforces revision match and active profile set consistency *(measured: app-dock-profile-registry.test.ts)*

## Unwanted
- Registry accepts profile ID outside pattern *(measured: app-dock-profile-registry.test.ts)*
- Registry accepts manifest exceeding internal limits *(measured: app-dock-profile-registry.test.ts)*
- Corrupt registry loads without error *(measured: app-dock-profile-registry.test.ts)*
- ensureActive creates profile without storageKey *(measured: app-dock-profile-registry.test.ts)*
- markDeleting on deleted profile succeeds *(measured: app-dock-profile-registry.test.ts)*
- markDeleted on non-deleting profile succeeds *(measured: app-dock-profile-registry.test.ts)*
- replaceManifest accepts revision mismatch *(measured: app-dock-profile-registry.test.ts)*

