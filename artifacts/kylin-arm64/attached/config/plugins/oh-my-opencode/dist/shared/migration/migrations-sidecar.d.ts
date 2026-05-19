/**
 * Sidecar state file that tracks applied config migrations outside the user's
 * config file.
 *
 * Why this exists (#3263): users who revert an auto-migrated value (e.g.
 * `gpt-5.4` → `gpt-5.3-codex`) and then delete the `_migrations` field from
 * their config would fall into an infinite migration loop — every startup
 * re-applied the migration because there was no memory of the previous
 * application. The sidecar remembers applied migrations even when the user
 * scrubs the config, and only "resets" when the user explicitly deletes both
 * the config and the sidecar.
 *
 * The sidecar lives next to the config file as
 * `<configFileName>.migrations.json`. One sidecar per config file. The file
 * format is a flat JSON object:
 *
 *     {
 *       "appliedMigrations": [
 *         "model-version:openai/gpt-5.3-codex->openai/gpt-5.4",
 *         "model-version:anthropic/claude-opus-4-5->anthropic/claude-opus-4-6"
 *       ]
 *     }
 */
export interface MigrationsSidecar {
    appliedMigrations: string[];
}
export declare function getSidecarPath(configPath: string): string;
/**
 * Read the set of applied migration keys from the sidecar next to
 * `configPath`. Returns an empty set on any read or parse failure so the
 * caller can still trust the return value and safely fall back to the
 * config's `_migrations` field.
 */
export declare function readAppliedMigrations(configPath: string): Set<string>;
/**
 * Persist the given set of applied migration keys to the sidecar next to
 * `configPath`. The sidecar is written atomically. Returns true on success,
 * false if the write failed (the caller can still proceed — the next
 * startup will re-run the migration, which is idempotent by design).
 */
export declare function writeAppliedMigrations(configPath: string, migrations: Set<string>): boolean;
