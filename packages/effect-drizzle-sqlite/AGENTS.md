# Effect Drizzle SQLite

This package vendors a Drizzle Effect SQLite adapter for this repo.

- Keep this package generic: Drizzle + Effect + SQLite only.
- Do not add opencode-specific tables, paths, migrations, post-commit hooks, or domain storage APIs here.
- Runtime code should depend on generic `effect/unstable/sql/SqlClient`, not a specific SQLite driver.
- Concrete SQLite clients such as `@effect/sql-sqlite-bun` belong in tests or examples unless this package intentionally adds a driver-specific helper.
- Preserve Drizzle adapter naming and behavior where possible so this can be replaced by upstream `drizzle-orm/effect-sqlite` later.
- If touching copied Drizzle internals, compare with current `drizzle-orm@1.0.0-rc.2` declarations and runtime JS.
- If touching Effect APIs, verify against `/Users/kit/code/open-source/effect-smol`.

Useful entry points:

- `src/effect-sqlite/driver.ts`: creates the Effect-backed Drizzle database with `make` and `makeWithDefaults`.
- `src/effect-sqlite/session.ts`: adapts generic Effect `SqlClient` execution and transactions to Drizzle SQLite sessions.
- `src/sqlite-core/effect/*`: Effect-yieldable SQLite query builders.
- `src/internal/drizzle-utils.ts`: local typed shims for Drizzle runtime internals that RC2 does not expose in declarations.
- `examples/basic.ts`: minimal usage example with Bun SQLite.
