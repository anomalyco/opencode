The legacy database migration system has a bug. When recovering migration history from the `__drizzle_migrations` table, the code assumes the table always has a `name` column. However, some legacy databases use a different schema where migrations are tracked by `created_at` timestamp instead of a `name` field.

Additionally, the `workspace-name` migration assumes the `workspace` table always has a `name` column, but older databases may not have it.

Fix both issues:
1. In `packages/core/src/database/migration.ts`: When importing from `__drizzle_migrations`, first check if the table has a `name` column using `pragma_table_info`. If it does, use the existing logic. If it doesn't, reconstruct migration IDs from `created_at` timestamps by matching them against known migration IDs. Throw an error if a timestamp doesn't match any known migration.
2. In `packages/core/src/database/migration/20260410174513_workspace-name.ts`: Before referencing the `name` column, check if it exists using `PRAGMA table_info`. If it doesn't exist, use an empty string `''` as the default value.

Write tests that verify:
- Legacy workspace data is preserved when the `name` column is missing
- Unnamed Drizzle journal entries are imported by their actual migration timestamps
- Unknown legacy Drizzle journal timestamps are rejected with an error


