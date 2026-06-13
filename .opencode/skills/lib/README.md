# Shared skill helpers

One place for logic that more than one skill needs, so the opencode skill ecosystem avoids the
audit's "7 near-identical wrappers" (DRY) problem. Import from here instead of copying.

```ts
import { assertLocalSource, resolveInside, fileCache, memoize } from "../../lib/index"
```

## Modules

- **`safe.ts`** — `assertLocalSource(value)` rejects remote data sources (SSRF + "remote-as-a-data-source"
  risk); `resolveInside(baseDir, candidate)` keeps written paths inside `baseDir` (anti path-traversal).
  Both throw `SkillSafetyError`.
- **`cache.ts`** — `fileCache(dir)` is a content-addressed file cache; `memoize(cache, input, produce)`
  caches a pure async computation by input hash. Addresses the audit's "zero cache" finding.

## Conventions

- Pure, dependency-free, local-fs only. No network here.
- Tests live in `safe.test.ts`; run `cd .opencode/skills && bun test lib`.
- Keep helpers genuinely shared — per `AGENTS.md`, do not extract single-use helpers preemptively.

The `report-builder` skill is the reference consumer.
